import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import BackButton from "../../../components/BackButton";
import HeroIcon from "../../../components/HeroIcon";
import MapHeatmap from "../../../components/MapHeatmap";
import { db } from "../../../db";
import { matchPlayerItems, matchPlayers, matches, players, teamMemberships, teams } from "../../../db/schema";
import { fmtTime, hasItem, heroName, itemName } from "../../../lib/deadlockData";
import { heroCardIconPath, heroSmallIconPath } from "../../../lib/heroIcons";
import { authOptions } from "../../../lib/auth";
import { itemIconPath } from "../../../lib/itemIcons";
import { buildHeatmapSeriesFromManyPlayerRaw } from "../../../lib/mapHeatmap";

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function normalizeRawJson(raw: unknown): any {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function extractPlayerSlot(rawJson: unknown): number | null {
  const raw = normalizeRawJson(rawJson);
  const slot = Number(raw?.player_slot ?? raw?.playerSlot ?? raw?.slot ?? NaN);
  return Number.isFinite(slot) ? slot : null;
}

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

type TeamMatchRow = {
  matchId: string;
  steamId: string;
  side: string | null;
  heroId: string | null;
  rawJson: unknown;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  netWorth: number | null;
};

type DraftEventRow = {
  heroId: string;
  side: string | null;
  order: number;
  type: "pick" | "ban";
};

function resolveHeroId(heroId: string | null, rawJson: unknown): string | null {
  if (heroId) return heroId;
  const raw: any = rawJson;
  const fromRaw = raw?.hero_id ?? raw?.heroId ?? null;
  if (fromRaw == null) return null;
  const value = String(fromRaw).trim();
  return value ? value : null;
}

function normalizeDraftSide(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "0" || raw === "team1" || raw === "t1" || raw === "hidden king") return "0";
  if (raw === "1" || raw === "team2" || raw === "t2" || raw === "archmother") return "1";
  return String(value);
}

function extractDraftEvents(rawJson: unknown): DraftEventRow[] {
  const raw: any = rawJson;
  const source = Array.isArray(raw?.separateDraft?.rows)
    ? raw.separateDraft.rows
    : Array.isArray(raw?.draft?.events)
      ? raw.draft.events
      : Array.isArray(raw?.timeline)
        ? raw.timeline
        : [];

  const events: DraftEventRow[] = source
    .map((entry: any, index: number) => {
      const typeRaw = String(entry?.type ?? entry?.event_type ?? "").toLowerCase();
      const type = typeRaw === "pick" || typeRaw === "ban" ? (typeRaw as "pick" | "ban") : null;
      if (!type) return null;

      const heroIdRaw = entry?.heroId ?? entry?.hero_id ?? entry?.character_id ?? entry?.id ?? null;
      if (heroIdRaw == null) return null;

      const orderRaw = Number(entry?.order ?? entry?.id ?? index + 1);

      return {
        heroId: String(heroIdRaw),
        side: normalizeDraftSide(entry?.side ?? entry?.team ?? entry?.team_id ?? entry?.teamId ?? null),
        order: Number.isFinite(orderRaw) ? orderRaw : index + 1,
        type,
      } satisfies DraftEventRow;
    })
    .filter((event: DraftEventRow | null): event is DraftEventRow => Boolean(event));

  return events.sort((a, b) => a.order - b.order);
}

