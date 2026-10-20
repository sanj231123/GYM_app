// GymFit backend API
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool, types } = require('pg');

// DATE (oid 1082) ko simple "YYYY-MM-DD" string me lo (timezone ka jhanjhat khatam)
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'gymfit_dev_secret_change_me';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ---------- helpers ----------
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  plan_id: u.plan_id, trainer_id: u.trainer_id, join_date: u.join_date, expiry_date: u.expiry_date,
});

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Pehle login karein' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session khatam ho gaya, dobara login karein' });
  }
  next();
}

const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Sirf admin ke liye hai' });

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

// ---------- auth routes ----------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [(email || '').toLowerCase().trim()]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
      return res.status(401).json({ error: 'Email ya password galat hai' });
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
    if (!name || !email || !password) return res.status(400).json({ error: 'Naam, email aur password zaroori hai' });
    const d = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (d.rows.length) return res.status(400).json({ error: 'Ye email pehle se hai, login karein' });
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
  if (!r.rows.length) return res.status(404).json({ error: 'User nahi mila' });
  res.json(publicUser(r.rows[0]));
});

// password khud badalna
app.post('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Kam se kam 6 letter ka password do' });
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
    `SELECT u.id, u.name, u.email, u.phone, u.join_date, u.expiry_date,
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
    const { name, email, phone, password, plan_id, trainer_id, expiry_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Naam zaroori hai' });
    if (email) {
      const d = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
      if (d.rows.length) return res.status(400).json({ error: 'Ye email pehle se hai' });
    }
    let expiry = expiry_date || null;
    if (!expiry && plan_id) {
      const pl = await pool.query('SELECT duration_days FROM plans WHERE id=$1', [plan_id]);
      expiry = pl.rows[0] ? new Date(Date.now() + pl.rows[0].duration_days * 86400000)
        .toISOString().slice(0, 10) : null;
    }
    const hash = await bcrypt.hash(password || 'gym123', 10);
    const r = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, plan_id, trainer_id, join_date, expiry_date)
       VALUES ($1,$2,$3,$4,'member',$5,$6,CURRENT_DATE,$7) RETURNING id`,
      [name.trim(), email ? email.toLowerCase().trim() : null, phone || null, hash,
       plan_id || null, trainer_id || null, expiry]
    );
    res.json({ id: r.rows[0].id });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/members/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, plan_id, trainer_id, expiry_date, join_date } = req.body;
    await pool.query(
      `UPDATE users SET
         name    = COALESCE($2, name),
         email   = $3,
         phone   = $4,
         plan_id    = $5,
         trainer_id = $6,
         expiry_date = $7,
         join_date   = COALESCE($8, join_date)
       WHERE id=$1 AND role='member'`,
      [req.params.id,
       name || null,
       email === '' ? null : (email || null),
       phone === '' ? null : (phone || null),
       plan_id || null,
       trainer_id || null,
       expiry_date || null,
       join_date || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/members/:id/password', auth, adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password bhejo' });
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

// ---------- plans ----------
app.get('/api/plans', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM plans ORDER BY duration_days');
  res.json(r.rows);
});

app.post('/api/plans', auth, adminOnly, async (req, res) => {
  try {
    const { name, duration_days, price } = req.body;
    if (!name || !duration_days || !price) return res.status(400).json({ error: 'Naam, din aur rate chahiye' });
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
app.get('/api/trainers', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM trainers ORDER BY name');
  res.json(r.rows);
});

app.post('/api/trainers', auth, adminOnly, async (req, res) => {
  try {
    const { name, phone, specialty } = req.body;
    if (!name) return res.status(400).json({ error: 'Naam zaroori hai' });
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
    if (!uid) return res.status(400).json({ error: 'Member batao' });
    const u = await pool.query(`SELECT expiry_date::text AS expiry FROM users WHERE id=$1`, [uid]);
    if (!u.rows.length) return res.status(404).json({ error: 'Member nahi mila' });
    const exp = u.rows[0].expiry; // "YYYY-MM-DD" ya null
    const today = new Date().toISOString().slice(0, 10);
    if (exp && exp < today) return res.status(400).json({ error: 'Membership expire ho gayi hai, pehle renew karayein' });
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
      `SELECT u.name, u.email, u.phone, u.join_date, u.expiry_date, u.plan_id, u.trainer_id,
              p.name AS plan_name, t.name AS trainer_name
       FROM users u
       LEFT JOIN plans p ON p.id = u.plan_id
       LEFT JOIN trainers t ON t.id = u.trainer_id
       WHERE u.id = $1`, [req.user.id]);
    if (!u.rows.length) return res.status(404).json({ error: 'User nahi mila' });
    const pays = await pool.query(
      `SELECT id, amount, method, paid_on FROM payments WHERE user_id=$1 ORDER BY paid_on DESC, id DESC`, [req.user.id]);
    const att = await pool.query(
      `SELECT id, checkin_at FROM attendance WHERE user_id=$1 ORDER BY checkin_at DESC LIMIT 10`, [req.user.id]);
    const tdy = await pool.query(
      `SELECT count(*)::int AS c FROM attendance WHERE user_id=$1 AND checkin_at::date = CURRENT_DATE`, [req.user.id]);
    res.json({ ...u.rows[0], payments: pays.rows, attendance: att.rows, checked_today: tdy.rows[0].c });
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

init().catch((e) => { console.error('DB init fail hua:', e); process.exit(1); });