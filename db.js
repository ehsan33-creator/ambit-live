/* Ambit Live — Postgres access. Works with any Postgres (Neon, Supabase, Render, local).
 * Without DATABASE_URL the app still runs; accounts & cloud library are disabled. */
const { Pool } = require("pg");

let pool = null;
const url = process.env.DATABASE_URL;
if (url) {
  pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 5,
  });
  pool.on("error", e => console.error("pg pool error:", e.message));
}

async function init() {
  if (!pool) { console.log("No DATABASE_URL — accounts & cloud library disabled"); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      pass_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assessments (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      questions JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, title)
    );
  `);
  console.log("Database ready");
}

module.exports = { pool: () => pool, init };
