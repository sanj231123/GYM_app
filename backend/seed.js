// Creates gym #1 for legacy single-gym volumes and backfills every row that
// predates multi-tenancy with gym_id = 1. Idempotent: running it again (or on
// a fresh install) does the right thing in both cases.
const { pool } = require('./db');

async function seedFirstTenant() {
  const has = await pool.query('SELECT 1 FROM gyms LIMIT 1');
  if (!has.rows.length) {
    const g = await pool.query(
      `INSERT INTO gyms (slug, name, status, address, phone, hours)
       VALUES ($1, $2, 'active', $3, $4, $5) RETURNING id`,
      [
        process.env.SEED_GYM_SLUG || 'jaini',
        process.env.SEED_GYM_NAME || 'Jaini Fitness Center',
        process.env.SEED_GYM_ADDRESS || 'D708 Rashmi Vihar, Vatva, Ahmedabad — 382025',
        process.env.SEED_GYM_PHONE || '+91 97373 80970',
        process.env.SEED_GYM_HOURS || 'Open daily · 6:00 AM – 10:00 PM',
      ]
    );
    console.log('First gym seeded:', g.rows[0].id);
  }

  // backfill: any legacy row (pre-tenancy) belongs to gym #1
  const gym = await pool.query('SELECT id FROM gyms ORDER BY id LIMIT 1');
  const gid = gym.rows[0].id;
  for (const t of ['plans', 'trainers', 'users', 'payments', 'attendance', 'notifications', 'inquiries']) {
    const r = await pool.query(`UPDATE ${t} SET gym_id=$1 WHERE gym_id IS NULL`, [gid]);
    if (r.rowCount) console.log(`backfill ${t}:`, r.rowCount, 'rows -> gym', gid);
  }

  // the existing admin becomes the gym owner
  const admin = await pool.query(`SELECT id FROM users WHERE role='admin' AND gym_id=$1 LIMIT 1`, [gid]);
  if (admin.rows.length) {
    await pool.query(`UPDATE gyms SET owner_user_id=$1 WHERE id=$2 AND owner_user_id IS NULL`,
      [admin.rows[0].id, gid]);
  }
  // gym gets a status/validity if missing
  await pool.query(`UPDATE gyms SET paid_until = now() + interval '1 year' WHERE id=$1 AND paid_until IS NULL AND status='active'`, [gid]);
  await pool.query(`UPDATE gyms SET trial_ends_at = now() + interval '14 days' WHERE id=$1 AND trial_ends_at IS NULL AND status='trial'`, [gid]);
}

module.exports = { seedFirstTenant };