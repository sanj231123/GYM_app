// shared Postgres pool + type settings (used by server.js, migrate.js and scripts)
const { Pool, types } = require('pg');

// DATE columns (oid 1082) arrive as plain strings, avoiding timezone conversion
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool };