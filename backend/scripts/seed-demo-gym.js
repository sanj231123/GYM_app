// Creates a throwaway demo gym with sample members, plans, payments and
// attendance — useful for sales walkthroughs on a live deployment.
// Usage:
//   docker compose exec backend node scripts/seed-demo-gym.js [password]
// Prints the demo login details and cleans up nothing — delete the gym from
// the platform admin panel (data goes with it via CASCADE).
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const DEMO_SLUG = 'demo-fit';

async function main() {
  const password = process.argv[2] || 'demoPass2026';
  const client = await pool.connect();
  let tx = false;
  try {
    const existing = await client.query('SELECT id FROM gyms WHERE slug=$1', [DEMO_SLUG]);
    if (existing.rows.length) {
      console.log('Demo gym already exists — logging in again with the same password.');
      console.log('URL: /g/' + DEMO_SLUG + '  ·  login demo@demo.example / ' + password);
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    await client.query('BEGIN');
    tx = true;
    const g = await client.query(
      `INSERT INTO gyms (slug, name, address, phone, hours, primary_color, status, trial_ends_at, settings)
       VALUES ($1,$2,$3,$4,$5,$6,'trial', now() + interval '30 days', '{}'::jsonb) RETURNING id, name`,
      [DEMO_SLUG, 'Demo Fit Gym', '12 Sample Street, Demo City 000000', '+91 90000 00000', 'Open daily · 6:00 AM – 10:00 PM', '#e11d48']
    );
    const gymId = g.rows[0].id;
    const owner = await client.query(
      `INSERT INTO users (name, email, phone, password_hash, role, gym_id, join_date)
       VALUES ($1,$2,$3,$4,'admin',$5,CURRENT_DATE) RETURNING id`,
      ['Demo Owner', 'demo@demo.example', '+91 90000 00000', hash, gymId]
    );
    await client.query('UPDATE gyms SET owner_user_id=$1 WHERE id=$2', [owner.rows[0].id, gymId]);

    const plans = await client.query(
      `INSERT INTO plans (name, price, duration_days, gym_id)
       VALUES
       ('Demo Monthly', 999, 30, $1),
       ('Demo Quarterly', 2699, 90, $1),
       ('Demo Annual', 8999, 365, $1) RETURNING id`,
      [gymId]
    );
    await client.query(
      `INSERT INTO trainers (name, specialty, phone, gym_id)
       VALUES ('Ravi Demo', 'Strength & conditioning', '+91 90000 00001', $1),
              ('Neha Demo', 'Yoga & mobility', '+91 90000 00002', $1)`,
      [gymId]
    );
    const members = [];
    for (const [name, email] of [
      ['Asha Demo', 'asha@demo.example'],
      ['Bilal Demo', 'bilal@demo.example'],
      ['Chetan Demo', 'chetan@demo.example'],
      ['Divya Demo', 'divya@demo.example'],
      ['Eshan Demo', 'eshan@demo.example'],
    ]) {
      const m = await client.query(
        `INSERT INTO users (name, email, password_hash, role, gym_id, join_date)
         VALUES ($1,$2,$3,'member',$4, CURRENT_DATE - (random() * 120)::int) RETURNING id`,
        [name, email, hash, gymId]
      );
      members.push(m.rows[0].id);
    }
    // plans + attendance + a sample payment for the demo dashboard
    for (let i = 0; i < members.length; i++) {
      await client.query(
        `UPDATE users SET plan_id=$1 WHERE id=$2`,
        [plans.rows[i % plans.rows.length].id, members[i]]
      );
      await client.query(
        `INSERT INTO attendance (user_id, checkin_at, gym_id)
         SELECT $1, now() - ($2 || ' days')::interval, $3 FROM generate_series(1, 5) s`,
        [members[i], i * 3, gymId]
      );
      if (i < 3) {
        await client.query(
          `INSERT INTO payments (user_id, amount, method, note, paid_on, gym_id)
           VALUES ($1, $2, $3, 'demo plan', CURRENT_DATE - ($4 || ' days')::interval, $5)`,
          [members[i], 999 + i * 500, i === 0 ? 'online' : 'cash', i * 10 + 2, gymId]
        );
      }
    }
    await client.query('COMMIT');
    console.log('Demo gym created: gym #' + gymId);
    console.log('Website: /g/' + DEMO_SLUG);
    console.log('Admin login: demo@demo.example / ' + password);
  } catch (e) {
    if (tx) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => { console.error('Failed:', e.message); process.exit(1); }
);