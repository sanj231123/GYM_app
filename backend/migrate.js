// Runs every SQL file in backend/migrations in filename order, once each.
// Applied files are recorded in a "schema_migrations" table, so re-running
// the app (or a second container) applies nothing twice.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now()
    )`);
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return; // no migrations yet — nothing to do
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
    if (done.rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log('migration applied:', name);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('migration FAILED:', name, e.message);
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = { migrate };