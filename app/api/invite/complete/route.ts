import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib";

function getMembershipKey(rawId: string) {
  if (rawId.startsWith("user:")) return rawId.slice(5);
  if (rawId.startsWith("steam:")) return rawId.slice(6);
  return rawId;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const rawUserId = String((session?.user as { id?: string } | undefined)?.id ?? "");
  const membershipKey = getMembershipKey(rawUserId);
  if (!membershipKey) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const codeHash = String(req.cookies.get("pending_invite")?.value ?? "").trim();
  if (!codeHash) {
    return NextResponse.json({ error: "Missing pending invite" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const invRes = await client.query(
      `SELECT team_id, expires_at, max_uses, uses
       FROM invite_codes
       WHERE code_hash = $1
       FOR UPDATE`,
      [codeHash]
    );

    if (invRes.rows.length === 0) {
      await client.query("ROLLBACK");
      const res = NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
      res.cookies.set("pending_invite", "", { path: "/", maxAge: 0 });
      return res;
    }

    const inv = invRes.rows[0];
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      const res = NextResponse.json({ error: "Invite expired" }, { status: 403 });
      res.cookies.set("pending_invite", "", { path: "/", maxAge: 0 });
      return res;
    }

    const uses = Number(inv.uses);
    const maxUses = Number(inv.max_uses);
    if (Number.isFinite(uses) && Number.isFinite(maxUses) && uses >= maxUses) {
      await client.query("ROLLBACK");
      const res = NextResponse.json({ error: "Invite used up" }, { status: 403 });
      res.cookies.set("pending_invite", "", { path: "/", maxAge: 0 });
      return res;
    }

    const teamId = String(inv.team_id);
    const teamLookup = await client.query(
      `SELECT slug FROM teams WHERE team_id::text = $1 LIMIT 1`,
      [teamId]
    );
    const teamSlug = String(teamLookup.rows[0]?.slug ?? "").trim();
    if (!teamSlug) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invite team not found" }, { status: 404 });
    }

    const existingMembership = await client.query(
      `SELECT 1
       FROM team_memberships
       WHERE team_id = $1 AND steam_id = $2 AND end_at IS NULL
       LIMIT 1`,
      [teamSlug, membershipKey]
    );

    if (existingMembership.rows.length === 0) {
      await client.query(
        `INSERT INTO team_memberships (team_id, steam_id, role, start_at)
         VALUES ($1, $2, $3, now())`,
        [teamSlug, membershipKey, "player"]
      );

      await client.query(
        `UPDATE invite_codes SET uses = uses + 1 WHERE code_hash = $1`,
        [codeHash]
      );
    }

    await client.query("COMMIT");

    const res = NextResponse.json({ ok: true, teamId, teamSlug });
    res.cookies.set("pending_invite", "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    client.release();
  }
}