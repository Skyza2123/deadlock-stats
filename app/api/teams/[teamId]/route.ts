import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib";

export async function GET(_req: Request, ctx: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await ctx.params;

  const session = (await getServerSession(authOptions as any)) as Session | null;
  const steamId = (session?.user as any)?.id as string | undefined;

  if (!steamId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const mem = await pool.query(
    `SELECT role
     FROM team_memberships
     WHERE team_id = $1 AND steam_id = $2 AND end_at IS NULL
     LIMIT 1`,
    [teamId, steamId]
  );

  if (mem.rows.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const team = await pool.query(
    `SELECT team_id, name, slug, created_at
     FROM teams
     WHERE team_id::text = $1
     LIMIT 1`,
    [teamId]
  );

  return NextResponse.json({ team: team.rows[0] ?? null, role: mem.rows[0].role });
}