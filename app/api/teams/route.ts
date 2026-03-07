import { NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { db } from "../../../db";
import { teamMemberships, teams } from "../../../db/schema";
import { authOptions } from "../../../lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const adminEmail = String(process.env.AUTH_EMAIL ?? "").trim().toLowerCase();
  const sessionEmail = String(session.user?.email ?? "").trim().toLowerCase();
  const isAdmin = Boolean(adminEmail) && sessionEmail === adminEmail;

  if (isAdmin) {
    const rows = await db
      .select({
        slug: teams.slug,
        name: teams.name,
      })
      .from(teams)
      .orderBy(asc(teams.name));

    return NextResponse.json({ ok: true, teams: rows });
  }

  const rawUserId = String((session.user as { id?: string } | undefined)?.id ?? "").trim();
  const membershipKey = !rawUserId
    ? ""
    : rawUserId.startsWith("steam:")
      ? rawUserId.slice(6).trim()
      : rawUserId.startsWith("user:")
        ? rawUserId.slice(5).trim()
        : rawUserId.includes(":")
          ? ""
          : rawUserId;

  if (!membershipKey) {
    return NextResponse.json({ ok: true, teams: [] });
  }

  const rows = await db
    .select({
      slug: teams.slug,
      name: teams.name,
    })
    .from(teams)
    .innerJoin(
      teamMemberships,
      and(
        eq(teamMemberships.teamId, teams.slug),
        eq(teamMemberships.steamId, membershipKey),
        isNull(teamMemberships.endAt)
      )
    )
    .orderBy(asc(teams.name));

  const deduped = (() => {
    const bySlug = new Map<string, { slug: string; name: string }>();
    for (const row of rows) {
      if (!bySlug.has(row.slug)) bySlug.set(row.slug, row);
    }
    return [...bySlug.values()];
  })();

  return NextResponse.json({ ok: true, teams: deduped });
}
