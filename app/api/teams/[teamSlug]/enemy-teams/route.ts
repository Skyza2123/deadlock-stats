import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { db, pool } from "@/lib";
import { authOptions } from "@/lib/auth";
import { teamMemberships, teams } from "@/db/schema";

function extractMembershipKey(session: { user?: { id?: string } } | null) {
  const rawUserId = String(session?.user?.id ?? "").trim();
  if (!rawUserId) return "";
  if (rawUserId.startsWith("steam:")) return rawUserId.slice(6).trim();
  if (rawUserId.startsWith("user:")) return rawUserId.slice(5).trim();
  if (rawUserId.includes(":")) return "";
  return rawUserId;
}

function isAdminSession(session: { user?: { email?: string | null; isAdmin?: boolean } } | null) {
  if (Boolean(session?.user?.isAdmin)) return true;
  const adminEmail = String(process.env.AUTH_EMAIL ?? "").trim().toLowerCase();
  const tempAdminEmail = String(process.env.TEMP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const sessionEmail = String(session?.user?.email ?? "").trim().toLowerCase();
  return Boolean(sessionEmail) && (sessionEmail === adminEmail || sessionEmail === tempAdminEmail);
}

async function ensureEnemyTeamsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS team_enemy_teams (
      enemy_id BIGSERIAL PRIMARY KEY,
      team_slug TEXT NOT NULL,
      enemy_name TEXT NOT NULL,
      enemy_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS team_enemy_teams_key_unique
     ON team_enemy_teams (team_slug, enemy_key)`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS team_enemy_teams_slug_idx
     ON team_enemy_teams (team_slug, created_at DESC)`
  );
}

async function canViewTeam(teamSlug: string, session: { user?: { id?: string; email?: string | null; isAdmin?: boolean } } | null) {
  if (isAdminSession(session)) return true;

  const membershipKey = extractMembershipKey(session);
  if (!membershipKey) return false;

  const membershipRows = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(
      and(
        sql`(
          ${teamMemberships.teamId} = ${teamSlug}
          OR ${teamMemberships.teamId} IN (
            SELECT ${teams.teamId}::text FROM ${teams} WHERE ${teams.slug} = ${teamSlug}
          )
        )`,
        eq(teamMemberships.steamId, membershipKey),
        isNull(teamMemberships.endAt)
      )
    )
    .limit(1);

  return membershipRows.length > 0;
}

export async function GET(_req: Request, ctx: { params: Promise<{ teamSlug: string }> }) {
  const { teamSlug } = await ctx.params;
  const normalizedTeamSlug = String(teamSlug ?? "").trim();
  if (!normalizedTeamSlug) {
    return NextResponse.json({ ok: false, error: "Missing team slug" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const allowed = await canViewTeam(normalizedTeamSlug, session as any);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureEnemyTeamsTable();

  const { rows } = await pool.query(
    `SELECT enemy_name
     FROM team_enemy_teams
     WHERE team_slug = $1
     ORDER BY created_at DESC, enemy_name ASC`,
    [normalizedTeamSlug]
  );

  const enemyTeams = rows
    .map((row) => String(row.enemy_name ?? "").trim())
    .filter((name) => Boolean(name));

  return NextResponse.json({ ok: true, enemyTeams });
}