function matchNumberFromId(matchId: string | null | undefined): number {
  const raw = String(matchId ?? "").trim();
  if (!raw) return Number.NEGATIVE_INFINITY;

  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;

  const digitsOnly = raw.replace(/\D/g, "");
  const parsed = Number(digitsOnly);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

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

function compareByDateThenMatchNumber(
  a: { matchId: string; scrimDate?: Date | null; ingestedAt?: Date | null },
  b: { matchId: string; scrimDate?: Date | null; ingestedAt?: Date | null },
) {
  const aDate = a.scrimDate ? new Date(a.scrimDate).getTime() : NaN;
  const bDate = b.scrimDate ? new Date(b.scrimDate).getTime() : NaN;
  const aHasDate = Number.isFinite(aDate);
  const bHasDate = Number.isFinite(bDate);

  if (aHasDate && bHasDate && aDate !== bDate) return bDate - aDate;
  if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;

  const aMatchNumber = matchNumberFromId(a.matchId);
  const bMatchNumber = matchNumberFromId(b.matchId);
  if (aMatchNumber !== bMatchNumber) return bMatchNumber - aMatchNumber;

  const aIngested = a.ingestedAt ? new Date(a.ingestedAt).getTime() : 0;
  const bIngested = b.ingestedAt ? new Date(b.ingestedAt).getTime() : 0;
  if (aIngested !== bIngested) return bIngested - aIngested;

  return String(b.matchId).localeCompare(String(a.matchId));
}

export default async function TeamStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
        <BackButton />
        <section className="panel-premium rounded-xl p-4 md:p-5">
          <h1 className="text-2xl font-bold">Sign in required</h1>
          <p className="mt-2 text-zinc-400">Team stats are hidden until you sign in.</p>
          <a href="/login" className="mt-4 inline-block rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-sm hover:bg-zinc-800">
            Go to login
          </a>
        </section>
      </main>
    );
  }

  const { teamSlug } = await params;
  const membershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
  const isAdmin = isAdminSession(session as { user?: { email?: string | null; isAdmin?: boolean } } | null);

  const canViewTeam = isAdmin || (membershipKey
    ? (
        await db
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
          .limit(1)
      ).length > 0
    : false);

  if (!canViewTeam) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
        <BackButton />
        <section className="panel-premium rounded-xl p-4 md:p-5">
          <h1 className="text-2xl font-bold">Forbidden</h1>
          <p className="mt-2 text-zinc-400">You don&apos;t have access to this team.</p>
        </section>
      </main>
    );
  }

  const fromRaw = (searchParams ? (await searchParams).from : undefined) ?? "";
  const toRaw = (searchParams ? (await searchParams).to : undefined) ?? "";

  const fromDate = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
  const toDate = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : null;

  const hasFromDate = Boolean(fromDate && Number.isFinite(fromDate.getTime()));
  const hasToDate = Boolean(toDate && Number.isFinite(toDate.getTime()));

  const teamRows = await db
    .select({
      name: teams.name,
      slug: teams.slug,
      createdAt: teams.createdAt,
    })
    .from(teams)
    .where(eq(teams.slug, teamSlug))
    .limit(1);

  if (!teamRows.length) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
        <BackButton />
        <section className="panel-premium rounded-xl p-4 md:p-5">
          <h1 className="text-2xl font-bold">Team not found</h1>
          <p className="mt-2 text-zinc-400">No team exists for slug: {teamSlug}</p>
        </section>
      </main>
    );
  }

  const team = teamRows[0];

  const scrimDateColumnCheck = await db.execute(
    sql`select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
  );
  const hasScrimDateColumn = scrimDateColumnCheck.rows.length > 0;

  const rosterRows = await db
    .select({
      steamId: teamMemberships.steamId,
      displayName: players.displayName,
    })
    .from(teamMemberships)
    .leftJoin(players, eq(players.steamId, teamMemberships.steamId))
    .where(
      and(
        sql`(
          ${teamMemberships.teamId} = ${teamSlug}
          OR ${teamMemberships.teamId} IN (
            SELECT ${teams.teamId}::text FROM ${teams} WHERE ${teams.slug} = ${teamSlug}
          )
        )`,
        isNull(teamMemberships.endAt)
      )
    );

  const steamIds = rosterRows.map((row) => row.steamId);

  const teamMatchRows: TeamMatchRow[] = steamIds.length
    ? await db
        .select({
          matchId: matchPlayers.matchId,
          steamId: matchPlayers.steamId,
          side: matchPlayers.side,
          heroId: matchPlayers.heroId,
          rawJson: matchPlayers.rawJson,
          kills: matchPlayers.kills,
          deaths: matchPlayers.deaths,
          assists: matchPlayers.assists,
          netWorth: matchPlayers.netWorth,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.matchId, matchPlayers.matchId))
        .where(inArray(matchPlayers.steamId, steamIds))
    : [];

  const matchIds = [...new Set(teamMatchRows.map((row) => row.matchId))];

  const matchRows = matchIds.length
    ? hasScrimDateColumn
      ? await db
          .select({
            matchId: matches.matchId,
            rawJson: matches.rawJson,
            ingestedAt: matches.ingestedAt,
            scrimDate: matches.scrimDate,
          })
          .from(matches)
          .where(inArray(matches.matchId, matchIds))
          .orderBy(desc(matches.ingestedAt))
      : (
          await db
            .select({
              matchId: matches.matchId,
              rawJson: matches.rawJson,
              ingestedAt: matches.ingestedAt,
            })
            .from(matches)
            .where(inArray(matches.matchId, matchIds))
            .orderBy(desc(matches.ingestedAt))
        ).map((row) => ({ ...row, scrimDate: null as Date | null }))
    : [];

  const allByMatch = new Map<string, TeamMatchRow[]>();
  for (const row of teamMatchRows) {
    const list = allByMatch.get(row.matchId) ?? [];
    list.push(row);
    allByMatch.set(row.matchId, list);
  }

  const filteredMatchRows = matchRows
    .filter((match) => {
    if (!hasFromDate && !hasToDate) return true;
    if (!match.scrimDate) return false;
    const ts = new Date(match.scrimDate).getTime();
    if (hasFromDate && ts < (fromDate as Date).getTime()) return false;
    if (hasToDate && ts > (toDate as Date).getTime()) return false;
    return true;
    })
    .sort(compareByDateThenMatchNumber);

  const filteredMatchIds = new Set(filteredMatchRows.map((row) => row.matchId));
  const teamMatchRowsFiltered = teamMatchRows.filter((row) => filteredMatchIds.has(row.matchId));
  const filteredMatchIdList = [...filteredMatchIds];

  const allMatchPlayersForFiltered: TeamMatchRow[] = filteredMatchIdList.length
    ? await db
        .select({
          matchId: matchPlayers.matchId,
          steamId: matchPlayers.steamId,
          side: matchPlayers.side,
          heroId: matchPlayers.heroId,
          rawJson: matchPlayers.rawJson,
          kills: matchPlayers.kills,
          deaths: matchPlayers.deaths,
          assists: matchPlayers.assists,
          netWorth: matchPlayers.netWorth,
        })
        .from(matchPlayers)
        .where(inArray(matchPlayers.matchId, filteredMatchIdList))
    : [];

  const byMatch = new Map<string, TeamMatchRow[]>();
  for (const row of teamMatchRowsFiltered) {
    const list = byMatch.get(row.matchId) ?? [];
    list.push(row);
    byMatch.set(row.matchId, list);
  }

  const matchRawById = new Map<string, unknown>(
    filteredMatchRows.map((match) => [match.matchId, match.rawJson])
  );

  let wins = 0;
  let losses = 0;
  let undecided = 0;
  let totalKills = 0;
  let totalDeaths = 0;
  let totalAssists = 0;
  let totalSouls = 0;
  let totalTeamSideEntries = 0;
  const teamHeatmapRawList: unknown[] = [];

  const matchSummaryById = new Map<
    string,
    {
      playersRepresented: number;
      side: string | null;
      result: "Win" | "Loss" | "Unknown";
      durationText: string;
      ingestedAt: Date | null;
    }
  >();

  for (const match of filteredMatchRows) {
    const entries = byMatch.get(match.matchId) ?? [];
    const sideCounts = new Map<string, number>();

    for (const entry of entries) {
      const sideKey = entry.side ?? "unknown";
      sideCounts.set(sideKey, (sideCounts.get(sideKey) ?? 0) + 1);
    }

    let dominantSide: string | null = null;
    let dominantCount = -1;
    for (const [sideKey, count] of sideCounts.entries()) {
      if (sideKey === "unknown") continue;
      if (count > dominantCount) {
        dominantSide = sideKey;
        dominantCount = count;
      }
    }

    const raw: any = match.rawJson;
    const winner = raw?.match_info?.winning_team != null ? String(raw.match_info.winning_team) : null;

    let result: "Win" | "Loss" | "Unknown" = "Unknown";
    if (winner != null && dominantSide != null) {
      result = winner === dominantSide ? "Win" : "Loss";
    }

    if (result === "Win") wins += 1;
    else if (result === "Loss") losses += 1;
    else undecided += 1;

    const durationS = Number(
      raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? raw?.duration_s ?? NaN
    );

    matchSummaryById.set(match.matchId, {
      playersRepresented: entries.length,
      side: dominantSide,
      result,
      durationText: Number.isFinite(durationS) && durationS > 0 ? fmtTime(durationS) : "-",
      ingestedAt: match.ingestedAt,
    });
  }

  const enemyRowsFiltered = allMatchPlayersForFiltered.filter((row) => {
    const summary = matchSummaryById.get(row.matchId);
    if (!summary?.side || row.side == null) return false;
    const enemySide = summary.side === "0" ? "1" : summary.side === "1" ? "0" : null;
    return enemySide != null && row.side === enemySide;
  });

  const enemyEntries = enemyRowsFiltered.length;
  const enemyKills = enemyRowsFiltered.reduce((sum, row) => sum + safeNum(row.kills), 0);
  const enemyDeaths = enemyRowsFiltered.reduce((sum, row) => sum + safeNum(row.deaths), 0);
  const enemyAssists = enemyRowsFiltered.reduce((sum, row) => sum + safeNum(row.assists), 0);
  const enemySouls = enemyRowsFiltered.reduce((sum, row) => sum + safeNum(row.netWorth), 0);
  const enemyAvgKills = enemyEntries > 0 ? enemyKills / enemyEntries : 0;
  const enemyAvgDeaths = enemyEntries > 0 ? enemyDeaths / enemyEntries : 0;
  const enemyAvgAssists = enemyEntries > 0 ? enemyAssists / enemyEntries : 0;
  const enemyAvgSouls = enemyEntries > 0 ? enemySouls / enemyEntries : 0;
  const enemyKda = (enemyKills + enemyAssists) / Math.max(1, enemyDeaths);
  const enemyWins = losses;
  const enemyLosses = wins;
  const enemyWinRateBase = enemyWins + enemyLosses;
  const enemyWinRate = enemyWinRateBase > 0 ? (enemyWins / enemyWinRateBase) * 100 : 0;

  const heroStats = new Map<
    string,
    {
      heroId: string;
      picks: number;
      wins: number;
      losses: number;
      kills: number;
      deaths: number;
      assists: number;
      souls: number;
    }
  >();

  const playerStatsBySteam = new Map<
    string,
    {
      steamId: string;
      displayName: string | null;
      matchIds: Set<string>;
      wins: number;
      losses: number;
      undecided: number;
      kills: number;
      deaths: number;
      assists: number;
      souls: number;
      heroCounts: Map<string, number>;
    }
  >();

  for (const rosterRow of rosterRows) {
    playerStatsBySteam.set(rosterRow.steamId, {
      steamId: rosterRow.steamId,
      displayName: rosterRow.displayName,
      matchIds: new Set<string>(),
      wins: 0,
      losses: 0,
      undecided: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      souls: 0,
      heroCounts: new Map<string, number>(),
    });
  }

  for (const row of teamMatchRowsFiltered) {
    const resolvedHeroId = resolveHeroId(row.heroId, row.rawJson);
    const matchSummary = matchSummaryById.get(row.matchId);
    const isTeamSideEntry =
      matchSummary?.side != null && row.side != null
        ? row.side === matchSummary.side
        : false;

    if (!isTeamSideEntry) {
      continue;
    }

    totalKills += safeNum(row.kills);
    totalDeaths += safeNum(row.deaths);
    totalAssists += safeNum(row.assists);
    totalSouls += safeNum(row.netWorth);
    totalTeamSideEntries += 1;

    const playerSlot = extractPlayerSlot(row.rawJson);
    const matchRaw = matchRawById.get(row.matchId);
    if (playerSlot != null && matchRaw != null) {
      teamHeatmapRawList.push({
        __heatmapRaw: normalizeRawJson(matchRaw),
        __heatmapTargetSlot: playerSlot,
        __heatmapMatchId: row.matchId,
      });
    } else if (playerSlot != null) {
      teamHeatmapRawList.push({
        __heatmapRaw: normalizeRawJson(row.rawJson),
        __heatmapTargetSlot: playerSlot,
        __heatmapMatchId: row.matchId,
      });
    }

    if (resolvedHeroId) {
      const stat = heroStats.get(resolvedHeroId) ?? {
        heroId: resolvedHeroId,
        picks: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        souls: 0,
      };

      stat.picks += 1;
      stat.kills += safeNum(row.kills);
      stat.deaths += safeNum(row.deaths);
      stat.assists += safeNum(row.assists);
      stat.souls += safeNum(row.netWorth);

      if (matchSummary?.result === "Win") stat.wins += 1;
      if (matchSummary?.result === "Loss") stat.losses += 1;

      heroStats.set(resolvedHeroId, stat);
    }

    const playerStat = playerStatsBySteam.get(row.steamId) ?? {
      steamId: row.steamId,
      displayName: null,
      matchIds: new Set<string>(),
      wins: 0,
      losses: 0,
      undecided: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      souls: 0,
      heroCounts: new Map<string, number>(),
    };

    playerStat.matchIds.add(row.matchId);
    playerStat.kills += safeNum(row.kills);
    playerStat.deaths += safeNum(row.deaths);
    playerStat.assists += safeNum(row.assists);
    playerStat.souls += safeNum(row.netWorth);

    if (matchSummary?.result === "Win") playerStat.wins += 1;
    else if (matchSummary?.result === "Loss") playerStat.losses += 1;
    else playerStat.undecided += 1;

    if (resolvedHeroId) {
      playerStat.heroCounts.set(
        resolvedHeroId,
        (playerStat.heroCounts.get(resolvedHeroId) ?? 0) + 1
      );
    }

    playerStatsBySteam.set(row.steamId, playerStat);
  }

  const teamSidePlayerKeySet = new Set<string>();
  const teamSideMatchIdSet = new Set<string>();
  const teamSideAllPlayerKeySet = new Set<string>();
  const enemySideAllPlayerKeySet = new Set<string>();
  const enemySideMatchIdSet = new Set<string>();

  for (const row of allMatchPlayersForFiltered) {
    const summary = matchSummaryById.get(row.matchId);
    if (!summary?.side || row.side == null) continue;

    if (row.side === summary.side) {
      teamSideAllPlayerKeySet.add(`${row.matchId}:${row.steamId}`);
      teamSideMatchIdSet.add(row.matchId);
      continue;
    }

    const enemySide = summary.side === "0" ? "1" : summary.side === "1" ? "0" : null;
    if (enemySide != null && row.side === enemySide) {
      enemySideAllPlayerKeySet.add(`${row.matchId}:${row.steamId}`);
      enemySideMatchIdSet.add(row.matchId);
    }
  }

  for (const row of teamMatchRowsFiltered) {
    const summary = matchSummaryById.get(row.matchId);
    const isTeamSideEntry =
      summary?.side != null && row.side != null
        ? row.side === summary.side
        : false;
    if (isTeamSideEntry) {
      teamSidePlayerKeySet.add(`${row.matchId}:${row.steamId}`);
      teamSideMatchIdSet.add(row.matchId);
    }
  }

  const teamSideMatchCount = teamSideMatchIdSet.size;
  const enemySideMatchCount = enemySideMatchIdSet.size;

  const allItemRows = filteredMatchIdList.length
    ? await db
        .select({
          matchId: matchPlayerItems.matchId,
          steamId: matchPlayerItems.steamId,
          itemId: matchPlayerItems.itemId,
          gameTimeS: matchPlayerItems.gameTimeS,
        })
        .from(matchPlayerItems)
        .where(inArray(matchPlayerItems.matchId, filteredMatchIdList))
    : [];

  const teamItemRows = filteredMatchIdList.length && steamIds.length
    ? await db
        .select({
          matchId: matchPlayerItems.matchId,
          steamId: matchPlayerItems.steamId,
          itemId: matchPlayerItems.itemId,
          gameTimeS: matchPlayerItems.gameTimeS,
        })
        .from(matchPlayerItems)
        .where(
          and(
            inArray(matchPlayerItems.matchId, filteredMatchIdList),
            inArray(matchPlayerItems.steamId, steamIds),
          )
        )
    : [];

  const itemStatsMap = new Map<
    number,
    {
      itemId: number;
      buys: number;
      totalBuyTimeS: number;
      matchIds: Set<string>;
      winMatchIds: Set<string>;
      lossMatchIds: Set<string>;
      playerIds: Set<string>;
    }
  >();

  for (const row of teamItemRows) {
    const key = `${row.matchId}:${row.steamId}`;
    if (!teamSidePlayerKeySet.has(key)) continue;

    const itemIdNum = Number(row.itemId);
    if (!Number.isFinite(itemIdNum) || !hasItem(itemIdNum)) continue;

    const stat = itemStatsMap.get(itemIdNum) ?? {
      itemId: itemIdNum,
      buys: 0,
      totalBuyTimeS: 0,
      matchIds: new Set<string>(),
      winMatchIds: new Set<string>(),
      lossMatchIds: new Set<string>(),
      playerIds: new Set<string>(),
    };

    stat.buys += 1;
    stat.totalBuyTimeS += safeNum(row.gameTimeS);
    stat.matchIds.add(row.matchId);
    stat.playerIds.add(row.steamId);

    const result = matchSummaryById.get(row.matchId)?.result;
    if (result === "Win") stat.winMatchIds.add(row.matchId);
    if (result === "Loss") stat.lossMatchIds.add(row.matchId);

    itemStatsMap.set(itemIdNum, stat);
  }

  const totalItemBuys = [...itemStatsMap.values()].reduce((sum, stat) => sum + stat.buys, 0);

  function summarizeSideItems(keySet: Set<string>, sideMatchCount: number) {
    const itemCountById = new Map<number, number>();
    const matchIdsWithItems = new Set<string>();
    let totalBuys = 0;

    for (const row of allItemRows) {
      const key = `${row.matchId}:${row.steamId}`;
      if (!keySet.has(key)) continue;

      const itemIdNum = Number(row.itemId);
      if (!Number.isFinite(itemIdNum) || !hasItem(itemIdNum)) continue;

      totalBuys += 1;
      matchIdsWithItems.add(row.matchId);
      itemCountById.set(itemIdNum, (itemCountById.get(itemIdNum) ?? 0) + 1);
    }

    const uniqueItems = itemCountById.size;
    const topEntry = [...itemCountById.entries()].sort((a, b) => b[1] - a[1])[0];
    const topItemId = topEntry?.[0] ?? null;
    const topItemBuys = topEntry?.[1] ?? 0;
    const itemCoverage = sideMatchCount > 0 ? (matchIdsWithItems.size / sideMatchCount) * 100 : 0;

    return {
      totalBuys,
      uniqueItems,
      topItemId,
      topItemBuys,
      itemCoverage,
    };
  }

  const teamItemSummary = summarizeSideItems(teamSideAllPlayerKeySet, teamSideMatchCount);
  const enemyItemSummary = summarizeSideItems(enemySideAllPlayerKeySet, enemySideMatchCount);

  const itemRows = [...itemStatsMap.values()]
    .map((stat) => {
      const matchCount = stat.matchIds.size;
      const winCount = stat.winMatchIds.size;
      const lossCount = stat.lossMatchIds.size;
      const winRateWhenPicked = winCount + lossCount > 0 ? (winCount / (winCount + lossCount)) * 100 : 0;
      const pickRate = teamSideMatchCount > 0 ? (matchCount / teamSideMatchCount) * 100 : 0;
      const avgBuyTimeS = stat.buys > 0 ? stat.totalBuyTimeS / stat.buys : 0;
      const weightPct = totalItemBuys > 0 ? (stat.buys / totalItemBuys) * 100 : 0;

      return {
        itemId: stat.itemId,
        buys: stat.buys,
        matchCount,
        playerCount: stat.playerIds.size,
        pickRate,
        winRateWhenPicked,
        avgBuyTimeS,
        weightPct,
      };
    })
    .sort((a, b) => {
      if (b.buys !== a.buys) return b.buys - a.buys;
      if (b.pickRate !== a.pickRate) return b.pickRate - a.pickRate;
      return a.itemId - b.itemId;
    });

  const topItemRows = itemRows.slice(0, 12);
  const coreItemRows = topItemRows.filter((entry) => entry.pickRate >= 50);
  const situationalItemRows = topItemRows.filter((entry) => entry.pickRate < 50);

  const playerStats = [...playerStatsBySteam.values()]
    .map((entry) => {
      const matchesPlayed = entry.matchIds.size;
      const playerKda = (entry.kills + entry.assists) / Math.max(1, entry.deaths);
      const avgKills = matchesPlayed > 0 ? entry.kills / matchesPlayed : 0;
      const avgDeaths = matchesPlayed > 0 ? entry.deaths / matchesPlayed : 0;
      const avgAssists = matchesPlayed > 0 ? entry.assists / matchesPlayed : 0;
      const avgPlayerSouls = matchesPlayed > 0 ? entry.souls / matchesPlayed : 0;
      const playerWinRateBase = entry.wins + entry.losses;
      const playerWinRate = playerWinRateBase > 0 ? (entry.wins / playerWinRateBase) * 100 : 0;

      let topHeroId: string | null = null;
      let topHeroPicks = 0;
      for (const [heroId, picks] of entry.heroCounts.entries()) {
        if (picks > topHeroPicks) {
          topHeroId = heroId;
          topHeroPicks = picks;
        }
      }

      const detailHref = `/players/${entry.steamId}`;

      return {
        steamId: entry.steamId,
        displayName: entry.displayName,
        matchesPlayed,
        wins: entry.wins,
        losses: entry.losses,
        undecided: entry.undecided,
        kills: entry.kills,
        deaths: entry.deaths,
        assists: entry.assists,
        avgKills,
        avgDeaths,
        avgAssists,
        playerKda,
        avgPlayerSouls,
        playerWinRate,
        topHeroId,
        topHeroPicks,
        detailHref,
      };
    })
    .sort((a, b) => {
      if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
      if (b.playerKda !== a.playerKda) return b.playerKda - a.playerKda;
      return b.avgPlayerSouls - a.avgPlayerSouls;
    });

  const recentTeamMatches = filteredMatchRows.slice(0, 20).map((match) => {
    const summary = matchSummaryById.get(match.matchId);
    const draftEvents = extractDraftEvents(match.rawJson);
    return {
      matchId: match.matchId,
      playersRepresented: summary?.playersRepresented ?? 0,
      side: summary?.side ?? null,
      result: summary?.result ?? "Unknown",
      durationText: summary?.durationText ?? "-",
      ingestedAt: summary?.ingestedAt ?? null,
      draftEvents,
      draftCount: draftEvents.length,
    };
  });

  const draftMatches = filteredMatchRows
    .map((match) => {
      const summary = matchSummaryById.get(match.matchId);
      return {
        matchId: match.matchId,
        side: summary?.side ?? null,
        result: summary?.result ?? "Unknown",
        draftEvents: extractDraftEvents(match.rawJson),
      };
    })
    .filter((match) => match.draftEvents.length > 0);

  let totalDraftEvents = 0;
  let totalDraftPicks = 0;
  let totalDraftBans = 0;
  let teamSidePicks = 0;
  let teamSideBans = 0;
  let enemySidePicks = 0;
  let enemySideBans = 0;

  const draftHeroStats = new Map<
    string,
    {
      heroId: string;
      picks: number;
      bans: number;
      banWins: number;
      banLosses: number;
      teamPicks: number;
      teamBans: number;
      enemyPicks: number;
      enemyBans: number;
    }
  >();

  for (const match of draftMatches) {
    const teamSide = match.side;

    for (const event of match.draftEvents) {
      totalDraftEvents += 1;
      if (event.type === "pick") totalDraftPicks += 1;
      if (event.type === "ban") totalDraftBans += 1;

      const heroStat = draftHeroStats.get(event.heroId) ?? {
        heroId: event.heroId,
        picks: 0,
        bans: 0,
        banWins: 0,
        banLosses: 0,
        teamPicks: 0,
        teamBans: 0,
        enemyPicks: 0,
        enemyBans: 0,
      };

      if (event.type === "pick") {
        heroStat.picks += 1;
      }

      if (event.type === "ban") {
        heroStat.bans += 1;
        if (match.result === "Win") heroStat.banWins += 1;
        if (match.result === "Loss") heroStat.banLosses += 1;
      }

      const isTeamSideEvent = teamSide != null && event.side != null ? event.side === teamSide : null;

      if (isTeamSideEvent === true) {
        if (event.type === "pick") {
          teamSidePicks += 1;
          heroStat.teamPicks += 1;
        }
        if (event.type === "ban") {
          teamSideBans += 1;
          heroStat.teamBans += 1;
        }
      } else if (isTeamSideEvent === false) {
        if (event.type === "pick") {
          enemySidePicks += 1;
          heroStat.enemyPicks += 1;
        }
        if (event.type === "ban") {
          enemySideBans += 1;
          heroStat.enemyBans += 1;
        }
      }

      draftHeroStats.set(event.heroId, heroStat);
    }
  }

  const draftHeroRows = [...draftHeroStats.values()].sort((a, b) => {
    const aTotal = a.picks + a.bans;
    const bTotal = b.picks + b.bans;
    if (bTotal !== aTotal) return bTotal - aTotal;
    if (b.picks !== a.picks) return b.picks - a.picks;
    if (b.bans !== a.bans) return b.bans - a.bans;
    return a.heroId.localeCompare(b.heroId);
  });

  const topBannedHeroes = draftHeroRows
    .filter((entry) => entry.bans > 0)
    .sort((a, b) => b.bans - a.bans)
    .slice(0, 8)
    .map((entry) => {
      const banWinRateBase = entry.banWins + entry.banLosses;
      const banWinRate = banWinRateBase > 0 ? (entry.banWins / banWinRateBase) * 100 : 0;
      return {
        ...entry,
        banWinRate,
      };
    });

  const teamTopBan = [...draftHeroRows]
    .filter((entry) => entry.teamBans > 0)
    .sort((a, b) => b.teamBans - a.teamBans)[0] ?? null;

  const enemyTopBan = [...draftHeroRows]
    .filter((entry) => entry.enemyBans > 0)
    .sort((a, b) => b.enemyBans - a.enemyBans)[0] ?? null;

  const totalEntries = totalTeamSideEntries;
  const kda = (totalKills + totalAssists) / Math.max(1, totalDeaths);
  const avgSouls = totalEntries > 0 ? totalSouls / totalEntries : 0;
  const avgKills = totalEntries > 0 ? totalKills / totalEntries : 0;
  const avgDeaths = totalEntries > 0 ? totalDeaths / totalEntries : 0;
  const avgAssists = totalEntries > 0 ? totalAssists / totalEntries : 0;
  const winRateBase = wins + losses;
  const winRate = winRateBase > 0 ? (wins / winRateBase) * 100 : 0;

  const topHeroes = [...heroStats.values()]
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 8)
    .map((entry) => {
      const winRateBase = entry.wins + entry.losses;
      const winRate = winRateBase > 0 ? (entry.wins / winRateBase) * 100 : 0;
      const heroKda = (entry.kills + entry.assists) / Math.max(1, entry.deaths);
      const avgSouls = entry.picks > 0 ? entry.souls / entry.picks : 0;

      return {
        ...entry,
        winRate,
        heroKda,
        avgSouls,
      };
    });

  const teamHeatmap = buildHeatmapSeriesFromManyPlayerRaw(teamHeatmapRawList);

  const heroRows = [...heroStats.values()]
    .sort((a, b) => b.picks - a.picks)
    .map((entry) => {
      const heroWinRateBase = entry.wins + entry.losses;
      const heroWinRate = heroWinRateBase > 0 ? (entry.wins / heroWinRateBase) * 100 : 0;
      const heroKda = (entry.kills + entry.assists) / Math.max(1, entry.deaths);
      const heroAvgSouls = entry.picks > 0 ? entry.souls / entry.picks : 0;
      const avgKills = entry.picks > 0 ? entry.kills / entry.picks : 0;
      const avgDeaths = entry.picks > 0 ? entry.deaths / entry.picks : 0;
      const avgAssists = entry.picks > 0 ? entry.assists / entry.picks : 0;

      return {
        ...entry,
        heroWinRate,
        heroKda,
        heroAvgSouls,
        avgKills,
        avgDeaths,
        avgAssists,
      };
    });

  const heroGraphRows = heroRows;

  const maxHeroGraphPicks = Math.max(1, ...heroGraphRows.map((entry) => entry.picks));
  const maxHeroGraphKda = Math.max(1, ...heroGraphRows.map((entry) => entry.heroKda));
  const maxHeroGraphSouls = Math.max(1, ...heroGraphRows.map((entry) => entry.heroAvgSouls));

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <a href="/teams" className="text-sm text-zinc-300 hover:underline">
          Back to teams
        </a>
      </div>

      <header className="panel-premium rounded-xl p-4 md:p-5">
        <h1 className="text-3xl font-bold tracking-tight">{team.name} stats</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Team slug: {team.slug} • Active roster: {rosterRows.length}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={`/teams/${team.slug}/enemy-tracking`}
            className="inline-flex rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Open enemy tracking →
          </a>
          <a
            href={`/teams/${team.slug}/edit`}
            className="inline-flex rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Edit team
          </a>
        </div>
      </header>

      <section className="panel-premium rounded-xl p-4">
        <form className="flex flex-col gap-3 md:flex-row md:items-end" method="GET">
          <input type="hidden" name="teamSlug" value={teamSlug} />
          <div>
            <label htmlFor="from" className="mb-1 block text-sm text-zinc-300">From (scrim date)</label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={fromRaw}
              className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-sm text-zinc-300">To (scrim date)</label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={toRaw}
              className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
            >
              Apply
            </button>
            <a
              href={`/teams/${team.slug}`}
              className="rounded border border-zinc-700/80 bg-zinc-900/80 px-4 py-2 text-sm hover:bg-zinc-800"
            >
              Reset
            </a>
          </div>
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          Filters use the manually set scrim date on each match.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel-premium-soft rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide opacity-70">Matches represented</p>
          <p className="mt-1 text-xl font-semibold">{byMatch.size}</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide opacity-70">Record</p>
          <p className="mt-1 text-xl font-semibold">{wins}-{losses}</p>
          <p className="text-xs text-zinc-500">{undecided} undecided</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide opacity-70">Win rate</p>
          <p className="mt-1 text-xl font-semibold">{winRate.toFixed(1)}%</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide opacity-70">Avg K / D / A</p>
          <p className="mt-1 text-xl font-semibold">
            {avgKills.toFixed(2)} / {avgDeaths.toFixed(2)} / {avgAssists.toFixed(2)}
          </p>
        </div>
      </section>

      <section className="panel-premium rounded-xl p-4">
        <h2 className="text-lg font-semibold mb-2">Player stats</h2>
        <p className="mb-3 text-sm text-zinc-400">Personal performance for active manual roster players in this filtered range.</p>
        {playerStats.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/70">
                <tr>
                  <th className="p-3 text-left">Player</th>
                  <th className="p-3 text-left">Matches</th>
                  <th className="p-3 text-left">Record</th>
                  <th className="p-3 text-left">Win %</th>
                  <th className="p-3 text-left">Avg K / D / A</th>
                  <th className="p-3 text-left">KDA</th>
                  <th className="p-3 text-left">Avg souls</th>
                  <th className="p-3 text-left">Most played</th>
                  <th className="p-3 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {playerStats.map((entry) => (
                  <tr key={entry.steamId} className="border-t border-zinc-800/80 odd:bg-zinc-900/20 hover:bg-zinc-900/40">
                    <td className="p-0">
                      <a href={entry.detailHref} className="block px-3 py-3" title={`Open detailed stats for ${entry.displayName ?? entry.steamId}`}>
                        <div className="font-medium truncate text-emerald-300 hover:text-emerald-200">
                          {entry.displayName ?? "(unknown)"}
                        </div>
                        <div className="text-xs font-mono text-zinc-500 truncate">{entry.steamId}</div>
                      </a>
                    </td>
                    <td className="p-0 font-mono"><a href={entry.detailHref} className="block px-3 py-3">{entry.matchesPlayed}</a></td>
                    <td className="p-0 font-mono"><a href={entry.detailHref} className="block px-3 py-3">{entry.wins}-{entry.losses}</a></td>
                    <td className="p-0 font-mono"><a href={entry.detailHref} className="block px-3 py-3">{entry.playerWinRate.toFixed(0)}%</a></td>
                    <td className="p-0 font-mono"><a href={entry.detailHref} className="block px-3 py-3">{entry.avgKills.toFixed(2)} / {entry.avgDeaths.toFixed(2)} / {entry.avgAssists.toFixed(2)}</a></td>
                    <td className="p-0 font-mono"><a href={entry.detailHref} className="block px-3 py-3">{entry.playerKda.toFixed(2)}</a></td>
                    <td className="p-0 font-mono"><a href={entry.detailHref} className="block px-3 py-3">{entry.avgPlayerSouls.toFixed(0)}</a></td>
                    <td className="p-0">
                      <a href={entry.detailHref} className="block px-3 py-3">
                        {entry.topHeroId ? (
                          <span className="inline-flex items-center gap-2">
                            {heroSmallIconPath(entry.topHeroId) ? (
                              <HeroIcon
                                src={heroSmallIconPath(entry.topHeroId)}
                                alt={heroName(entry.topHeroId)}
                                width={20}
                                height={20}
                                className="h-5 w-5 rounded object-cover border border-zinc-700"
                              />
                            ) : null}
                            <span className="truncate">{heroName(entry.topHeroId)} ({entry.topHeroPicks})</span>
                          </span>
                        ) : (
                          <span className="text-zinc-500">-</span>
                        )}
                      </a>
                    </td>
                    <td className="p-0">
                      <a href={entry.detailHref} className="block px-3 py-3 text-emerald-300 hover:text-emerald-200 hover:underline">
                        Open →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No player stats found for this filter yet.</p>
        )}
      </section>

      <section className="panel-premium rounded-xl p-4">
        <h2 className="text-lg font-semibold mb-2">Averages</h2>
        <div className="space-y-2 text-sm">
          <p>Avg souls per player-entry: <span className="font-mono">{avgSouls.toFixed(0)}</span></p>
          <p>Avg kills per player-entry: <span className="font-mono">{avgKills.toFixed(2)}</span></p>
          <p>Avg deaths per player-entry: <span className="font-mono">{avgDeaths.toFixed(2)}</span></p>
          <p>Avg assists per player-entry: <span className="font-mono">{avgAssists.toFixed(2)}</span></p>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <section className="panel-premium rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-2">Top heroes</h2>
          <p className="mb-3 text-sm text-zinc-400">Most impactful heroes for this team in the selected range.</p>
          {topHeroes.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {topHeroes.map((entry, index) => (
                <div
                  key={entry.heroId}
                  className={`rounded border bg-zinc-900/40 p-3 ${
                    index === 0
                      ? "border-emerald-500/40 ring-1 ring-emerald-400/25"
                      : "border-zinc-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xs font-semibold text-zinc-300">
                      #{index + 1}
                    </span>
                    <span className="text-xs font-mono text-zinc-300">{entry.picks} picks</span>
                  </div>

                  <div className="mt-3 flex items-center gap-3 min-w-0">
                    {heroCardIconPath(entry.heroId) ? (
                      <HeroIcon
                        src={heroCardIconPath(entry.heroId)}
                        alt={heroName(entry.heroId)}
                        width={84}
                        height={84}
                        className="h-20 w-20 shrink-0 rounded object-cover border border-zinc-700"
                      />
                    ) : heroSmallIconPath(entry.heroId) ? (
                      <HeroIcon
                        src={heroSmallIconPath(entry.heroId)}
                        alt={heroName(entry.heroId)}
                        width={68}
                        height={68}
                        className="h-16 w-16 shrink-0 rounded object-cover border border-zinc-700"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-zinc-100">{heroName(entry.heroId)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-200">
                          WR {entry.winRate.toFixed(0)}%
                        </span>
                        <span className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-200">
                          KDA {entry.heroKda.toFixed(2)}
                        </span>
                        <span className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-200">
                          Souls {entry.avgSouls.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No hero data yet.</p>
          )}
        </section>

          <section className="panel-premium rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-2">Top bans</h2>
            <p className="mb-3 text-sm text-zinc-400">Most banned heroes across this team's filtered draft matches.</p>
            {topBannedHeroes.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
            {topBannedHeroes.map((entry, index) => (
              <div
                key={`top-ban-${entry.heroId}`}
                className={`rounded border bg-zinc-900/40 p-3 ${
                  index === 0
                    ? "border-rose-500/40 ring-1 ring-rose-400/25"
                    : "border-zinc-800"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xs font-semibold text-zinc-300">
                    #{index + 1}
                  </span>
                  <span className="text-xs font-mono text-zinc-300">{entry.bans} bans</span>
                </div>

                <div className="mt-3 flex items-center gap-3 min-w-0">
                  {heroCardIconPath(entry.heroId) ? (
                    <HeroIcon
                      src={heroCardIconPath(entry.heroId)}
                      alt={heroName(entry.heroId)}
                      width={84}
                      height={84}
                      className="h-20 w-20 shrink-0 rounded object-cover border border-zinc-700"
                    />
                  ) : heroSmallIconPath(entry.heroId) ? (
                    <HeroIcon
                      src={heroSmallIconPath(entry.heroId)}
                      alt={heroName(entry.heroId)}
                      width={68}
                      height={68}
                      className="h-16 w-16 shrink-0 rounded object-cover border border-zinc-700"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-zinc-100">{heroName(entry.heroId)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      <span className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-200">
                        Total {entry.bans}
                      </span>
                      <span className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-200">
                        WR when banned {entry.banWinRate.toFixed(0)}%
                      </span>
                      <span className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-200">
                        Team {entry.teamBans}
                      </span>
                      <span className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 font-mono text-zinc-200">
                        Enemy {entry.enemyBans}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No bans data yet.</p>
          )}
        </section>
      </section>

      <section className="panel-premium rounded-xl p-4">
        <h2 className="text-lg font-semibold mb-2">Hero-specific stats</h2>
        <p className="mb-3 text-sm text-zinc-400">Detailed hero performance across the filtered team matches (averages per hero pick).</p>
        {heroRows.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/70">
                <tr>
                  <th className="p-3 text-left">Hero</th>
                  <th className="p-3 text-left">Picks</th>
                  <th className="p-3 text-left">Record</th>
                  <th className="p-3 text-left">Win %</th>
                  <th className="p-3 text-left">Avg K / D / A</th>
                  <th className="p-3 text-left">Total K / D / A</th>
                  <th className="p-3 text-left">KDA</th>
                  <th className="p-3 text-left">Avg souls</th>
                </tr>
              </thead>
              <tbody>
                {heroRows.map((entry) => (
                  <tr key={`hero-row-${entry.heroId}`} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                    <td className="p-3">
                      <span className="inline-flex items-center gap-2">
                        {heroSmallIconPath(entry.heroId) ? (
                          <HeroIcon
                            src={heroSmallIconPath(entry.heroId)}
                            alt={heroName(entry.heroId)}
                            width={20}
                            height={20}
                            className="h-5 w-5 rounded object-cover border border-zinc-700"
                          />
                        ) : null}
                        <span>{heroName(entry.heroId)}</span>
                      </span>
                    </td>
                    <td className="p-3 font-mono">{entry.picks}</td>
                    <td className="p-3 font-mono">{entry.wins}-{entry.losses}</td>
                    <td className="p-3 font-mono">{entry.heroWinRate.toFixed(1)}%</td>
                    <td className="p-3 font-mono">{entry.avgKills.toFixed(2)} / {entry.avgDeaths.toFixed(2)} / {entry.avgAssists.toFixed(2)}</td>
                    <td className="p-3 font-mono">{entry.kills} / {entry.deaths} / {entry.assists}</td>
                    <td className="p-3 font-mono">{entry.heroKda.toFixed(2)}</td>
                    <td className="p-3 font-mono">{entry.heroAvgSouls.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No hero-specific stats available yet.</p>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="panel-premium rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-2">Item picks</h2>
          <p className="mb-3 text-sm text-zinc-400">Weighted team-side item usage and outcomes in the selected range.</p>
          {topItemRows.length ? (
            <section className="rounded-lg border border-zinc-800/70 bg-zinc-900/20 p-3">
              <h3 className="text-sm font-semibold mb-2">Core items</h3>
              {coreItemRows.length ? (
                <div className="overflow-x-auto rounded border border-zinc-800/70">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-900/70">
                      <tr>
                        <th className="p-2 text-left">Item</th>
                        <th className="p-2 text-left">Buys</th>
                        <th className="p-2 text-left">Weight</th>
                        <th className="p-2 text-left">Pick %</th>
                        <th className="p-2 text-left">WR</th>
                        <th className="p-2 text-left">Avg buy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coreItemRows.map((entry) => (
                        <tr key={`core-item-row-${entry.itemId}`} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                          <td className="p-2">
                            <span className="inline-flex items-center gap-2">
                              {itemIconPath(entry.itemId) ? (
                                <HeroIcon
                                  src={itemIconPath(entry.itemId)}
                                  alt={itemName(entry.itemId)}
                                  width={16}
                                  height={16}
                                  className="h-4 w-4 rounded object-contain border border-zinc-700"
                                />
                              ) : null}
                              <span>{itemName(entry.itemId)}</span>
                            </span>
                          </td>
                          <td className="p-2 font-mono">{entry.buys}</td>
                          <td className="p-2 font-mono">{entry.weightPct.toFixed(1)}%</td>
                          <td className="p-2 font-mono">{entry.pickRate.toFixed(1)}%</td>
                          <td className="p-2 font-mono">{entry.winRateWhenPicked.toFixed(1)}%</td>
                          <td className="p-2 font-mono">{fmtTime(entry.avgBuyTimeS)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No core items in this range.</p>
              )}
            </section>
          ) : (
            <p className="text-sm text-zinc-400">No item pick data yet.</p>
          )}
        </div>

        <div className="w-full">
          <MapHeatmap
            title="Map heatmap"
            description="Kill and death density across team-side players in the selected range. Hover a dot to see who killed whom and when."
            kills={teamHeatmap.kills}
            deaths={teamHeatmap.deaths}
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="panel-premium rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-2">Situational items</h2>
          <p className="mb-3 text-sm text-zinc-400">Lower-frequency team-side item usage and outcomes in the selected range.</p>
          {topItemRows.length ? (
            <section className="rounded-lg border border-zinc-800/70 bg-zinc-900/20 p-3">
              <h3 className="text-sm font-semibold mb-2">Situational items</h3>
              {situationalItemRows.length ? (
                <div className="overflow-x-auto rounded border border-zinc-800/70">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-900/70">
                      <tr>
                        <th className="p-2 text-left">Item</th>
                        <th className="p-2 text-left">Buys</th>
                        <th className="p-2 text-left">Weight</th>
                        <th className="p-2 text-left">Pick %</th>
                        <th className="p-2 text-left">WR</th>
                        <th className="p-2 text-left">Avg buy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {situationalItemRows.map((entry) => (
                        <tr key={`situational-item-row-${entry.itemId}`} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                          <td className="p-2">
                            <span className="inline-flex items-center gap-2">
                              {itemIconPath(entry.itemId) ? (
                                <HeroIcon
                                  src={itemIconPath(entry.itemId)}
                                  alt={itemName(entry.itemId)}
                                  width={16}
                                  height={16}
                                  className="h-4 w-4 rounded object-contain border border-zinc-700"
                                />
                              ) : null}
                              <span>{itemName(entry.itemId)}</span>
                            </span>
                          </td>
                          <td className="p-2 font-mono">{entry.buys}</td>
                          <td className="p-2 font-mono">{entry.weightPct.toFixed(1)}%</td>
                          <td className="p-2 font-mono">{entry.pickRate.toFixed(1)}%</td>
                          <td className="p-2 font-mono">{entry.winRateWhenPicked.toFixed(1)}%</td>
                          <td className="p-2 font-mono">{fmtTime(entry.avgBuyTimeS)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No situational items in this range.</p>
              )}
            </section>
          ) : (
            <p className="text-sm text-zinc-400">No item pick data yet.</p>
          )}
        </div>
      </section>

      <section className="panel-premium rounded-xl p-4">
        <details>
          <summary className="cursor-pointer list-none select-none text-lg font-semibold">Hero visuals</summary>
          <p className="mb-3 mt-2 text-sm text-zinc-400"> Graphs and charts for pick volume, win rate, KDA, and average souls.</p>
          {heroGraphRows.length ? (
            <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
              <p className="text-sm mb-3">Pick rate + Win rate</p>
              <div className="space-y-2">
                {heroGraphRows.map((entry) => (
                  <div key={`pick-win-${entry.heroId}`} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-2 truncate">
                        {heroSmallIconPath(entry.heroId) ? (
                          <HeroIcon
                            src={heroSmallIconPath(entry.heroId)}
                            alt={heroName(entry.heroId)}
                            width={18}
                            height={18}
                            className="h-4.5 w-4.5 rounded object-cover border border-zinc-700"
                          />
                        ) : null}
                        <span className="truncate">{heroName(entry.heroId)}</span>
                      </span>
                      <span className="font-mono">{entry.picks} • {entry.heroWinRate.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-emerald-400" style={{ width: `${(entry.picks / maxHeroGraphPicks) * 100}%` }} />
                    </div>
                    <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-blue-400" style={{ width: `${entry.heroWinRate}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
              <p className="text-sm mb-3">KDA / Avg Souls</p>
              <div className="space-y-3">
                {heroGraphRows.map((entry) => (
                  <div key={`kda-${entry.heroId}`} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-2 truncate">
                        {heroSmallIconPath(entry.heroId) ? (
                          <HeroIcon
                            src={heroSmallIconPath(entry.heroId)}
                            alt={heroName(entry.heroId)}
                            width={18}
                            height={18}
                            className="h-4.5 w-4.5 rounded object-cover border border-zinc-700"
                          />
                        ) : null}
                        <span className="truncate">{heroName(entry.heroId)}</span>
                      </span>
                      <span className="font-mono">KDA {entry.heroKda.toFixed(2)}</span>
                    </div>
                    <div className="h-2 rounded bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-amber-400" style={{ width: `${(entry.heroKda / maxHeroGraphKda) * 100}%` }} />
                    </div>
                    <div className="text-[11px] text-zinc-500 text-right">
                      Avg souls {entry.heroAvgSouls.toFixed(0)}
                    </div>
                    <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-violet-400" style={{ width: `${(entry.heroAvgSouls / maxHeroGraphSouls) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No hero visual data yet.</p>
          )}
        </details>
      </section>

      <section className="panel-premium rounded-xl p-4">
        <h2 className="text-lg font-semibold mb-2">Recent team matches</h2>
        <p className="mb-2 text-sm text-zinc-400">Most recent matches where at least one active roster player appeared.</p>
        {recentTeamMatches.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/70">
                <tr>
                  <th className="p-3 text-left">Match</th>
                  <th className="p-3 text-left">Result</th>
                  <th className="p-3 text-left">Side</th>
                  <th className="p-3 text-left">Players</th>
                  <th className="p-3 text-left">Duration</th>
                  <th className="p-3 text-left">Draft</th>
                  <th className="p-3 text-left">Open</th>
                </tr>
              </thead>
              <tbody>
                {recentTeamMatches.map((match) => (
                  <tr key={match.matchId} className="border-t border-zinc-800/80 odd:bg-zinc-900/20 hover:bg-zinc-900/40">
                    <td className="p-0 font-mono"><a className="block px-3 py-3" href={`/match/${match.matchId}`}>{match.matchId}</a></td>
                    <td className="p-0">
                      <a className="block px-3 py-3" href={`/match/${match.matchId}`}>
                        <span
                          className={
                            match.result === "Win"
                              ? "text-emerald-300"
                              : match.result === "Loss"
                                ? "text-rose-300"
                                : "text-zinc-400"
                          }
                        >
                          {match.result}
                        </span>
                      </a>
                    </td>
                    <td className="p-0"><a className="block px-3 py-3" href={`/match/${match.matchId}`}>{match.side != null ? TEAM_NAMES[match.side] ?? match.side : "Unknown"}</a></td>
                    <td className="p-0"><a className="block px-3 py-3" href={`/match/${match.matchId}`}>{match.playersRepresented}</a></td>
                    <td className="p-0 font-mono"><a className="block px-3 py-3" href={`/match/${match.matchId}`}>{match.durationText}</a></td>
                    <td className="p-3">
                      {match.draftCount ? (
                        <a className="block" href={`/match/${match.matchId}`}>
                          <div className="mb-1 text-xs text-zinc-400">{match.draftCount} events</div>
                          <div className="flex flex-wrap gap-1">
                            {match.draftEvents.slice(0, 12).map((event) => {
                              const icon = heroSmallIconPath(event.heroId);
                              const tone = event.type === "ban" ? "border-rose-500/40 bg-rose-500/10" : "border-emerald-500/40 bg-emerald-500/10";
                              const sideLabel = event.side === "0" ? "HK" : event.side === "1" ? "AM" : "?";
                              return (
                                <span key={`${match.matchId}-${event.order}-${event.type}-${event.heroId}`} className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] ${tone}`} title={`#${event.order} ${event.type.toUpperCase()} ${heroName(event.heroId)} • ${sideLabel}`}>
                                  {icon ? (
                                    <HeroIcon
                                      src={icon}
                                      alt={heroName(event.heroId)}
                                      width={14}
                                      height={14}
                                      className="h-3.5 w-3.5 rounded object-cover"
                                    />
                                  ) : null}
                                  <span>{sideLabel}</span>
                                </span>
                              );
                            })}
                            {match.draftEvents.length > 12 ? (
                              <span className="inline-flex items-center rounded border border-zinc-700/80 bg-zinc-900/60 px-1.5 py-1 text-[10px] text-zinc-300">
                                +{match.draftEvents.length - 12}
                              </span>
                            ) : null}
                          </div>
                        </a>
                      ) : (
                        <a className="block text-xs text-zinc-500" href={`/match/${match.matchId}`}>No draft</a>
                      )}
                    </td>
                    <td className="p-0">
                      <a className="block px-3 py-3 text-emerald-300 hover:text-emerald-200 hover:underline" href={`/match/${match.matchId}`}>
                        View →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No matches found for this team roster yet.</p>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4">
        <h2 className="text-lg font-semibold mb-2">Draft stats</h2>
        <p className="mb-3 text-sm text-zinc-400">Draft trends from matches in the current filter range.</p>

        {draftMatches.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-wide opacity-70">Drafted matches</p>
                <p className="mt-1 text-xl font-semibold">{draftMatches.length}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-wide opacity-70">Total events</p>
                <p className="mt-1 text-xl font-semibold">{totalDraftEvents}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-wide opacity-70">Picks / Bans</p>
                <p className="mt-1 text-xl font-semibold">{totalDraftPicks} / {totalDraftBans}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-wide opacity-70">Team-side picks / bans</p>
                <p className="mt-1 text-xl font-semibold">{teamSidePicks} / {teamSideBans}</p>
                <p className="text-xs text-zinc-500">Enemy: {enemySidePicks} / {enemySideBans}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/70">
                  <tr>
                    <th className="p-3 text-left">Hero</th>
                    <th className="p-3 text-left">Total picks</th>
                    <th className="p-3 text-left">Total bans</th>
                    <th className="p-3 text-left">Team picks</th>
                    <th className="p-3 text-left">Team bans</th>
                    <th className="p-3 text-left">Enemy picks</th>
                    <th className="p-3 text-left">Enemy bans</th>
                  </tr>
                </thead>
                <tbody>
                  {draftHeroRows.map((entry) => (
                    <tr key={`draft-hero-${entry.heroId}`} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                      <td className="p-3">
                        <span className="inline-flex items-center gap-2">
                          {heroSmallIconPath(entry.heroId) ? (
                            <HeroIcon
                              src={heroSmallIconPath(entry.heroId)}
                              alt={heroName(entry.heroId)}
                              width={18}
                              height={18}
                              className="h-4.5 w-4.5 rounded object-cover border border-zinc-700"
                            />
                          ) : null}
                          <span>{heroName(entry.heroId)}</span>
                        </span>
                      </td>
                      <td className="p-3 font-mono">{entry.picks}</td>
                      <td className="p-3 font-mono">{entry.bans}</td>
                      <td className="p-3 font-mono text-emerald-300">{entry.teamPicks}</td>
                      <td className="p-3 font-mono text-emerald-300">{entry.teamBans}</td>
                      <td className="p-3 font-mono text-blue-300">{entry.enemyPicks}</td>
                      <td className="p-3 font-mono text-blue-300">{entry.enemyBans}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-400">No draft data found for this team in the selected range.</p>
        )}
      </section>
    </main>
  );
}
