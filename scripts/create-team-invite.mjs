import crypto from "crypto";
import pg from "pg";

const { Pool } = pg;
const url = process.env.DATABASE_URL;

const teamId = process.argv[2];
const code = process.argv[3];
const maxUses = Number(process.argv[4] || 25);
const days = Number(process.argv[5] || 30);

if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}
if (!teamId || !code) {
  console.log('Usage: node scripts/create-team-invite.mjs <teamId> "CODE" [maxUses] [days]');
  process.exit(1);
}

const codeHash = crypto.createHash("sha256").update(code.trim()).digest("hex");
const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const pool = new Pool({ connectionString: url });

await pool.query(
  `INSERT INTO invite_codes (code_hash, team_id, expires_at, max_uses, uses, note)
   VALUES ($1, $2, $3, $4, 0, $5)
   ON CONFLICT (code_hash) DO NOTHING`,
  [codeHash, teamId, expiresAt, maxUses, `Team invite ${code}`]
);

await pool.end();
console.log("✅ Invite created for team", teamId, "code:", code);