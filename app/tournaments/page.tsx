import { and, desc, inArray, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";

import MatchesTabs from "../../components/MatchesTabs";
import { db } from "../../db";
import { matches, teamMemberships } from "../../db/schema";
import { authOptions } from "../../lib/auth";
import { formatNumericDate } from "../../lib/dateFormat";
import { membershipKeysFromUserId } from "../../lib/steamIdentity";

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
  const membershipKeys = membershipKeysFromUserId(viewerId);

  const myTeamRows = isSignedIn && membershipKeys.length
    ? await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(and(inArray(teamMemberships.steamId, membershipKeys), sql`${teamMemberships.endAt} is null`))
    : [];

  const teamSlugSet = new Set(
    myTeamRows
      .map((row) => String(row.teamId ?? "").trim())
      .filter(Boolean)
  );

  const recentBase = await db
    .select({
      matchId: matches.matchId,
      scrimDate: matches.scrimDate,
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
      matchDateText: formatNumericDate(row.scrimDate ?? row.ingestedAt),
      ingestedAtText: row.ingestedAt ? new Date(row.ingestedAt).toLocaleString() : "-",
    }));

  const tournamentRows = recentBase
    .filter((row) => getIngestMeta(row.rawJson).publicFlag)
    .slice(0, 200)
    .map((row) => ({
      matchId: row.matchId,
      matchDateText: formatNumericDate(row.scrimDate ?? row.ingestedAt),
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
