// GymFit backend API
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool, types } = require('pg');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const APP_URL = process.env.APP_URL || 'http://localhost:2311';

// DATE columns (oid 1082) arrive as plain strings, avoiding timezone conversion
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'gymfit_dev_secret_change_me';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '3mb' }));

// ---------- helpers ----------
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  plan_id: u.plan_id, trainer_id: u.trainer_id, join_date: u.join_date, expiry_date: u.expiry_date,
});

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please login first' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
  next();
}

const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' });

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

async function logNotif(userId, channel, dest, subject, body, status, error) {
  await pool.query(
    `INSERT INTO notifications (user_id, channel, dest, subject, body, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId || null, channel, dest || null, subject, body, status, error || null]
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
async function notify(userId, { email, phone }, subject, body) {
  if (email) {
    const r = await sendEmail(email, subject, body);
    await logNotif(userId, 'email', email, subject, body, r.status, r.error);
  } else {
    await logNotif(userId, 'email', null, subject, body, 'skipped', 'No email saved');
  }
  if (phone) {
    const r = await sendWhatsApp(phone, subject + '\n' + body);
    await logNotif(userId, 'whatsapp', phone, subject, body, r.status, r.error);
  } else {
    await logNotif(userId, 'whatsapp', null, subject, body, 'skipped', 'No phone saved');
  }
}

// ---------- DB init (tables + seed) ----------
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      duration_days INT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      specialty TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      plan_id INT REFERENCES plans(id) ON DELETE SET NULL,
      trainer_id INT REFERENCES trainers(id) ON DELETE SET NULL,
      join_date DATE,
      expiry_date DATE,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL,
      method TEXT,
      note TEXT,
      paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checkin_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // member photo (dataURL text)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      channel TEXT,
      dest TEXT,
      subject TEXT,
      body TEXT,
      status TEXT,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);

  // membership inquiries from the website contact form
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      pin_code TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS plan_id INT`);
  await pool.query(`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS pay_mode TEXT`);

  // default admin
  const admin = await pool.query(`SELECT id FROM users WHERE email='admin@gym.com'`);
  if (!admin.rows.length) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Admin','admin@gym.com',$1,'admin')`,
      [hash]
    );
  }
  // default plans
  const plans = await pool.query('SELECT count(*)::int AS c FROM plans');
  if (!plans.rows[0].c) {
    await pool.query(
      `INSERT INTO plans (name, duration_days, price) VALUES
       ('Monthly Plan', 30, 1500),
       ('Quarterly Plan', 90, 4000),
       ('Yearly Plan', 365, 12000)`
    );
  }
}

// ---------- health ----------
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ---------- auth routes ----------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [(email || '').toLowerCase().trim()]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    const token = jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: publicUser(u) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    const d = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (d.rows.length) return res.status(400).json({ error: 'This email already exists, please login' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, join_date)
       VALUES ($1,$2,$3,$4,'member',CURRENT_DATE) RETURNING *`,
      [name.trim(), email.toLowerCase().trim(), phone || null, hash]
    );
    const token = jwt.sign({ id: r.rows[0].id, role: r.rows[0].role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: publicUser(r.rows[0]) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
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
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, hash]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

// ---------- members (admin) ----------
app.get('/api/members', auth, adminOnly, async (req, res) => {
  const like = `%${(req.query.search || '').trim()}%`;
  const r = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.join_date, u.expiry_date, u.photo,
            u.plan_id, u.trainer_id, p.name AS plan_name, t.name AS trainer_name
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     LEFT JOIN trainers t ON t.id = u.trainer_id
     WHERE u.role = 'member' AND (u.name ILIKE $1 OR u.phone ILIKE $1 OR u.email ILIKE $1)
     ORDER BY u.created_at DESC`,
    [like]
  );
  res.json(r.rows);
});

