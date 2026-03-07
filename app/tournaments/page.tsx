import { and, desc, eq, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";

import MatchesTabs from "../../components/MatchesTabs";
import { db } from "../../db";
import { matches, teamMemberships } from "../../db/schema";
import { authOptions } from "../../lib/auth";

function normalizeMembershipKey(rawId: string) {
  const value = String(rawId ?? "").trim();
  if (!value) return "";
  if (value.startsWith("steam:")) return value.slice(6);
  if (value.startsWith("user:")) return value.slice(5);
  return value;
}

function getIngestMeta(raw: any) {
  const ingest = raw?.__ingestMeta && typeof raw.__ingestMeta === "object" ? raw.__ingestMeta : {};
  const publicFlag = ingest?.public === true;
  const teamSlugsRaw = Array.isArray(ingest?.teamSlugs) ? ingest.teamSlugs : [];
  const teamSlugs = teamSlugsRaw
    .map((value: unknown) => String(value ?? "").trim())
    .filter(Boolean);

  return { publicFlag, teamSlugs };
}

export default async function TournamentsPage() {
  const session = await getServerSession(authOptions);
  const isSignedIn = Boolean(session);
  const viewerId = String((session?.user as { id?: string } | undefined)?.id ?? "");
  const membershipKey = normalizeMembershipKey(viewerId);

  const myTeamRows = isSignedIn && membershipKey
    ? await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(and(eq(teamMemberships.steamId, membershipKey), sql`${teamMemberships.endAt} is null`))
    : [];

  const teamSlugSet = new Set(
    myTeamRows
      .map((row) => String(row.teamId ?? "").trim())
      .filter(Boolean)
  );

  const recentBase = await db
    .select({
      matchId: matches.matchId,
      ingestedAt: matches.ingestedAt,
      rawJson: matches.rawJson,
    })
    .from(matches)
    .orderBy(desc(matches.ingestedAt))
    .limit(500);

  const teamRows = recentBase
    .filter((row) => {
      if (!isSignedIn || teamSlugSet.size === 0) return false;
      const meta = getIngestMeta(row.rawJson);
      return meta.teamSlugs.some((slug: string) => teamSlugSet.has(slug));
    })
    .slice(0, 200)
    .map((row) => ({
      matchId: row.matchId,
      ingestedAtText: row.ingestedAt ? new Date(row.ingestedAt).toLocaleString() : "-",
    }));

  const tournamentRows = recentBase
    .filter((row) => getIngestMeta(row.rawJson).publicFlag)
    .slice(0, 200)
    .map((row) => ({
      matchId: row.matchId,
      ingestedAtText: row.ingestedAt ? new Date(row.ingestedAt).toLocaleString() : "-",
    }));

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8">
      <MatchesTabs
        teamRows={teamRows}
        tournamentRows={tournamentRows}
        defaultTab={isSignedIn ? "team" : "tournament"}
      />
    </main>
  );
}
