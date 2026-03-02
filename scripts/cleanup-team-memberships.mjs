import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const pool = new Pool({ connectionString });

try {
  const before = await pool.query(
    `SELECT team_id, steam_id, COUNT(*)::int AS active_count
     FROM team_memberships
     WHERE end_at IS NULL
     GROUP BY team_id, steam_id
     HAVING COUNT(*) > 1
     ORDER BY active_count DESC, team_id, steam_id`
  );

  console.log(`Duplicate active memberships before cleanup: ${before.rowCount}`);

  await pool.query("BEGIN");

  await pool.query(
    `WITH ranked AS (
       SELECT ctid,
              ROW_NUMBER() OVER (
                PARTITION BY team_id, steam_id
                ORDER BY COALESCE(start_at, to_timestamp(0)) DESC
              ) AS rn
       FROM team_memberships
       WHERE end_at IS NULL
     )
     UPDATE team_memberships tm
     SET end_at = now()
     FROM ranked r
     WHERE tm.ctid = r.ctid
       AND r.rn > 1`
  );

  await pool.query("COMMIT");

  const after = await pool.query(
    `SELECT team_id, steam_id, COUNT(*)::int AS active_count
     FROM team_memberships
     WHERE end_at IS NULL
     GROUP BY team_id, steam_id
     HAVING COUNT(*) > 1`
  );

  console.log(`Duplicate active memberships after cleanup: ${after.rowCount}`);
  console.log("✅ Cleanup completed");
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  console.error("Cleanup failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
