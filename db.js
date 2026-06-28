// Single shared PostgreSQL connection pool, reused across all route files.
// Render's free PostgreSQL gives you a connection string (DATABASE_URL) —
// the pg library reads that directly, no separate host/port/user config
// needed.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's free Postgres requires SSL but uses a self-signed-style cert
  // chain that Node doesn't trust by default — this is the standard,
  // documented way to connect to it, not a security shortcut.
  ssl: process.env.DATABASE_URL?.includes("render.com") || process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = pool;
