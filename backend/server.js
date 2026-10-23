// GymFit backend API
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { pool } = require('./db');
const { migrate } = require('./migrate');
const { seedFirstTenant } = require('./seed');
const { DEFAULT_SETTINGS_TEMPLATES, buildMsg } = require('./templates');
const {
  auth, optionalAuth, adminOnly, setAuthCookie, clearAuthCookie,
  resolveTenant, checkTenantAuth, requireLiveGym,
  globalLimiter, authLimiter, inquiryLimiter, razorpayLimiter,
  notFound, errorHandler,
} = require('./middleware');

const isProd = process.env.NODE_ENV === 'production';

// ---------- fail-fast on weak/missing secrets (prevents dev-default in prod) ----------
const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('change')) {
  console.error('FATAL: strong JWT_SECRET (32+ chars) is required in .env');
  process.exit(1);
}
const PG_PASS = process.env.POSTGRES_PASSWORD || '';
if (!PG_PASS || PG_PASS.length < 8 || PG_PASS.includes('change')) {
  console.error('FATAL: strong POSTGRES_PASSWORD (8+ chars) is required in .env');
  process.exit(1);
}

const APP_URL = process.env.APP_URL || 'http://localhost:2311';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS: same-origin in production (nginx proxies /api), allow-list for dev tools
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || APP_URL).split(',').map(s => s.trim());
app.use(cors({ origin: FRONTEND_ORIGINS, credentials: true }));

app.set('trust proxy', 1); // behind nginx/caddy
app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed: inline styles + Razorpay checkout script
app.use(morgan(':date[iso] :method :url :status :response-time ms'));
app.use(globalLimiter);
app.use(express.json({ limit: '3mb' }));
app.use('/api', resolveTenant); // every /api request carries its gym (tenant) context
app.use('/api/platform', require('./routes-platform')); // self-signup + platform admin

// ---------- helpers ----------
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  plan_id: u.plan_id, trainer_id: u.trainer_id, join_date: u.join_date, expiry_date: u.expiry_date,
});

// ---------- notifications (email + WhatsApp) ----------
// Set these in .env:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM   -> to send email
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID                       -> to send WhatsApp
// Without setup the message is stored with status "ready" — the admin can send it
// from the Notifications tab (Copy or the WhatsApp link).
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
const WA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';

