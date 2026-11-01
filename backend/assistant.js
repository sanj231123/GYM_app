// AI assistant for members — answers plan / expiry / payment / timing questions.
// Model: glm-5.3-flash via the ollama.com cloud API (HTTP call only — zero
// local RAM). The member's own data is injected server-side, so the model is
// never asked to look anything up and can never see another member's row.
const express = require('express');
const { pool } = require('./db');
const { auth, checkTenantAuth } = require('./middleware');

const router = express.Router();

const OLLAMA_URL = process.env.OLLAMA_CLOUD_URL || 'https://ollama.com';
const OLLAMA_MODEL = process.env.OLLAMA_CLOUD_MODEL || 'glm-5.3-flash';
const OLLAMA_KEY = process.env.OLLAMA_CLOUD_KEY || '';
const TIMEOUT_MS = 45000;

// ---------- per-user rate limit (in-memory; resets on backend restart) ----------
// Cost control for a cloud key: no member can burn through the quota.
const LIMIT = 25;               // messages
const WINDOW_MS = 60 * 60 * 1000; // per hour
const hits = new Map(); // user_id -> [timestamps]

function rateLimited(userId) {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter(t => now - t < WINDOW_MS);
  if (list.length >= LIMIT) {
    hits.set(userId, list);
    return Math.ceil((list[0] + WINDOW_MS - now) / 60000); // minutes left
  }
  return 0;
}

function countHit(userId) {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(userId, list);
  if (hits.size > 5000) { // safety: drop stale maps if the Map grows unbounded
    for (const [k, v] of hits) {
      if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
}

// ---------- member context (own data only) ----------
async function loadContext(userId, gymId) {
  const u = await pool.query(
    `SELECT u.name, u.email, u.phone, u.join_date, u.expiry_date, u.plan_id, u.trainer_id,
            p.name AS plan_name, p.price AS plan_price, p.duration_days, t.name AS trainer_name
     FROM users u
     LEFT JOIN plans p ON p.id = u.plan_id
     LEFT JOIN trainers t ON t.id = u.trainer_id
     WHERE u.id = $1 AND u.gym_id = $2`, [userId, gymId]);
  if (!u.rows.length) return null;
  const mem = u.rows[0];
  const pays = await pool.query(
    `SELECT amount, method, paid_on FROM payments WHERE user_id=$1 ORDER BY paid_on DESC, id DESC LIMIT 12`, [userId]);
  const stats = await pool.query(`
    SELECT (SELECT count(*)::int FROM attendance WHERE user_id=$1) AS total_visits,
           (SELECT COALESCE(sum(amount),0)::float FROM payments WHERE user_id=$1) AS total_paid`, [userId]);
  return {
    member: mem,
    payments: pays.rows,
    total_visits: stats.rows[0].total_visits,
    total_paid: stats.rows[0].total_paid,
  };
}

// ---------- prompt ----------
function systemPrompt(gym, ctx) {
  const m = ctx.member;
  const daysLeft = m.expiry_date
    ? Math.round((new Date(m.expiry_date + 'T00:00:00') - new Date()) / 86400000)
    : null;
  return `You are the friendly in-app AI assistant of "${gym.name}", a gym. You help the signed-in member with THEIR own membership questions: plan details, expiry, payments, attendance, gym timings, fees and joining info.

MEMBER'S DATA (verified, from the gym database — treat as truth):
- Name: ${m.name}
- Plan: ${m.plan_name || 'no plan assigned'}${m.plan_price != null ? ` (₹${m.plan_price} / ${m.duration_days} days)` : ''}
- Expiry: ${m.expiry_date || 'not set'}${daysLeft !== null ? ` (${daysLeft < 0 ? 'EXPIRED ' + Math.abs(daysLeft) + ' days ago' : daysLeft + ' days left'})` : ''}
- Trainer: ${m.trainer_name || 'none'}
- Joined: ${m.join_date || 'unknown'}
- Total paid: ₹${ctx.total_paid || 0} across ${ctx.payments.length} recorded payments
- Total visits: ${ctx.total_visits}
- Recent payments: ${ctx.payments.length ? ctx.payments.map(p => `₹${p.amount} (${p.method}) on ${p.paid_on}`).join('; ') : 'none yet'}

GYM INFO: hours: ${gym.hours || 'not set'}; address: ${gym.address || 'not set'}; phone: ${gym.phone || 'not set'}; email: ${gym.email || ''}

RULES:
1. Answer ONLY from the data above. If something is not there, say you don't have that info and suggest contacting the gym at ${gym.phone || 'the front desk'}.
2. Never invent fees, offers, timings or promises. Never quote another member's data.
3. You cannot change anything (no plan change, no freeze, no refund). For that, direct them to the gym staff.
4. Payment help (online bill pay) → point to the "Pay Online" button on their dashboard.
5. Match the member's language: Hindi/Hinglish question → reply in natural Hinglish (Roman script); English → English. Keep replies short, warm and clear (2–5 sentences, plain text, no markdown headers or tables).
6. If asked who you are: you are the ${gym.name} assistant, built to help members 24×7.`;
}

// ---------- ollama cloud call ----------
function callModel(messages) {
  const body = JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false, options: { temperature: 0.4, num_ctx: 4096 } });
  return new Promise((resolve) => {
    const url = new URL('/api/chat', OLLAMA_URL);
    const mod = url.protocol === 'http:' ? require('http') : require('https');
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${OLLAMA_KEY}`,
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          const text = j && j.message && j.message.content;
          if (typeof text === 'string' && text.trim()) resolve({ ok: true, text: text.trim() });
          else resolve({ ok: false, error: 'Empty reply from model' });
        } catch { resolve({ ok: false, error: 'Bad reply from model' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Model timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end(body);
  });
}

const clean = (s) => String(s || '').slice(0, 500).trim();
const dateOnly = (v) => (v && typeof v === 'string' ? v.slice(0, 10) : v);

router.post('/assistant', auth, checkTenantAuth, async (req, res) => {
  if (!OLLAMA_KEY) return res.status(503).json({ error: 'Assistant is not set up on this server' });
  if (req.gym && req.gym.status === 'suspended') return res.status(403).json({ error: 'This gym is currently suspended' });

  const wait = rateLimited(req.user.id);
  if (wait) return res.status(429).json({ error: `Daily limit touched — try again in ${wait} minute(s)` });

  const msg = clean(req.body && req.body.message);
  const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-6) : [];
  if (!msg) return res.status(400).json({ error: 'Message is empty' });

  try {
    const ctx = await loadContext(req.user.id, req.gym.id);
    if (!ctx) return res.status(404).json({ error: 'User not found' });

    // trim context dates so the prompt stays small
    ctx.member.expiry_date = dateOnly(ctx.member.expiry_date);
    ctx.member.join_date = dateOnly(ctx.member.join_date);
    ctx.payments = ctx.payments.map(p => ({ ...p, paid_on: dateOnly(p.paid_on) }));

    const gym = req.gym;
    const messages = [
      { role: 'system', content: systemPrompt(gym, ctx) },
      ...history
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .map(h => ({ role: h.role, content: clean(h.content) })),
      { role: 'user', content: msg },
    ];

    countHit(req.user.id);
    const r = await callModel(messages);
    if (!r.ok) {
      console.error(new Date().toISOString(), 'assistant:', r.error);
      return res.status(502).json({ error: 'Assistant is busy right now — please try again in a bit.' });
    }
    res.json({ reply: r.text });
  } catch (e) {
    console.error(new Date().toISOString(), 'assistant error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;