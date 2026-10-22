// shared auth + rate-limit + error middleware
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || '';
const COOKIE_NAME = 'gym_token';

// Bearer header or the HttpOnly login cookie (transition: both accepted)
function readToken(cookieHeader) {
  try {
    const pair = (cookieHeader || '').split('; ').find((x) => x.startsWith(COOKIE_NAME + '='));
    return pair ? decodeURIComponent(pair.split('=').slice(1).join('=')) : '';
  } catch { return ''; }
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const token = bearer || readToken(req.headers.cookie || '');
  if (!token) return res.status(401).json({ error: 'Please login first' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
  next();
}

const adminOnly = (req, res, next) =>
  req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' });

// sets the HttpOnly session cookie (used by login / register / reset)
function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`
  );
}

function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

// ---------- multi-tenancy ----------
// Resolves the gym for this request. Priority:
//   1. x-gym-slug header (set by the SPA on the /g/:slug path fallback)
//   2. subdomain <slug>.PLATFORM_DOMAIN (or any <slug>.localhost in dev)
//   3. single-gym fallback — until more gyms exist, the only gym serves
//      the bare domain too (localhost, jainifitness.test)
async function resolveTenant(req, res, next) {
  let slug = (req.get('x-gym-slug') || '').trim().toLowerCase();
  if (!slug) {
    const raw = (req.get('host') || '').toLowerCase().split(':')[0];
    const plat = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase();
    if (raw.endsWith('.localhost')) slug = raw.slice(0, -('.localhost'.length));
    else if (plat && raw !== plat && raw.endsWith('.' + plat)) slug = raw.slice(0, -(plat.length + 1));
  }
  try {
    let gym = null;
    if (slug) {
      gym = await pool.query('SELECT * FROM gyms WHERE slug=$1', [slug]);
      if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
    } else {
      const c = await pool.query('SELECT count(*)::int AS c FROM gyms');
      if (c.rows[0].c === 1) gym = await pool.query('SELECT * FROM gyms LIMIT 1');
    }
    if (gym && gym.rows[0]) {
      req.gym = gym.rows[0];
      if (req.gym.status === 'suspended') return res.status(403).json({ error: 'This gym is currently suspended' });
    }
    next();
  } catch (e) { next(e); }
}

// after auth: a signed-in account may only act inside its own gym
function checkTenantAuth(req, res, next) {
  if (req.gym && req.user && req.user.gym_id && req.user.gym_id !== req.gym.id) {
    return res.status(403).json({ error: 'Account does not belong to this gym' });
  }
  next();
}

// ---------- rate-limit tiers ----------
const limiter = ({ windowMs, max, skip }) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, skip });

const globalLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 300 });
const authLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 10 });
const inquiryLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 20 });
const razorpayLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 30 });

const notFound = (req, res) => res.status(404).json({ error: 'Not found' });

// global error handler — never leak a stack trace to the client
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  console.error(new Date().toISOString(), 'error:', (err && err.message) || err);
  res.status(500).json({ error: 'Server error' });
}

module.exports = {
  auth, adminOnly, setAuthCookie, clearAuthCookie,
  resolveTenant, checkTenantAuth,
  globalLimiter, authLimiter, inquiryLimiter, razorpayLimiter,
  notFound, errorHandler, COOKIE_NAME,
};