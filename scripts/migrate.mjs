import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing. Set it before running this script.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

try {
  console.log("Running migrations from db/migrations ...");
  await migrate(db, { migrationsFolder: "db/migrations" });
  console.log("✅ Migrations applied.");
} catch (e) {
  console.error("❌ Migration failed:", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}