async function logNotif(userId, channel, dest, subject, body, status, error, gymId) {
  await pool.query(
    `INSERT INTO notifications (user_id, channel, dest, subject, body, status, error, gym_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId || null, channel, dest || null, subject, body, status, error || null, gymId || null]
  );
}

async function sendWhatsApp(phone, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return { status: 'ready', error: 'WhatsApp setup not done (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)' };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone.replace(/\D/g, ''), type: 'text', text: { body: text } }),
    });
    if (r.ok) return { status: 'sent' };
    return { status: 'failed', error: await r.text() };
  } catch (e) { return { status: 'failed', error: e.message }; }
}

async function sendEmail(to, subject, body) {
  if (!mailer) return { status: 'ready', error: 'Email setup not done (SMTP_HOST / SMTP_USER / SMTP_PASS)' };
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: body });
    return { status: 'sent' };
  } catch (e) { return { status: 'failed', error: e.message }; }
}

// send a message to a member on every available channel (email / WhatsApp)
async function notify(userId, contact, subject, body, gymId) {
  if (contact.email) {
    const r = await sendEmail(contact.email, subject, body);
    await logNotif(userId, 'email', contact.email, subject, body, r.status, r.error, gymId);
  } else {
    await logNotif(userId, 'email', null, subject, body, 'skipped', 'No email saved', gymId);
  }
  if (contact.phone) {
    const r = await sendWhatsApp(contact.phone, subject + '\n' + body);
    await logNotif(userId, 'whatsapp', contact.phone, subject, body, r.status, r.error, gymId);
  } else {
    await logNotif(userId, 'whatsapp', null, subject, body, 'skipped', 'No phone saved', gymId);
  }
}

// ---------- DB init (migrations + gym seed + bootstrap admin) ----------
async function init() {
  await migrate();         // applies backend/migrations/*.sql in order (idempotent)
  await seedFirstTenant(); // gym #1 + backfills every pre-tenancy row (idempotent)

  // bootstrap admin (no hardcoded credentials) — created once from env on first run
  const anyAdmin = await pool.query(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if (!anyAdmin.rows.length) {
    const BOOT_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase().trim();
    const BOOT_PASS = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
    if (!BOOT_EMAIL || BOOT_PASS.length < 8) {
      console.error('FATAL: no admin exists and BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (8+ chars) are not set');
      process.exit(1);
    }
    const bootHash = await bcrypt.hash(BOOT_PASS, 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Admin',$1,$2,'admin')`,
      [BOOT_EMAIL, bootHash]
    );
    console.log('Bootstrap admin created:', BOOT_EMAIL, '— change this password after first login');
  }
  // platform admin (manages every gym) — optional, created once from env
  const anyPlatform = await pool.query(`SELECT id FROM users WHERE role='platform_admin' LIMIT 1`);
  if (!anyPlatform.rows.length && (process.env.PLATFORM_ADMIN_EMAIL || '').trim()
      && (process.env.PLATFORM_ADMIN_PASSWORD || '').length >= 8) {
    const hash = await bcrypt.hash(process.env.PLATFORM_ADMIN_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, gym_id) VALUES ('Platform Admin',$1,$2,'platform_admin',NULL)`,
      [process.env.PLATFORM_ADMIN_EMAIL.toLowerCase().trim(), hash]
    );
    console.log('Platform admin created:', process.env.PLATFORM_ADMIN_EMAIL);
  }
  // default plans for gym #1 (idempotent)
  const gid = await pool.query(`SELECT id FROM gyms ORDER BY id LIMIT 1`);
  if (gid.rows.length) {
    const plans = await pool.query('SELECT count(*)::int AS c FROM plans WHERE gym_id=$1', [gid.rows[0].id]);
    if (!plans.rows[0].c) {
      await pool.query(
        `INSERT INTO plans (name, duration_days, price, gym_id) VALUES
         ('Monthly Plan', 30, 1500, $1),
         ('Quarterly Plan', 90, 4000, $1),
         ('Yearly Plan', 365, 12000, $1)`,
        [gid.rows[0].id]
      );
    }
  }
}

// ---------- health ----------
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ---------- auth routes ----------
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!req.gym) {
      // no gym for this host (e.g. platform root): only platform admins may login
      const pa = await pool.query(`SELECT * FROM users WHERE email=$1 AND role='platform_admin'`, [(email || '').toLowerCase().trim()]);
      const pu = pa.rows[0];
      if (!pu || !(await bcrypt.compare(password || '', pu.password_hash))) {
        return res.status(401).json({ error: 'Wrong email or password' });
      }
      const ptok = jwt.sign({ id: pu.id, role: pu.role }, JWT_SECRET, { expiresIn: '7d' });
      setAuthCookie(res, ptok);
      return res.json({ token: ptok, user: publicUser(pu) });
    }
    const r = await pool.query('SELECT * FROM users WHERE email=$1 AND gym_id=$2', [(email || '').toLowerCase().trim(), req.gym.id]);
    let u = r.rows[0];
    if (!u) {
      // platform admin has gym_id NULL — accepted only when the host is the platform root
      const pa = await pool.query(`SELECT * FROM users WHERE email=$1 AND role='platform_admin'`, [(email || '').toLowerCase().trim()]);
      u = pa.rows[0];
    }
    if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    const token = jwt.sign({ id: u.id, role: u.role, gym_id: u.gym_id }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookie(res, token); // HttpOnly cookie is the primary storage from now on
    res.json({ token, user: publicUser(u) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    if (!req.gym) return res.status(404).json({ error: 'Gym not found for this address' });
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const d = await pool.query('SELECT id FROM users WHERE email=$1 AND gym_id=$2', [email.toLowerCase().trim(), req.gym.id]);
    if (d.rows.length) return res.status(400).json({ error: 'This email already exists, please login' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, gym_id, join_date)
       VALUES ($1,$2,$3,$4,'member',$5,CURRENT_DATE) RETURNING *`,
      [name.trim(), email.toLowerCase().trim(), phone || null, hash, req.gym.id]
    );
    const token = jwt.sign({ id: r.rows[0].id, role: r.rows[0].role, gym_id: r.rows[0].gym_id }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookie(res, token);
    res.json({ token, user: publicUser(r.rows[0]) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ---------- forgot / reset password ----------
app.post('/api/auth/forgot', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    // always answer ok — never reveal whether an email is registered
    res.json({ ok: true });
    if (!email) return;
    const u = await pool.query('SELECT id FROM users WHERE email=$1', [String(email).toLowerCase().trim()]);
    if (!u.rows.length) return;
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await pool.query(
      `DELETE FROM password_resets WHERE user_id=$1 AND used=false`,
      [u.rows[0].id]
    );
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')`,
      [u.rows[0].id, tokenHash]
    );
    const link = APP_URL + '/?reset=' + rawToken;
    const msg = `Password reset requested for your account.\nOpen this link within 1 hour to set a new password:\n${link}`;
    // SMTP set -> email direct; SMTP not set -> saved as a "ready" notification so the admin can hand over the link
    const r = await sendEmail(String(email).toLowerCase().trim(), 'Password reset link', msg);
    await logNotif(u.rows[0].id, 'email', String(email).toLowerCase().trim(), 'Password reset link', msg, r.status, r.error);
  } catch (e) { console.error(e); }
});

app.post('/api/auth/reset', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const r = await pool.query(
      `SELECT pr.*, u.id AS uid FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash=$1 AND pr.used=false AND pr.expires_at > now()`,
      [tokenHash]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Reset link is invalid or expired' });
    const hash = await bcrypt.hash(String(password), 12);
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [r.rows[0].uid, hash]);
    await pool.query('UPDATE password_resets SET used=true WHERE id=$1', [r.rows[0].id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(r.rows[0]));
});

