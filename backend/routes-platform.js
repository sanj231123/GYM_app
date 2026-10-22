// Platform routes — self-signup (gym registration) + platform-admin management.
// Mounted at /api/platform. Registration is public (rate-limited); everything
// else requires role='platform_admin'.
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { auth } = require('./middleware');

const JWT_SECRET = process.env.JWT_SECRET || '';
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 14);

const RESERVED_SLUGS = [
  'www', 'admin', 'api', 'app', 'platform', 'signup', 'register', 'mail',
  'smtp', 'ftp', 'ns1', 'ns2', 'support', 'help', 'blog', 'dev', 'test',
  'staging', 'demo', 'billing', 'status', 'docs', 'login', 'account',
];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

const platformAdminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'platform_admin' || req.user.role === 'admin' && !req.user.gym_id)) return next();
  return res.status(403).json({ error: 'Platform admin access required' });
};

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
});

const router = express.Router();

// ---------- public ----------
router.get('/config', (req, res) => res.json({ trial_days: TRIAL_DAYS }));
router.get('/slug-available', async (req, res) => {
  try {
    const slug = String(req.query.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return res.json({ available: false, reason: 'Use 2-30 lowercase letters, numbers or dashes' });
    if (RESERVED_SLUGS.includes(slug)) return res.json({ available: false, reason: 'This address is reserved' });
    const r = await pool.query('SELECT 1 FROM gyms WHERE slug=$1', [slug]);
    res.json({ available: !r.rows.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/register-gym', signupLimiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const { gym_name, slug, owner_name, email, password } = req.body || {};
    if (!gym_name || !slug || !owner_name || !email || !password) {
      return res.status(400).json({ error: 'Gym name, address, owner name, email and password are required' });
    }
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const s = String(slug).trim().toLowerCase();
    if (!SLUG_RE.test(s)) return res.status(400).json({ error: 'Use 2-30 lowercase letters, numbers or dashes' });
    if (RESERVED_SLUGS.includes(s)) return res.status(400).json({ error: 'This address is reserved' });
    const mail = String(email).toLowerCase().trim();

    await client.query('BEGIN');
    const taken = await client.query('SELECT 1 FROM gyms WHERE slug=$1 FOR UPDATE', [s]);
    if (taken.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This gym address is already taken' }); }

    const trialEnds = `now() + interval '${Math.max(1, Math.min(60, TRIAL_DAYS))} days'`;
    const g = await client.query(
      `INSERT INTO gyms (slug, name, status, trial_ends_at) VALUES ($1,$2,'trial', ${trialEnds}) RETURNING *`,
      [s, String(gym_name).trim()]
    );
    const gym = g.rows[0];

    const dup = await client.query('SELECT id FROM users WHERE email=$1 AND gym_id=$2', [mail, gym.id]);
    if (dup.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This email already exists, please login' }); }

    const hash = await bcrypt.hash(String(password), 12);
    const u = await client.query(
      `INSERT INTO users (name, email, password_hash, role, gym_id) VALUES ($1,$2,$3,'admin',$4) RETURNING id`,
      [String(owner_name).trim(), mail, hash, gym.id]
    );
    await client.query('UPDATE gyms SET owner_user_id=$1 WHERE id=$2', [u.rows[0].id, gym.id]);

    // starter plans so the dashboard is usable from minute one
    await client.query(
      `INSERT INTO plans (name, duration_days, price, gym_id) VALUES
       ('Monthly', 30, 1500, $1), ('Quarterly', 90, 4000, $1), ('Yearly', 365, 12000, $1)`,
      [gym.id]
    );
    await client.query('COMMIT');

    res.json({ ok: true, gym: { slug: gym.slug, name: gym.name }, trial_days: TRIAL_DAYS });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ---------- platform admin (role platform_admin) ----------
router.use(auth, platformAdminOnly);

router.get('/gyms', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT g.id, g.slug, g.name, g.status, g.trial_ends_at, g.paid_until, g.created_at,
             (SELECT count(*)::int FROM users u WHERE u.gym_id = g.id AND u.role='member') AS members,
             (SELECT COALESCE(sum(p.amount),0)::float FROM payments p WHERE p.gym_id = g.id) AS revenue
      FROM gyms g ORDER BY g.created_at DESC`);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.get('/gyms/:id/detail', async (req, res) => {
  try {
    const g = await pool.query('SELECT id, slug, name, status, trial_ends_at, paid_until, created_at FROM gyms WHERE id=$1', [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ error: 'Gym not found' });
    const owner = await pool.query(
      `SELECT name, email FROM users WHERE id = (SELECT owner_user_id FROM gyms WHERE id=$1)`, [req.params.id]);
    res.json({ ...g.rows[0], owner: owner.rows[0] || null });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.put('/gyms/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'suspended', 'trial'].includes(status)) return res.status(400).json({ error: 'Unknown status' });
    const r = await pool.query('UPDATE gyms SET status=$1 WHERE id=$2 RETURNING id, slug, status', [status, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Gym not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// manual "mark paid" — the platform owner confirms money received offline
router.post('/gyms/:id/mark-paid', async (req, res) => {
  try {
    const months = Number((req.body || {}).months || 1);
    if (!months || months < 1 || months > 24) return res.status(400).json({ error: 'Months must be 1-24' });
    const r = await pool.query(
      `UPDATE gyms SET status='active',
         paid_until = GREATEST(COALESCE(paid_until, now()), now()) + ($1 || ' months')::interval
       WHERE id=$2 RETURNING id, slug, status, paid_until`,
      [Math.trunc(months), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Gym not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;