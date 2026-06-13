import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib";
import { membershipKeysFromUserId } from "@/lib/steamIdentity";

export async function GET() {
  // Avoid TS overload inference problems by casting the function to any
  const session = (await (getServerSession as any)(authOptions)) as { user?: any } | null;
  const rawUserId = String(session?.user?.id ?? "").trim();
  const membershipKeys = membershipKeysFromUserId(rawUserId);

  if (!membershipKeys.length) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const { rows } = await pool.query(
    `SELECT t.team_id, t.name, t.slug, tm.role
     FROM team_memberships tm
     JOIN teams t ON (t.slug = tm.team_id OR t.team_id::text = tm.team_id)
     WHERE tm.steam_id = ANY($1::text[]) AND tm.end_at IS NULL
     ORDER BY t.team_id DESC`,
    [membershipKeys]
  );

  return NextResponse.json({ teams: rows });
}