// password khud badalna
app.post('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1 AND gym_id=$3', [req.user.id, hash, req.gym.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

// ---------- gym (tenant) branding + settings ----------
// public branding of the gym this host belongs to
app.get('/api/gym', async (req, res) => {
  if (!req.gym) return res.status(404).json({ error: 'Gym not found' });
  const g = req.gym;
  res.json({
    slug: g.slug, name: g.name, logo: g.logo, primary_color: g.primary_color,
    address: g.address, phone: g.phone, hours: g.hours, map_url: g.map_url,
  });
});

// full settings — admins only (masked Razorpay keys)
app.get('/api/gym/settings', auth, checkTenantAuth, adminOnly, async (req, res) => {
  if (!req.gym) return res.status(404).json({ error: 'Gym not found' });
  const g = req.gym;
  const s = g.settings || {};
  res.json({
    name: g.name, logo: g.logo, primary_color: g.primary_color,
    address: g.address, phone: g.phone, hours: g.hours, map_url: g.map_url, settings: s,
    status: g.status, trial_ends_at: g.trial_ends_at, paid_until: g.paid_until,
    default_templates: DEFAULT_SETTINGS_TEMPLATES,
    razorpay_key_id: g.razorpay_key_id ? g.razorpay_key_id.slice(0, 8) + '••••' + g.razorpay_key_id.slice(-4) : '',
    has_razorpay_key: !!g.razorpay_key_id,
  });
});

app.put('/api/gym/settings', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    if (!req.gym) return res.status(404).json({ error: 'Gym not found' });
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : req.gym.name;
    if (!name) return res.status(400).json({ error: 'Gym name is required' });
    await pool.query(
      `UPDATE gyms SET
        name=$2,
        logo=$3,
        primary_color=$4,
        address=$5,
        phone=$6,
        hours=$7,
        map_url=$8,
        razorpay_key_id = CASE WHEN $9::text IS NULL THEN razorpay_key_id ELSE $9::text END,
        razorpay_key_secret = CASE WHEN $10::text IS NULL THEN razorpay_key_secret ELSE $10::text END,
        settings = gyms.settings || $11::jsonb
       WHERE id=$1`,
      [req.gym.id, name,
        b.logo !== undefined ? (b.logo || null) : req.gym.logo,
        b.primary_color !== undefined ? (b.primary_color || null) : req.gym.primary_color,
        b.address !== undefined ? (b.address || null) : req.gym.address,
        b.phone !== undefined ? (b.phone || null) : req.gym.phone,
        b.hours !== undefined ? (b.hours || null) : req.gym.hours,
        b.map_url !== undefined ? (b.map_url || null) : req.gym.map_url,
        b.razorpay_key_id !== undefined && b.razorpay_key_id !== '' ? b.razorpay_key_id : null,
        b.razorpay_key_secret !== undefined && b.razorpay_key_secret !== '' ? b.razorpay_key_secret : null,
        JSON.stringify(b.settings && typeof b.settings === 'object' ? b.settings : {})]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- public gym branding (for the website header etc.) ----------
app.get('/api/tenant/:slug', async (req, res) => {
  try {
    const g = await pool.query(
      `SELECT slug, name, logo, primary_color, address, phone, hours, map_url
       FROM gyms WHERE slug=$1`, [req.params.slug]);
    if (!g.rows.length) return res.status(404).json({ error: 'Gym not found' });
    res.json(g.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Caddy on-demand TLS "ask" endpoint: 200 only for subdomains of an existing gym.
// Caddy calls GET /api/tenant-check?domain=<host>; any non-200 refuses the cert.
app.get('/api/tenant-check', async (req, res) => {
  try {
    const host = String(req.query.domain || '').toLowerCase().split(':')[0];
    const plat = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase();
    if (!host || !plat || !host.endsWith('.' + plat)) return res.status(403).end();
    const slug = host.slice(0, -(plat.length + 1));
    if (!slug) return res.status(403).end();
    const c = await pool.query('SELECT 1 FROM gyms WHERE slug=$1', [slug]);
    res.status(c.rows.length ? 200 : 403).end();
  } catch { res.status(403).end(); }
});

// ---------- members (admin) ----------
app.get('/api/members', auth, checkTenantAuth, adminOnly, async (req, res) => {
  const like = `%${(req.query.search || '').trim()}%`;
  const r = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.join_date, u.expiry_date, u.photo,
            u.plan_id, u.trainer_id, p.name AS plan_name, t.name AS trainer_name
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     LEFT JOIN trainers t ON t.id = u.trainer_id
     WHERE u.role = 'member' AND u.gym_id = $2 AND (u.name ILIKE $1 OR u.phone ILIKE $1 OR u.email ILIKE $1)
     ORDER BY u.created_at DESC`,
    [like, req.gym.id]
  );
  res.json(r.rows);
});

app.post('/api/members', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    if (!req.gym) return res.status(404).json({ error: 'Gym not found' });
    const { name, email, phone, password, plan_id, trainer_id, expiry_date, photo } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'A password (6+ characters) is required for the member' });
    if (email) {
      const d = await pool.query('SELECT id FROM users WHERE email=$1 AND gym_id=$2', [email.toLowerCase().trim(), req.gym.id]);
      if (d.rows.length) return res.status(400).json({ error: 'Email already exists' });
    }
    let expiry = expiry_date || null;
    if (!expiry && plan_id) {
      const pl = await pool.query('SELECT duration_days FROM plans WHERE id=$1 AND gym_id=$2', [plan_id, req.gym.id]);
      expiry = pl.rows[0] ? new Date(Date.now() + pl.rows[0].duration_days * 86400000)
        .toISOString().slice(0, 10) : null;
    }
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, gym_id, plan_id, trainer_id, join_date, expiry_date, photo)
       VALUES ($1,$2,$3,$4,'member',$5,$6,$7,CURRENT_DATE,$8,$9) RETURNING id`,
      [name.trim(), email ? email.toLowerCase().trim() : null, phone || null, hash, req.gym.id,
       plan_id || null, trainer_id || null, expiry, photo || null]
    );
    // tell the new member about the account — the password is never included in messages
    const newId = r.rows[0].id;
    const welcome = buildMsg(req.gym, 'welcome', { member: name.trim(), email: email || '(admin will share)' }, {
      subject: 'Welcome to ' + req.gym.name,
      body: `Hi ${name.trim()},\n\nYour account is ready at ${req.gym.name}!\nWebsite: ${APP_URL}\nLogin email: ${email || '(admin will share)'}\n\nUse "Forgot Password" on the login page to set your password.`,
    });
    notify(newId, { email: email || null, phone: phone || null }, welcome.subject, welcome.body, req.gym.id)
      .catch((e) => console.error('notify fail:', e.message));
    res.json({ id: newId });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/members/:id', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    const { name, email, phone, plan_id, trainer_id, expiry_date, join_date, photo } = req.body;
    const cur = (await pool.query(`SELECT * FROM users WHERE id=$1 AND role='member' AND gym_id=$2`, [req.params.id, req.gym.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Member not found' });
    await pool.query(
      `UPDATE users SET
         name = $2, email = $3, phone = $4, plan_id = $5,
         trainer_id = $6, expiry_date = $7, join_date = $8, photo = $9
       WHERE id=$1 AND role='member' AND gym_id=$10`,
      [req.params.id,
       name !== undefined && name !== '' ? name : cur.name,
       email === undefined ? cur.email : (email || null),
       phone === undefined ? cur.phone : (phone || null),
       plan_id === undefined ? cur.plan_id : (plan_id || null),
       trainer_id === undefined ? cur.trainer_id : (trainer_id || null),
       expiry_date === undefined ? cur.expiry_date : (expiry_date || null),
       join_date === undefined ? cur.join_date : (join_date || null),
       photo === undefined ? cur.photo : (photo || null),
       req.gym.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/members/:id/password', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users SET password_hash=$2 WHERE id=$1 AND role='member' AND gym_id=$3`, [req.params.id, hash, req.gym.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/members/:id', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    await pool.query(`DELETE FROM users WHERE id=$1 AND role='member' AND gym_id=$2`, [req.params.id, req.gym.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

// ---------- membership inquiries (public form on the website) ----------
app.post('/api/inquiries', inquiryLimiter, async (req, res) => {
  try {
    if (!req.gym) return res.status(404).json({ error: 'Gym not found for this address' });
    const { first_name, last_name, email, phone, pin_code } = req.body;
    if (!first_name || !email || !phone) return res.status(400).json({ error: 'First name, email and phone are required' });
    const r = await pool.query(
      `INSERT INTO inquiries (first_name, last_name, email, phone, pin_code, gym_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [first_name, last_name || '', email, phone, pin_code || '', req.gym.id]
    );
    // email the gym owner about the new lead
    const lead = buildMsg(req.gym, 'inquiry', { member: first_name + ' ' + (last_name || ''), email, phone, pin: pin_code || '—' }, {
      subject: 'New membership inquiry — ' + first_name + ' ' + (last_name || ''),
      body: [
        'New membership inquiry received on the website:',
        '',
        'Name:  ' + first_name + ' ' + (last_name || ''),
        'Email: ' + email,
        'Phone: ' + phone,
        'PIN code: ' + (pin_code || '—'),
      ].join('\n'),
    });
    const owner = req.gym.email || process.env.SMTP_FROM || process.env.SMTP_USER;
    const nr = await sendEmail(owner, lead.subject, lead.body);
    await logNotif(null, 'email', owner, lead.subject, lead.body, nr.status, nr.error, req.gym.id);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/inquiries', auth, checkTenantAuth, adminOnly, async (req, res) => {
  const r = await pool.query('SELECT * FROM inquiries WHERE gym_id=$1 ORDER BY created_at DESC LIMIT 200', [req.gym.id]);
  res.json(r.rows);
});

app.put('/api/inquiries/:id', inquiryLimiter, requireLiveGym, async (req, res) => {
  // used by the join flow to attach the chosen plan and payment mode
  try {
    if (!req.gym) return res.status(404).json({ error: 'Gym not found for this address' });
    const { plan_id, pay_mode } = req.body;
    if (!plan_id || !pay_mode) return res.status(400).json({ error: 'Plan and payment mode are required' });
    const r = await pool.query(
      'UPDATE inquiries SET plan_id=$1, pay_mode=$2 WHERE id=$3 AND gym_id=$4 RETURNING *',
      [plan_id, pay_mode, req.params.id, req.gym.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Inquiry not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- Razorpay (online payments) — per-tenant keys first, env as fallback ----------
const gymRzpKeys = (req) => ({
  key: (req.gym && req.gym.razorpay_key_id) || process.env.RAZORPAY_KEY_ID || '',
  secret: (req.gym && req.gym.razorpay_key_secret) || process.env.RAZORPAY_KEY_SECRET || '',
});

app.post('/api/razorpay/order', optionalAuth, checkTenantAuth, razorpayLimiter, async (req, res) => {
  try {
    if (!req.gym) return res.status(404).json({ error: 'Gym not found for this address' });
    const { key, secret } = gymRzpKeys(req);
    if (!key || !secret) return res.status(400).json({ error: 'Razorpay keys not configured' });
    // member flow: an authenticated member pays for their own assigned plan
    let plan;
    if (req.user && req.user.role === 'member') {
      const m = await pool.query(
        `SELECT u.plan_id, pl.name, pl.price, pl.duration_days
         FROM users u LEFT JOIN plans pl ON pl.id = u.plan_id
         WHERE u.id=$1 AND u.gym_id=$2`, [req.user.id, req.gym.id]);
      if (!m.rows.length) return res.status(404).json({ error: 'Member not found' });
      if (!m.rows[0].name || !m.rows[0].price) return res.status(400).json({ error: 'No plan assigned to your membership yet' });
      plan = m.rows[0];
    } else {
      const p = await pool.query('SELECT * FROM plans WHERE id=$1 AND gym_id=$2', [req.body.plan_id, req.gym.id]);
      if (!p.rows.length) return res.status(404).json({ error: 'Plan not found' });
      plan = p.rows[0];
    }
    const amount = Math.round(Number(plan.price) * 100); // paise
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: 'g' + req.gym.id + '-' + (req.user ? 'm' + req.user.id : (req.body.inquiry_id || 0)) + '-' + Date.now(),
        notes: { plan: plan.name, gym: req.gym.slug },
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Razorpay order failed' });
    const o = await r.json();
    res.json({ order_id: o.id, amount: o.amount, key_id: key, plan });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/razorpay/verify', optionalAuth, checkTenantAuth, razorpayLimiter, async (req, res) => {
  try {
    if (!req.gym) return res.status(404).json({ error: 'Gym not found for this address' });
    const { key, secret } = gymRzpKeys(req);
    if (!key || !secret) return res.status(400).json({ error: 'Razorpay keys not configured' });
    const { order_id, payment_id, signature, inquiry_id } = req.body;
    if (!order_id || !payment_id || !signature) return res.status(400).json({ error: 'Missing payment details' });
    const expected = crypto.createHmac('sha256', secret).update(order_id + '|' + payment_id).digest('hex');
    if (expected !== signature) return res.status(400).json({ error: 'Payment signature mismatch' });
    // member flow: record the payment + extend that member's own membership
    if (!inquiry_id && req.user && req.user.role === 'member') {
      const m = await pool.query(
        `SELECT u.plan_id, pl.price, pl.duration_days
         FROM users u LEFT JOIN plans pl ON pl.id = u.plan_id
         WHERE u.id=$1 AND u.gym_id=$2`, [req.user.id, req.gym.id]);
      if (!m.rows.length || !m.rows[0].price) return res.status(400).json({ error: 'No plan assigned to your membership yet' });
      const dup = await pool.query(`SELECT 1 FROM payments WHERE gym_id=$1 AND note LIKE $2 LIMIT 1`, [req.gym.id, '%' + String(payment_id) + '%']);
      if (!dup.rows.length) {
        await pool.query(
          `INSERT INTO payments (user_id, amount, method, note, gym_id) VALUES ($1,$2,'upi',$3,$4)`,
          [req.user.id, Number(m.rows[0].price), 'Razorpay online payment — ' + payment_id, req.gym.id]
        );
        if (m.rows[0].duration_days) {
          await pool.query(
            `UPDATE users SET expiry_date = GREATEST(CURRENT_DATE, COALESCE(expiry_date, CURRENT_DATE)) + $1::int WHERE id=$2`,
            [m.rows[0].duration_days, req.user.id]
          );
        }
      }
      return res.json({ ok: true, member: true });
    }
    if (inquiry_id) {
      const inqR = await pool.query(
        `SELECT i.*, pl.name AS plan_name, pl.price AS plan_price, pl.duration_days
         FROM inquiries i LEFT JOIN plans pl ON pl.id = i.plan_id WHERE i.id=$1 AND i.gym_id=$2`,
        [inquiry_id, req.gym.id]
      );
      const inq = inqR.rows[0];
      if (inq) {
        await pool.query(`UPDATE inquiries SET pay_mode='online-paid' WHERE id=$1`, [inquiry_id]);

        // link to an existing member account when the email matches, so the
        // payment shows up in that member's portal and reports
        const mr = await pool.query(`SELECT id FROM users WHERE email=$1 AND role='member' AND gym_id=$2`, [inq.email, req.gym.id]);
        if (mr.rows.length) {
          const dup = await pool.query(`SELECT 1 FROM payments WHERE gym_id=$1 AND note LIKE $2 LIMIT 1`, [req.gym.id, '%' + String(payment_id) + '%']);
          if (!dup.rows.length) {
            await pool.query(
              `INSERT INTO payments (user_id, amount, method, note, gym_id) VALUES ($1,$2,'upi',$3,$4)`,
              [mr.rows[0].id, Number(inq.plan_price || 0), 'Razorpay online payment — ' + payment_id, req.gym.id]
            );
            // extend the membership expiry by the plan duration (same renew rule as admin payments)
            if (inq.duration_days) {
              await pool.query(
                `UPDATE users SET expiry_date = GREATEST(CURRENT_DATE, COALESCE(expiry_date, CURRENT_DATE)) + $1::int WHERE id=$2`,
                [inq.duration_days, mr.rows[0].id]
              );
            }
          }
        }

        const payCon = buildMsg(req.gym, 'payment_online', {
          member: (inq.first_name || '') + ' ' + (inq.last_name || ''),
          plan: inq.plan_name || 'Membership',
          amount: '₹' + Number(inq.plan_price || 0).toLocaleString('en-IN'),
        }, {
          subject: 'Payment confirmation — ' + req.gym.name,
          body: [
            'Hi ' + (inq.first_name || '') + ' ' + (inq.last_name || '') + ',',
            '',
            'Payment received — ₹' + Number(inq.plan_price || 0).toLocaleString('en-IN') + ' (' + (inq.plan_name || 'Membership') + ')',
            'Welcome to ' + req.gym.name + '!',
            '',
            'Website: ' + APP_URL,
            'See you at the gym 💪',
          ].join('\n'),
        });
        if (inq.email) {
          const r1 = await sendEmail(inq.email, payCon.subject, payCon.body);
          await logNotif(null, 'email', inq.email, payCon.subject, payCon.body, r1.status, r1.error, req.gym.id);
        }
        if (inq.phone) {
          const r2 = await sendWhatsApp(inq.phone, req.gym.name + '\n\n' + payCon.body);
          await logNotif(null, 'whatsapp', inq.phone, payCon.subject, payCon.body, r2.status, r2.error, req.gym.id);
        }
      }
    }

    // tell the gym owner by email
    const subject = 'Online payment received — ' + payment_id;
    const body = 'Razorpay payment successful.\nOrder: ' + order_id + '\nPayment ID: ' + payment_id;
    const owner = process.env.SMTP_FROM || process.env.SMTP_USER;
    sendEmail(owner, subject, body).then(nr => logNotif(null, 'email', owner, subject, body, nr.status, nr.error, req.gym.id).catch(() => {}));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- Razorpay server webhook (server-to-server, survives browser close) ----------
app.post('/api/webhooks/razorpay', razorpayLimiter, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const WH_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    if (!WH_SECRET) return res.status(503).json({ error: 'Webhook secret not configured' });
    const sig = req.headers['x-razorpay-signature'] || '';
    const expected = crypto.createHmac('sha256', WH_SECRET).update(JSON.stringify(req.body)).digest('hex');
    if (expected !== sig) return res.status(400).json({ error: 'Webhook signature mismatch' });
    const ev = req.body || {};
    // payment.captured / payment_link.paid both mean money is in
    if (ev.event === 'payment.captured' || ev.event === 'payment_link.paid') {
      const pid = ev.payload && ev.payload.payment && ev.payload.payment.entity && ev.payload.payment.entity.id;
      if (pid) {
        // idempotent: if the browser verify flow already recorded this payment, do nothing
        const dup = await pool.query(`SELECT 1 FROM payments WHERE note LIKE $1 LIMIT 1`, ['%' + String(pid) + '%']);
        if (!dup.rows.length) {
          const am = ev.payload.payment.entity.amount || 0;
          const body = 'Razorpay webhook payment captured.\nPayment ID: ' + pid + '\nAmount: ₹' + (am / 100).toLocaleString('en-IN');
          const owner = process.env.SMTP_FROM || process.env.SMTP_USER;
          await logNotif(null, 'email', owner, 'Webhook payment captured — ' + pid, body, 'ready', null);
        }
      }
    }
    // platform fee: a gym's subscription was charged → extend this gym by a month
    if (ev.event === 'subscription.charged') {
      const sub = ev.payload && ev.payload.subscription && ev.payload.subscription.entity;
      if (sub && sub.id) {
        const g = await pool.query('SELECT id, slug FROM gyms WHERE subscription_id=$1', [sub.id]);
        if (g.rows.length) {
          await pool.query(
            `UPDATE gyms SET status='active',
               paid_until = GREATEST(COALESCE(paid_until, now()), now()) + interval '1 month',
               subscription_status = 'active'
             WHERE id=$1`, [g.rows[0].id]);
          const amt = ev.payload.payment && ev.payload.payment.entity ? ev.payload.payment.entity.amount / 100 : null;
          const owner = await pool.query(
            `SELECT email FROM users WHERE id = (SELECT owner_user_id FROM gyms WHERE id=$1)`, [g.rows[0].id]);
          const body = 'Platform fee received for gym "' + g.rows[0].slug + '".\nSubscription: ' + sub.id
            + (amt ? '\nAmount: ₹' + Number(amt).toLocaleString('en-IN') : '')
            + '\nThe gym\'s paid_until was extended by one month automatically.';
          sendEmail(owner.rows[0] && owner.rows[0].email, 'Platform fee received — ' + g.rows[0].slug, body)
            .then(nr => logNotif(null, 'email', owner.rows[0] && owner.rows[0].email, 'Platform fee received — ' + g.rows[0].slug, body, nr.status, nr.error).catch(() => {}));
        }
      }
    }
    // platform fee: a gym's subscription was cancelled → record it (paid_until stays until it lapses)
    if (ev.event === 'subscription.cancelled') {
      const sub = ev.payload && ev.payload.subscription && ev.payload.subscription.entity;
      if (sub && sub.id) {
        await pool.query(`UPDATE gyms SET subscription_status='cancelled' WHERE subscription_id=$1`, [sub.id]);
      }
    }
    res.json({ ok: true }); // 200 = accepted; Razorpay retries non-200
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- plans ----------
app.get('/api/plans', async (req, res) => {  // public: shown on the member website
  if (!req.gym) return res.json([]);
  const r = await pool.query('SELECT * FROM plans WHERE gym_id=$1 ORDER BY duration_days', [req.gym.id]);
  res.json(r.rows);
});

app.post('/api/plans', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    const { name, duration_days, price } = req.body;
    if (!name || !duration_days || !price) return res.status(400).json({ error: 'Name, days and price are required' });
    const r = await pool.query(
      `INSERT INTO plans (name, duration_days, price, gym_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, duration_days, price, req.gym.id]
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/plans/:id', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    await pool.query('DELETE FROM plans WHERE id=$1 AND gym_id=$2', [req.params.id, req.gym.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- trainers ----------
app.get('/api/trainers', async (req, res) => {  // public: shown on the member website
  if (!req.gym) return res.json([]);
  const r = await pool.query('SELECT * FROM trainers WHERE gym_id=$1 ORDER BY name', [req.gym.id]);
  res.json(r.rows);
});

app.post('/api/trainers', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    const { name, phone, specialty } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const r = await pool.query(
      `INSERT INTO trainers (name, phone, specialty, gym_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, phone || null, specialty || null, req.gym.id]
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/trainers/:id', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    await pool.query('DELETE FROM trainers WHERE id=$1 AND gym_id=$2', [req.params.id, req.gym.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- payments ----------
app.get('/api/payments', auth, checkTenantAuth, adminOnly, async (req, res) => {
  const r = await pool.query(
    `SELECT pa.*, u.name AS member_name
     FROM payments pa JOIN users u ON u.id = pa.user_id
     WHERE pa.gym_id = $1
     ORDER BY pa.created_at DESC LIMIT 200`, [req.gym.id]
  );
  res.json(r.rows);
});

app.post('/api/payments', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  const { user_id, amount, method, note, extend } = req.body;
  try {
    // member must belong to this gym
    const own = await pool.query(`SELECT id FROM users WHERE id=$1 AND gym_id=$2`, [user_id, req.gym.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Member not found' });
    await pool.query('BEGIN');
    const p = await pool.query(
      `INSERT INTO payments (user_id, amount, method, note, gym_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user_id, amount, method || 'cash', note || null, req.gym.id]
    );
    // plan renew checkbox: expiry extend kar do
    if (extend) {
      const u = await pool.query(
        `SELECT u.expiry_date, pl.duration_days FROM users u
         LEFT JOIN plans pl ON pl.id = u.plan_id WHERE u.id=$1`, [user_id]);
      if (u.rows[0] && u.rows[0].duration_days) {
        await pool.query(
          `UPDATE users
           SET expiry_date = GREATEST(CURRENT_DATE, COALESCE(expiry_date, CURRENT_DATE)) + $2::int
           WHERE id=$1`, [user_id, u.rows[0].duration_days]);
      }
    }
    await pool.query('COMMIT');
    // payment ka message member ko bhejo
    const info = await pool.query(
      `SELECT name, email, phone, expiry_date FROM users WHERE id=$1`, [user_id]);
    const mem = info.rows[0];
    if (mem) {
      const payMsg = buildMsg(req.gym, 'payment_received', {
        member: mem.name, method: method || 'cash', amount: '₹' + Number(amount).toLocaleString('en-IN'),
        expiry: extend && mem.expiry_date ? mem.expiry_date : '',
      }, extend && mem.expiry_date
        ? {
            subject: 'Payment received — ' + req.gym.name,
            body: `Payment received: ₹${Number(amount).toLocaleString('en-IN')} (${method || 'cash'}).\nMembership valid till: ${mem.expiry_date}.\nKeep going strong!`,
          }
        : {
            subject: 'Payment received — ' + req.gym.name,
            body: `Payment received: ₹${Number(amount).toLocaleString('en-IN')} (${method || 'cash'}).\nThank you for your payment.`,
          });
      notify(user_id, { email: mem.email, phone: mem.phone }, payMsg.subject, payMsg.body, req.gym.id)
        .catch((e) => console.error('notify fail:', e.message));
    }
    res.json(p.rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/payments/:id', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    await pool.query('DELETE FROM payments WHERE id=$1 AND gym_id=$2', [req.params.id, req.gym.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- attendance ----------
app.post('/api/attendance', auth, requireLiveGym, checkTenantAuth, async (req, res) => {
  try {
    const uid = req.user.role === 'admin' ? Number(req.body.user_id) : req.user.id;
    if (!uid) return res.status(400).json({ error: 'Member is required' });
    const u = await pool.query(`SELECT expiry_date::text AS expiry FROM users WHERE id=$1 AND gym_id=$2`, [uid, req.gym.id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Member not found' });
    const exp = u.rows[0].expiry; // "YYYY-MM-DD" ya null
    const today = new Date().toISOString().slice(0, 10);
    if (exp && exp < today) return res.status(400).json({ error: 'Membership expired, please renew' });
    // one check-in per member per day (server-side guard, not just UI)
    const existing = await pool.query(
      `SELECT id, checkin_at FROM attendance WHERE user_id=$1 AND checkin_at::date = CURRENT_DATE ORDER BY id LIMIT 1`, [uid]);
    if (existing.rows.length) return res.json({ ...existing.rows[0], already_today: true });
    const r = await pool.query('INSERT INTO attendance (user_id, gym_id) VALUES ($1,$2) RETURNING *', [uid, req.gym.id]);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/attendance', auth, checkTenantAuth, adminOnly, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const r = await pool.query(
    `SELECT a.*, u.name AS member_name
     FROM attendance a JOIN users u ON u.id = a.user_id
     WHERE a.checkin_at::date = $1 AND a.gym_id = $2
     ORDER BY a.checkin_at DESC`, [date, req.gym.id]);
  res.json(r.rows);
});

// ---------- member apna data ----------
app.get('/api/me/detail', auth, checkTenantAuth, async (req, res) => {
  try {
    const u = await pool.query(
      `SELECT u.name, u.email, u.phone, u.join_date, u.expiry_date, u.photo, u.plan_id, u.trainer_id,
              p.name AS plan_name, t.name AS trainer_name
       FROM users u
       LEFT JOIN plans p ON p.id = u.plan_id
       LEFT JOIN trainers t ON t.id = u.trainer_id
       WHERE u.id = $1 AND u.gym_id = $2`, [req.user.id, req.gym.id]);
    if (!u.rows.length) return res.status(404).json({ error: 'User not found' });
    const pays = await pool.query(
      `SELECT id, amount, method, paid_on FROM payments WHERE user_id=$1 ORDER BY paid_on DESC, id DESC`, [req.user.id]);
    const att = await pool.query(
      `SELECT id, checkin_at FROM attendance WHERE user_id=$1 ORDER BY checkin_at DESC LIMIT 10`, [req.user.id]);
    const tdy = await pool.query(
      `SELECT count(*)::int AS c FROM attendance WHERE user_id=$1 AND checkin_at::date = CURRENT_DATE`, [req.user.id]);
    const stats = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM attendance WHERE user_id=$1) AS total_visits,
        (SELECT count(*)::int FROM attendance WHERE user_id=$1 AND checkin_at::date >= date_trunc('month', CURRENT_DATE)::date) AS month_visits,
        (SELECT COALESCE(sum(amount),0)::float FROM payments WHERE user_id=$1) AS total_paid`, [req.user.id]);
    res.json({ ...u.rows[0], ...stats.rows[0], payments: pays.rows, attendance: att.rows, checked_today: tdy.rows[0].c });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// member apni photo khud badle
app.post('/api/me/photo', auth, checkTenantAuth, async (req, res) => {
  try {
    const { photo } = req.body;
    if (!photo) return res.status(400).json({ error: 'Photo is required' });
    await pool.query(`UPDATE users SET photo=$2 WHERE id=$1 AND gym_id=$3`, [req.user.id, photo, req.gym.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- notifications (admin) ----------
app.get('/api/notifications', auth, checkTenantAuth, adminOnly, async (req, res) => {
  const r = await pool.query(
    `SELECT n.*, u.name AS member_name
     FROM notifications n LEFT JOIN users u ON u.id = n.user_id
     WHERE n.gym_id = $1
     ORDER BY n.created_at DESC LIMIT 100`, [req.gym.id]);
  res.json(r.rows);
});

app.get('/api/notifications/config', auth, checkTenantAuth, adminOnly, (req, res) => {
  res.json({ email: !!mailer, whatsapp: !!(WA_TOKEN && WA_PHONE_ID) });
});

app.post('/api/notifications/:id/resend', auth, checkTenantAuth, adminOnly, requireLiveGym, async (req, res) => {
  try {
    const n = (await pool.query('SELECT * FROM notifications WHERE id=$1 AND gym_id=$2', [req.params.id, req.gym.id])).rows[0];
    if (!n || !n.dest) return res.status(404).json({ error: 'Notification or recipient not found' });
    const r = n.channel === 'email'
      ? await sendEmail(n.dest, n.subject, n.body)
      : await sendWhatsApp(n.dest, n.subject + '\n' + n.body);
    if (r.status === 'sent') await pool.query(`UPDATE notifications SET status='sent', error=NULL WHERE id=$1`, [n.id]);
    res.json({ ok: true, status: r.status });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- reports ----------
app.get('/api/reports/summary', auth, checkTenantAuth, adminOnly, async (req, res) => {
  const g = req.gym.id;
  const r = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE role='member' AND gym_id=$1) AS total,
      (SELECT count(*)::int FROM users WHERE role='member' AND gym_id=$1 AND expiry_date >= CURRENT_DATE) AS active,
      (SELECT count(*)::int FROM users WHERE role='member' AND gym_id=$1 AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 7) AS expiring,
      (SELECT count(*)::int FROM users WHERE role='member' AND gym_id=$1 AND expiry_date < CURRENT_DATE) AS expired,
      (SELECT COALESCE(sum(amount),0)::float FROM payments WHERE gym_id=$1 AND paid_on >= date_trunc('month', CURRENT_DATE)::date) AS month_income,
      (SELECT count(*)::int FROM attendance WHERE gym_id=$1 AND checkin_at::date = CURRENT_DATE) AS today_attendance
  `, [g]);
  res.json(r.rows[0]);
});

// ---------- analytics (admin: charts data, gym-scoped) ----------
app.get('/api/analytics', auth, checkTenantAuth, adminOnly, async (req, res) => {
  const g = req.gym.id;
  // labels for the last n months, ending with the current one
  const months = (n) => {
    const out = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const ym = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
      out.push({ ym, label: m.toLocaleString('en-IN', { month: 'short' }) });
    }
    return out;
  };
  const m6 = months(6);
  const since6 = m6[0].ym + '-01';
  const [rev, mem, chk, plans] = await Promise.all([
    pool.query(`SELECT to_char(paid_on,'YYYY-MM') AS ym, sum(amount)::float AS total
                FROM payments WHERE gym_id=$1 AND paid_on >= $2 GROUP BY 1`, [g, since6]),
    pool.query(`SELECT to_char(join_date,'YYYY-MM') AS ym, count(*)::int AS c
                FROM users WHERE gym_id=$1 AND role='member' AND join_date >= $2 GROUP BY 1`, [g, since6]),
    pool.query(`SELECT checkin_at::date::text AS d, count(*)::int AS c
                FROM attendance WHERE gym_id=$1 AND checkin_at::date > CURRENT_DATE - 14 GROUP BY 1`, [g]),
    pool.query(`SELECT p.name, count(*)::int AS c FROM users u JOIN plans p ON p.id = u.plan_id
                WHERE u.gym_id=$1 AND u.role='member' GROUP BY 1 ORDER BY c DESC NULLS LAST`, [g]),
  ]);
  const byKey = (rows, k) => Object.fromEntries(rows.rows.map(r => [r[k], r]));
  const revM = byKey(rev, 'ym'), memM = byKey(mem, 'ym');
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push({ date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) });
  }
  const chkD = byKey(chk, 'd');
  res.json({
    revenue_by_month: m6.map(m => ({ label: m.label, value: (revM[m.ym] || {}).total || 0 })),
    members_by_month: m6.map(m => ({ label: m.label, value: (memM[m.ym] || {}).c || 0 })),
    checkins: days.map(d => ({ label: d.label, value: (chkD[d.date] || {}).c || 0 })),
    plans: plans.rows.map(r => ({ label: r.name, value: r.c })),
  });
});

// listen only after the schema is ready (avoids the cold-start race)
init()
  .then(() => {
    app.use(notFound);
    app.use(errorHandler);
    app.listen(PORT, () => console.log('GymFit API listening on port', PORT));
  })
  .catch((e) => { console.error('DB init failed:', e); process.exit(1); });