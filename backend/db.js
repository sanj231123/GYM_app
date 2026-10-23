// shared Postgres pool + type settings (used by server.js, migrate.js and scripts)
const { Pool, types } = require('pg');

// DATE columns (oid 1082) arrive as plain strings, avoiding timezone conversion
types.setTypeParser(1082, (v) => v);

// Pool sized for high concurrency: PGPOOL_MAX client connections with
// bounded wait time, so a sudden login burst queues briefly instead of
// stalling forever (Postgres still caps total connections at its own max).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX || 25),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

module.exports = { pool };