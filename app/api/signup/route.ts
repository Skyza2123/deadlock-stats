import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { pool } from "@/db"; // use your actual pool export
// If you don't have a pool export, tell me your db/index.ts and I’ll match it.

function hashInvite(code: string) {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

export async function POST(req: Request) {
  const { email, password, displayName, inviteCode } = await req.json();

  if (!email || !password || !inviteCode) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const normEmail = String(email).trim().toLowerCase();
  const codeHash = hashInvite(String(inviteCode));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock invite row so uses can't race
    const invRes = await client.query(
      `SELECT code_hash, team_id, expires_at, max_uses, uses
       FROM invite_codes
       WHERE code_hash = $1
       FOR UPDATE`,
      [codeHash]
    );

    if (invRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
    }

    const inv = invRes.rows[0];

    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invite expired" }, { status: 403 });
    }
    if (Number(inv.uses) >= Number(inv.max_uses)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invite used up" }, { status: 403 });
    }

    // Create user
    const passwordHash = await bcrypt.hash(String(password), 12);

    const userRes = await client.query(
      `INSERT INTO app_users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email`,
      [normEmail, passwordHash, displayName ?? null]
    );

    // Burn one use
    await client.query(
      `UPDATE invite_codes SET uses = uses + 1 WHERE code_hash = $1`,
      [codeHash]
    );

    // Add membership
    // Your team_memberships schema uses team slug in team_id.
    // For credentials users, use userId as steam_id surrogate.
    const userId = String(userRes.rows[0].id);
    const teamLookup = await client.query(
      `SELECT slug FROM teams WHERE team_id::text = $1 LIMIT 1`,
      [String(inv.team_id)]
    );
    const teamSlug = String(teamLookup.rows[0]?.slug ?? "").trim();
    if (!teamSlug) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invite team not found" }, { status: 404 });
    }

    await client.query(
      `INSERT INTO team_memberships (team_id, steam_id, role, start_at)
       VALUES ($1, $2, $3, now())`,
      [teamSlug, userId, "player"]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    await client.query("ROLLBACK");
    if (e?.code === "23505") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    client.release();
  }
}