app.post('/api/members', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, password, plan_id, trainer_id, expiry_date, photo } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (email) {
      const d = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
      if (d.rows.length) return res.status(400).json({ error: 'Email already exists' });
    }
    let expiry = expiry_date || null;
    if (!expiry && plan_id) {
      const pl = await pool.query('SELECT duration_days FROM plans WHERE id=$1', [plan_id]);
      expiry = pl.rows[0] ? new Date(Date.now() + pl.rows[0].duration_days * 86400000)
        .toISOString().slice(0, 10) : null;
    }
    const hash = await bcrypt.hash(password || 'gym123', 10);
    const r = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, plan_id, trainer_id, join_date, expiry_date, photo)
       VALUES ($1,$2,$3,$4,'member',$5,$6,CURRENT_DATE,$7,$8) RETURNING id`,
      [name.trim(), email ? email.toLowerCase().trim() : null, phone || null, hash,
       plan_id || null, trainer_id || null, expiry, photo || null]
    );
    // naye member ko welcome + login details ka message bhejo
    const newId = r.rows[0].id;
    const welcome = `Hi ${name.trim()},\n\nYour account is ready at Jaini Fitness Center!\nWebsite: ${APP_URL}\nLogin email: ${email || '(admin will share)'}\nPassword: ${password || 'gym123'}\n\nSee you at the gym!`;
    notify(newId, { email: email || null, phone: phone || null }, 'Welcome to Jaini Fitness Center', welcome)
      .catch((e) => console.error('notify fail:', e.message));
    res.json({ id: newId });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/members/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, plan_id, trainer_id, expiry_date, join_date, photo } = req.body;
    const cur = (await pool.query(`SELECT * FROM users WHERE id=$1 AND role='member'`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Member not found' });
    await pool.query(
      `UPDATE users SET
         name = $2, email = $3, phone = $4, plan_id = $5,
         trainer_id = $6, expiry_date = $7, join_date = $8, photo = $9
       WHERE id=$1 AND role='member'`,
      [req.params.id,
       name !== undefined && name !== '' ? name : cur.name,
       email === undefined ? cur.email : (email || null),
       phone === undefined ? cur.phone : (phone || null),
       plan_id === undefined ? cur.plan_id : (plan_id || null),
       trainer_id === undefined ? cur.trainer_id : (trainer_id || null),
       expiry_date === undefined ? cur.expiry_date : (expiry_date || null),
       join_date === undefined ? cur.join_date : (join_date || null),
       photo === undefined ? cur.photo : (photo || null)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/members/:id/password', auth, adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users SET password_hash=$2 WHERE id=$1 AND role='member'`, [req.params.id, hash]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/members/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query(`DELETE FROM users WHERE id=$1 AND role='member'`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

// ---------- membership inquiries (public form on the website) ----------
app.post('/api/inquiries', async (req, res) => {
  try {
    const { first_name, last_name, email, phone, pin_code } = req.body;
    if (!first_name || !email || !phone) return res.status(400).json({ error: 'First name, email and phone are required' });
    const r = await pool.query(
      `INSERT INTO inquiries (first_name, last_name, email, phone, pin_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [first_name, last_name || '', email, phone, pin_code || '']
    );
    // email the gym owner about the new lead
    const subject = 'New membership inquiry — ' + first_name + ' ' + (last_name || '');
    const body = [
      'New membership inquiry received on the website:',
      '',
      'Name:  ' + first_name + ' ' + (last_name || ''),
      'Email: ' + email,
      'Phone: ' + phone,
      'PIN code: ' + (pin_code || '—'),
    ].join('\n');
    const owner = process.env.SMTP_FROM || process.env.SMTP_USER;
    const nr = await sendEmail(owner, subject, body);
    await logNotif(null, 'email', owner, subject, body, nr.status, nr.error);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/inquiries', auth, adminOnly, async (req, res) => {
  const r = await pool.query('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 200');
  res.json(r.rows);
});

app.put('/api/inquiries/:id', async (req, res) => {
  // used by the join flow to attach the chosen plan and payment mode
  try {
    const { plan_id, pay_mode } = req.body;
    if (!plan_id || !pay_mode) return res.status(400).json({ error: 'Plan and payment mode are required' });
    const r = await pool.query(
      'UPDATE inquiries SET plan_id=$1, pay_mode=$2 WHERE id=$3 RETURNING *',
      [plan_id, pay_mode, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Inquiry not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- Razorpay (online payments, test keys) ----------
const RZP_KEY = process.env.RAZORPAY_KEY_ID || '';
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

app.post('/api/razorpay/order', async (req, res) => {
  try {
    if (!RZP_KEY || !RZP_SECRET) return res.status(400).json({ error: 'Razorpay keys not configured' });
    const p = await pool.query('SELECT * FROM plans WHERE id=$1', [req.body.plan_id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Plan not found' });
    const plan = p.rows[0];
    const amount = Math.round(Number(plan.price) * 100); // paise
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(RZP_KEY + ':' + RZP_SECRET).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: 'jfc-' + (req.body.inquiry_id || 0) + '-' + Date.now(),
        notes: { plan: plan.name },
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Razorpay order failed' });
    const o = await r.json();
    res.json({ order_id: o.id, amount: o.amount, key_id: RZP_KEY, plan });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/razorpay/verify', async (req, res) => {
  try {
    if (!RZP_KEY || !RZP_SECRET) return res.status(400).json({ error: 'Razorpay keys not configured' });
    const { order_id, payment_id, signature, inquiry_id } = req.body;
    if (!order_id || !payment_id || !signature) return res.status(400).json({ error: 'Missing payment details' });
    const expected = crypto.createHmac('sha256', RZP_SECRET).update(order_id + '|' + payment_id).digest('hex');
    if (expected !== signature) return res.status(400).json({ error: 'Payment signature mismatch' });
    if (inquiry_id) {
      const inqR = await pool.query(
        `SELECT i.*, pl.name AS plan_name, pl.price AS plan_price, pl.duration_days
         FROM inquiries i LEFT JOIN plans pl ON pl.id = i.plan_id WHERE i.id=$1`,
        [inquiry_id]
      );
      const inq = inqR.rows[0];
      if (inq) {
        await pool.query(`UPDATE inquiries SET pay_mode='online-paid' WHERE id=$1`, [inquiry_id]);

        // link to an existing member account when the email matches, so the
        // payment shows up in that member's portal and reports
        const mr = await pool.query(`SELECT id FROM users WHERE email=$1 AND role='member'`, [inq.email]);
        if (mr.rows.length) {
          const dup = await pool.query(`SELECT 1 FROM payments WHERE note LIKE $1 LIMIT 1`, ['%' + String(payment_id) + '%']);
          if (!dup.rows.length) {
            await pool.query(
              `INSERT INTO payments (user_id, amount, method, note) VALUES ($1,$2,'upi',$3)`,
              [mr.rows[0].id, Number(inq.plan_price || 0), 'Razorpay online payment — ' + payment_id]
            );
            // extend the membership expiry by the plan duration (same renew rule as admin payments)
            if (inq.duration_days) {
              await pool.query(
                `UPDATE users SET expiry_date = GREATEST(CURRENT_DATE, COALESCE(expiry_date, CURRENT_DATE)) + $1 WHERE id=$2`,
                [inq.duration_days, mr.rows[0].id]
              );
            }
          }
        }

        const confirmMsg = [
          'Hi ' + (inq.first_name || '') + ' ' + (inq.last_name || '') + ',',
          '',
          'Payment received — ₹' + Number(inq.plan_price || 0).toLocaleString('en-IN') + ' (' + (inq.plan_name || 'Membership') + ')',
          'Welcome to Jaini Fitness Center!',
          '',
          'Website: ' + APP_URL,
          'See you at the gym 💪',
        ].join('\n');
        if (inq.email) {
          const r1 = await sendEmail(inq.email, 'Payment confirmation — Jaini Fitness Center', confirmMsg);
          await logNotif(null, 'email', inq.email, 'Payment confirmation', confirmMsg, r1.status, r1.error);
        }
        if (inq.phone) {
          const r2 = await sendWhatsApp(inq.phone, 'Jaini Fitness Center\n\n' + confirmMsg);
          await logNotif(null, 'whatsapp', inq.phone, 'Payment confirmation', confirmMsg, r2.status, r2.error);
        }
      }
    }

    // tell the gym owner by email
    const subject = 'Online payment received — ' + payment_id;
    const body = 'Razorpay payment successful.\nOrder: ' + order_id + '\nPayment ID: ' + payment_id;
    const owner = process.env.SMTP_FROM || process.env.SMTP_USER;
    sendEmail(owner, subject, body).then(nr => logNotif(null, 'email', owner, subject, body, nr.status, nr.error).catch(() => {}));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- plans ----------
app.get('/api/plans', async (req, res) => {  // public: shown on the member website
  const r = await pool.query('SELECT * FROM plans ORDER BY duration_days');
  res.json(r.rows);
});

app.post('/api/plans', auth, adminOnly, async (req, res) => {
  try {
    const { name, duration_days, price } = req.body;
    if (!name || !duration_days || !price) return res.status(400).json({ error: 'Name, days and price are required' });
    const r = await pool.query(
      `INSERT INTO plans (name, duration_days, price) VALUES ($1,$2,$3) RETURNING *`,
      [name, duration_days, price]
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/plans/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM plans WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- trainers ----------
app.get('/api/trainers', async (req, res) => {  // public: shown on the member website
  const r = await pool.query('SELECT * FROM trainers ORDER BY name');
  res.json(r.rows);
});

app.post('/api/trainers', auth, adminOnly, async (req, res) => {
  try {
    const { name, phone, specialty } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const r = await pool.query(
      `INSERT INTO trainers (name, phone, specialty) VALUES ($1,$2,$3) RETURNING *`,
      [name, phone || null, specialty || null]
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/trainers/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM trainers WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- payments ----------
app.get('/api/payments', auth, adminOnly, async (req, res) => {
  const r = await pool.query(
    `SELECT pa.*, u.name AS member_name
     FROM payments pa JOIN users u ON u.id = pa.user_id
     ORDER BY pa.created_at DESC LIMIT 200`
  );
  res.json(r.rows);
});

app.post('/api/payments', auth, adminOnly, async (req, res) => {
  const { user_id, amount, method, note, extend } = req.body;
  try {
    await pool.query('BEGIN');
    const p = await pool.query(
      `INSERT INTO payments (user_id, amount, method, note) VALUES ($1,$2,$3,$4) RETURNING *`,
      [user_id, amount, method || 'cash', note || null]
    );
    // plan renew checkbox: expiry extend kar do
    if (extend) {
      const u = await pool.query(
        `SELECT u.expiry_date, pl.duration_days FROM users u
         LEFT JOIN plans pl ON pl.id = u.plan_id WHERE u.id=$1`, [user_id]);
      if (u.rows[0] && u.rows[0].duration_days) {
        await pool.query(
          `UPDATE users
           SET expiry_date = GREATEST(CURRENT_DATE, COALESCE(expiry_date, CURRENT_DATE)) + $2
           WHERE id=$1`, [user_id, u.rows[0].duration_days]);
      }
    }
    await pool.query('COMMIT');
    // payment ka message member ko bhejo
    const info = await pool.query(
      `SELECT name, email, phone, expiry_date FROM users WHERE id=$1`, [user_id]);
    const mem = info.rows[0];
    if (mem) {
      const payBody = extend && mem.expiry_date
        ? `Payment received: ₹${Number(amount).toLocaleString('en-IN')} (${method || 'cash'}).`
          + `\nMembership valid till: ${mem.expiry_date}.\nKeep going strong!`
        : `Payment received: ₹${Number(amount).toLocaleString('en-IN')} (${method || 'cash'}).`
          + `\nThank you for your payment.`;
      notify(user_id, { email: mem.email, phone: mem.phone }, 'Payment received — Jaini Fitness Center', payBody)
        .catch((e) => console.error('notify fail:', e.message));
    }
    res.json(p.rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/payments/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM payments WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- attendance ----------
app.post('/api/attendance', auth, async (req, res) => {
  try {
    const uid = req.user.role === 'admin' ? Number(req.body.user_id) : req.user.id;
    if (!uid) return res.status(400).json({ error: 'Member is required' });
    const u = await pool.query(`SELECT expiry_date::text AS expiry FROM users WHERE id=$1`, [uid]);
    if (!u.rows.length) return res.status(404).json({ error: 'Member not found' });
    const exp = u.rows[0].expiry; // "YYYY-MM-DD" ya null
    const today = new Date().toISOString().slice(0, 10);
    if (exp && exp < today) return res.status(400).json({ error: 'Membership expired, please renew' });
    const r = await pool.query('INSERT INTO attendance (user_id) VALUES ($1) RETURNING *', [uid]);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/attendance', auth, adminOnly, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const r = await pool.query(
    `SELECT a.*, u.name AS member_name
     FROM attendance a JOIN users u ON u.id = a.user_id
     WHERE a.checkin_at::date = $1
     ORDER BY a.checkin_at DESC`, [date]);
  res.json(r.rows);
});

// ---------- member apna data ----------
app.get('/api/me/detail', auth, async (req, res) => {
  try {
    const u = await pool.query(
      `SELECT u.name, u.email, u.phone, u.join_date, u.expiry_date, u.photo, u.plan_id, u.trainer_id,
              p.name AS plan_name, t.name AS trainer_name
       FROM users u
       LEFT JOIN plans p ON p.id = u.plan_id
       LEFT JOIN trainers t ON t.id = u.trainer_id
       WHERE u.id = $1`, [req.user.id]);
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
app.post('/api/me/photo', auth, async (req, res) => {
  try {
    const { photo } = req.body;
    if (!photo) return res.status(400).json({ error: 'Photo is required' });
    await pool.query(`UPDATE users SET photo=$2 WHERE id=$1`, [req.user.id, photo]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- notifications (admin) ----------
app.get('/api/notifications', auth, adminOnly, async (req, res) => {
  const r = await pool.query(
    `SELECT n.*, u.name AS member_name
     FROM notifications n LEFT JOIN users u ON u.id = n.user_id
     ORDER BY n.created_at DESC LIMIT 100`);
  res.json(r.rows);
});

app.get('/api/notifications/config', auth, adminOnly, (req, res) => {
  res.json({ email: !!mailer, whatsapp: !!(WA_TOKEN && WA_PHONE_ID) });
});

app.post('/api/notifications/:id/resend', auth, adminOnly, async (req, res) => {
  try {
    const n = (await pool.query('SELECT * FROM notifications WHERE id=$1', [req.params.id])).rows[0];
    if (!n || !n.dest) return res.status(404).json({ error: 'Notification or recipient not found' });
    const r = n.channel === 'email'
      ? await sendEmail(n.dest, n.subject, n.body)
      : await sendWhatsApp(n.dest, n.subject + '\n' + n.body);
    if (r.status === 'sent') await pool.query(`UPDATE notifications SET status='sent', error=NULL WHERE id=$1`, [n.id]);
    res.json({ ok: true, status: r.status });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ---------- reports ----------
app.get('/api/reports/summary', auth, adminOnly, async (req, res) => {
  const r = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE role='member') AS total,
      (SELECT count(*)::int FROM users WHERE role='member' AND expiry_date >= CURRENT_DATE) AS active,
      (SELECT count(*)::int FROM users WHERE role='member' AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 7) AS expiring,
      (SELECT count(*)::int FROM users WHERE role='member' AND expiry_date < CURRENT_DATE) AS expired,
      (SELECT COALESCE(sum(amount),0)::float FROM payments WHERE paid_on >= date_trunc('month', CURRENT_DATE)::date) AS month_income,
      (SELECT count(*)::int FROM attendance WHERE checkin_at::date = CURRENT_DATE) AS today_attendance
  `);
  res.json(r.rows[0]);
});

app.listen(PORT, () => console.log('GymFit API chal raha hai port', PORT));

init().catch((e) => { console.error('DB init failed:', e); process.exit(1); });