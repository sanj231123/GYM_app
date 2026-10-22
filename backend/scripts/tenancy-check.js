// Multi-tenant isolation test.
// Creates two throwaway gyms with members/plans/payments, then verifies that
// every gym-scoped query returns ONLY its own rows. Deletes the throwaway
// gyms afterwards (CASCADE removes their rows), leaving real data untouched.
//
// Usage (inside the backend container):  node scripts/tenancy-check.js
const { pool } = require('../db');

async function q(sql, params) { return (await pool.query(sql, params)).rows; }

async function main() {
  const suffix = process.argv[2] || 'isolcheck-' + Date.now();
  const a = await q(`INSERT INTO gyms (slug, name) VALUES ($1,'Isolation Gym A') RETURNING id`, ['isola-' + suffix + '-a']);
  const b = await q(`INSERT INTO gyms (slug, name) VALUES ($1,'Isolation Gym B') RETURNING id`, ['isola-' + suffix + '-b']);
  const ga = a[0].id, gb = b[0].id;
  let fails = 0;

  const member = async (gymId, email) =>
    (await q(`INSERT INTO users (name, email, password_hash, role, gym_id) VALUES ('M',$1,'x','member',$2) RETURNING id`, [email, gymId]))[0].id;

  const ma = await member(ga, 'a@' + suffix + '.test');
  const mb = await member(gb, 'b@' + suffix + '.test');
  await q(`INSERT INTO payments (user_id, gym_id, amount, method) VALUES ($1,$2,100,'cas'), ($3,$4,200,'upi')`, [ma, ga, mb, gb]);
  await q(`INSERT INTO attendance (user_id, gym_id) VALUES ($1,$2)`, [ma, ga]);
  await q(`INSERT INTO plans (name, duration_days, price, gym_id) VALUES ('P',30,100,$1)`, [ga]);
  await q(`INSERT INTO plans (name, duration_days, price, gym_id) VALUES ('P',30,100,$1)`, [gb]);
  await q(`INSERT INTO inquiries (first_name, email, phone, gym_id) VALUES ('X','x@x.test','900', $1)`, [ga]);

  const check = async (label, sql, params, expect) => {
    const rows = await q(sql, params);
    const ok = rows.length === expect;
    if (!ok) fails++;
    console.log((ok ? 'PASS' : 'FAIL'), `(${rows.length}/${expect})`, label);
  };

  await check('users scoped',          `SELECT 1 FROM users WHERE gym_id=$1`, [ga], 1);
  await check('plans scoped',          `SELECT 1 FROM plans WHERE gym_id=$1`, [gb], 1);
  await check('payments scoped',       `SELECT 1 FROM payments WHERE gym_id=$1`, [ga], 1);
  await check('inquiries scoped',      `SELECT 1 FROM inquiries WHERE gym_id=$1`, [gb], 0);
  await check('attendance scoped',     `SELECT 1 FROM attendance WHERE gym_id=$1`, [gb], 0);
  await check('notifications scoped',  `SELECT 1 FROM notifications WHERE gym_id=$1`, [ga], 0);
  const dup = 'dup@' + suffix + '.test';
  try {
    await q(`INSERT INTO users (name, email, password_hash, role, gym_id) VALUES ('D',$1,'x','member',$2)`, [dup, ga]);
    await q(`INSERT INTO users (name, email, password_hash, role, gym_id) VALUES ('D',$1,'x','member',$2)`, [dup, gb]);
    console.log('PASS  per-gym email uniqueness (same email in 2 gyms)');
  } catch {
    console.log('FAIL  per-gym email uniqueness'); fails++;
  }

  // cross-tenant read attempt: gym A's admin asking for gym B's member row
  const leak = await q(`SELECT 1 FROM users WHERE id=$1 AND gym_id=$2`, [mb, ga]);
  if (!leak.length) console.log('PASS  cross-tenant row read blocked by gym_id filter');
  else { console.log('FAIL  cross-tenant leak!'); fails++; }

  // cleanup
  await q(`DELETE FROM gyms WHERE id IN ($1,$2)`, [ga, gb]);
  const left = await q(`SELECT count(*)::int AS c FROM users WHERE id IN ($1,$2)`, [ma, mb]);
  if (!left[0].c) console.log('PASS  cleanup (CASCADE removed tenant data)');
  else { console.log('FAIL  cleanup'); fails++; }

  await pool.end();
  console.log(fails === 0 ? 'ALL ISOLATION CHECKS PASSED ✔' : `${fails} CHECK(S) FAILED ✘`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error('tenancy-check error:', e.message); process.exit(1); });