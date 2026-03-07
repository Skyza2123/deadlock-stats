import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL missing.");
  process.exit(1);
}

const pool = new Pool({ connectionString });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_matches (
      steam_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (steam_id, match_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS saved_matches_steam_created_idx
    ON saved_matches (steam_id, created_at DESC)
  `);

  console.log("saved_matches table ensured");
} finally {
  await pool.end();
}
