import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import BackButton from "../../../../components/BackButton";
import { db } from "../../../../db";
import { matchPlayerItems, matchPlayers, matches, teamMemberships, teams } from "../../../../db/schema";
import { authOptions } from "../../../../lib/auth";
import { heroName, itemName } from "../../../../lib/deadlockData";

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

type DraftEventRow = {
  heroId: string;
  side: string | null;
  order: number;
  type: "pick" | "ban";
};

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

type OppSummary = {
  slug: string;
  name: string;
  matches: number;
  wins: number;
  losses: number;
  teamKills: number;
  teamDeaths: number;
  teamAssists: number;
  enemyKills: number;
  enemyDeaths: number;
  enemyAssists: number;
  teamSouls: number;
  enemySouls: number;
  teamBans: number;
  enemyBans: number;
  teamItems: number;
  enemyItems: number;
  teamTopBanHeroId: string | null;
  teamTopBanCount: number;
  enemyTopBanHeroId: string | null;
  enemyTopBanCount: number;
  teamTopItemId: number | null;
  teamTopItemCount: number;
  enemyTopItemId: number | null;
  enemyTopItemCount: number;
};

export default async function EnemyTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string; enemy?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <BackButton />
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
          <h1 className="text-2xl font-bold">Sign in required</h1>
          <p className="mt-2 text-zinc-400">Enemy tracking is hidden until you sign in.</p>
          <a href="/login" className="mt-4 inline-block rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-sm hover:bg-zinc-800">
            Go to login
          </a>
        </section>
      </main>
    );
  }

  const { teamSlug } = await params;
  const resolved = searchParams ? await searchParams : undefined;
  const fromRaw = String(resolved?.from ?? "").trim();
  const toRaw = String(resolved?.to ?? "").trim();
  const enemyRaw = String(resolved?.enemy ?? "").trim();

  const rawUserId = String(((session.user as { id?: string } | undefined)?.id) ?? "");
  const membershipKey = rawUserId.startsWith("user:")
    ? rawUserId.slice(5)
    : rawUserId.startsWith("steam:")
      ? rawUserId.slice(6)
      : "";

  const canViewTeam = membershipKey
    ? (
        await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(
            and(
              eq(teamMemberships.teamId, teamSlug),
              eq(teamMemberships.steamId, membershipKey),
              isNull(teamMemberships.endAt)
            )
          )
          .limit(1)
      ).length > 0
    : false;

  if (!canViewTeam) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <BackButton />
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
          <h1 className="text-2xl font-bold">Forbidden</h1>
          <p className="mt-2 text-zinc-400">You don&apos;t have access to this team.</p>
        </section>
      </main>
    );
  }

  const teamRow = await db.select({ name: teams.name, slug: teams.slug }).from(teams).where(eq(teams.slug, teamSlug)).limit(1);
  if (!teamRow.length) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <BackButton />
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
          <h1 className="text-2xl font-bold">Team not found</h1>
        </section>
      </main>
    );
  }

  const fromDate = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
  const toDate = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : null;
  const hasFromDate = Boolean(fromDate && Number.isFinite(fromDate.getTime()));
  const hasToDate = Boolean(toDate && Number.isFinite(toDate.getTime()));

  const rosterRows = await db
    .select({ steamId: teamMemberships.steamId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamSlug), eq(teamMemberships.role, "manual"), isNull(teamMemberships.endAt)));

  const steamIds = rosterRows.map((row) => row.steamId);

  const teamMatchRows = steamIds.length
    ? await db
        .select({ matchId: matchPlayers.matchId, steamId: matchPlayers.steamId, side: matchPlayers.side })
        .from(matchPlayers)
        .where(inArray(matchPlayers.steamId, steamIds))
    : [];

  const matchIds = [...new Set(teamMatchRows.map((row) => row.matchId))];

  const matchRows = matchIds.length
    ? await db
        .select({ matchId: matches.matchId, rawJson: matches.rawJson, scrimDate: sql<Date | null>`${matches.scrimDate}` })
        .from(matches)
        .where(inArray(matches.matchId, matchIds))
    : [];

  const filteredMatchRows = matchRows.filter((match) => {
    if (!hasFromDate && !hasToDate) return true;
    if (!match.scrimDate) return false;
    const ts = new Date(match.scrimDate).getTime();
    if (hasFromDate && ts < (fromDate as Date).getTime()) return false;
    if (hasToDate && ts > (toDate as Date).getTime()) return false;
    return true;
  });

  const filteredMatchIds = filteredMatchRows.map((row) => row.matchId);

  const allPlayersFiltered = filteredMatchIds.length
    ? await db
        .select({
          matchId: matchPlayers.matchId,
          steamId: matchPlayers.steamId,
          side: matchPlayers.side,
          kills: matchPlayers.kills,
          deaths: matchPlayers.deaths,
          assists: matchPlayers.assists,
          netWorth: matchPlayers.netWorth,
        })
        .from(matchPlayers)
        .where(inArray(matchPlayers.matchId, filteredMatchIds))
    : [];

  const allItemsFiltered = filteredMatchIds.length
    ? await db
        .select({
          matchId: matchPlayerItems.matchId,
          steamId: matchPlayerItems.steamId,
          itemId: matchPlayerItems.itemId,
        })
        .from(matchPlayerItems)
        .where(inArray(matchPlayerItems.matchId, filteredMatchIds))
    : [];

  const teamEntriesByMatch = new Map<string, typeof teamMatchRows>();
  for (const row of teamMatchRows) {
    if (!filteredMatchIds.includes(row.matchId)) continue;
    const list = teamEntriesByMatch.get(row.matchId) ?? [];
    list.push(row);
    teamEntriesByMatch.set(row.matchId, list);
  }

  const matchRawById = new Map(filteredMatchRows.map((match) => [match.matchId, match.rawJson]));

  const teamSideByMatch = new Map<string, string>();
  const winnerByMatch = new Map<string, string | null>();
  for (const match of filteredMatchRows) {
    const rows = teamEntriesByMatch.get(match.matchId) ?? [];
    const sideCounts = new Map<string, number>();
    for (const row of rows) {
      const side = row.side ?? "unknown";
      sideCounts.set(side, (sideCounts.get(side) ?? 0) + 1);
    }
    let dominant: string | null = null;
    let best = -1;
    for (const [side, count] of sideCounts.entries()) {
      if (side === "unknown") continue;
      if (count > best) {
        dominant = side;
        best = count;
      }
    }
    if (dominant) teamSideByMatch.set(match.matchId, dominant);
    const raw: any = match.rawJson;
    winnerByMatch.set(match.matchId, raw?.match_info?.winning_team != null ? String(raw.match_info.winning_team) : null);
  }

  const enemySteamIds = new Set<string>();
  for (const row of allPlayersFiltered) {
    const teamSide = teamSideByMatch.get(row.matchId);
    if (!teamSide || row.side == null) continue;
    const enemySide = teamSide === "0" ? "1" : "0";
    if (row.side === enemySide) enemySteamIds.add(row.steamId);
  }

  const enemyMemberships = enemySteamIds.size
    ? await db
        .select({ steamId: teamMemberships.steamId, teamSlug: teamMemberships.teamId, teamName: teams.name })
        .from(teamMemberships)
        .leftJoin(teams, eq(teams.slug, teamMemberships.teamId))
        .where(
          and(
            inArray(teamMemberships.steamId, [...enemySteamIds]),
            isNull(teamMemberships.endAt),
            inArray(teamMemberships.role, ["manual", "player", "member", "manager", "owner"])
          )
        )
    : [];

  const membershipsBySteam = new Map<string, Array<{ teamSlug: string; teamName: string }>>();
  for (const row of enemyMemberships) {
    const teamSlugValue = String(row.teamSlug ?? "").trim();
    if (!teamSlugValue || teamSlugValue === teamSlug) continue;
    const list = membershipsBySteam.get(row.steamId) ?? [];
    list.push({ teamSlug: teamSlugValue, teamName: row.teamName ?? teamSlugValue });
    membershipsBySteam.set(row.steamId, list);
  }

  const summaryByEnemy = new Map<string, OppSummary>();
  const teamBanByEnemy = new Map<string, Map<string, number>>();
  const enemyBanByEnemy = new Map<string, Map<string, number>>();
  const teamItemByEnemy = new Map<string, Map<number, number>>();
  const enemyItemByEnemy = new Map<string, Map<number, number>>();

  const sideByMatchSteam = new Map<string, string>();
  for (const row of allPlayersFiltered) {
    if (!row.side) continue;
    sideByMatchSteam.set(`${row.matchId}:${row.steamId}`, row.side);
  }

  for (const matchId of filteredMatchIds) {
    const teamSide = teamSideByMatch.get(matchId);
    if (!teamSide) continue;
    const enemySide = teamSide === "0" ? "1" : "0";

    const enemyRows = allPlayersFiltered.filter((row) => row.matchId === matchId && row.side === enemySide);
    const matchRaw: any = matchRawById.get(matchId);
    const manualEnemyNameRaw = String(matchRaw?.__ingestMeta?.enemyByTeam?.[teamSlug] ?? "").trim();
    const manualEnemyName = manualEnemyNameRaw.replace(/\s+/g, " ").trim();

    let pickedOpponent: { slug: string; name: string; count: number } | undefined;

    if (manualEnemyName) {
      pickedOpponent = {
        slug: `group-${slugify(manualEnemyName) || "enemy"}`,
        name: manualEnemyName,
        count: enemyRows.length,
      };
    } else {
      const oppCounts = new Map<string, { slug: string; name: string; count: number }>();

      for (const row of enemyRows) {
        const memberships = membershipsBySteam.get(row.steamId) ?? [];
        for (const membership of memberships) {
          const current = oppCounts.get(membership.teamSlug) ?? { slug: membership.teamSlug, name: membership.teamName, count: 0 };
          current.count += 1;
          oppCounts.set(membership.teamSlug, current);
        }
      }

      pickedOpponent = [...oppCounts.values()].sort((a, b) => b.count - a.count)[0];
    }

    if (!pickedOpponent) continue;

    const key = pickedOpponent.slug;
    const existing = summaryByEnemy.get(key) ?? {
      slug: key,
      name: pickedOpponent.name,
      matches: 0,
      wins: 0,
      losses: 0,
      teamKills: 0,
      teamDeaths: 0,
      teamAssists: 0,
      enemyKills: 0,
      enemyDeaths: 0,
      enemyAssists: 0,
      teamSouls: 0,
      enemySouls: 0,
      teamBans: 0,
      enemyBans: 0,
      teamItems: 0,
      enemyItems: 0,
      teamTopBanHeroId: null,
      teamTopBanCount: 0,
      enemyTopBanHeroId: null,
      enemyTopBanCount: 0,
      teamTopItemId: null,
      teamTopItemCount: 0,
      enemyTopItemId: null,
      enemyTopItemCount: 0,
    };

    existing.matches += 1;
    const winner = winnerByMatch.get(matchId);
    if (winner && winner === teamSide) existing.wins += 1;
    else if (winner && winner === enemySide) existing.losses += 1;

    const teamSideRows = allPlayersFiltered.filter((row) => row.matchId === matchId && row.side === teamSide);
    existing.teamKills += teamSideRows.reduce((sum, row) => sum + safeNum(row.kills), 0);
    existing.teamDeaths += teamSideRows.reduce((sum, row) => sum + safeNum(row.deaths), 0);
    existing.teamAssists += teamSideRows.reduce((sum, row) => sum + safeNum(row.assists), 0);
    existing.teamSouls += teamSideRows.reduce((sum, row) => sum + safeNum(row.netWorth), 0);

    existing.enemyKills += enemyRows.reduce((sum, row) => sum + safeNum(row.kills), 0);
    existing.enemyDeaths += enemyRows.reduce((sum, row) => sum + safeNum(row.deaths), 0);
    existing.enemyAssists += enemyRows.reduce((sum, row) => sum + safeNum(row.assists), 0);
    existing.enemySouls += enemyRows.reduce((sum, row) => sum + safeNum(row.netWorth), 0);

    const draftEvents = extractDraftEvents(matchRawById.get(matchId));
    for (const event of draftEvents) {
      if (event.type !== "ban" || event.side == null) continue;
      if (event.side === teamSide) {
        existing.teamBans += 1;
        const map = teamBanByEnemy.get(key) ?? new Map<string, number>();
        map.set(event.heroId, (map.get(event.heroId) ?? 0) + 1);
        teamBanByEnemy.set(key, map);
      } else if (event.side === enemySide) {
        existing.enemyBans += 1;
        const map = enemyBanByEnemy.get(key) ?? new Map<string, number>();
        map.set(event.heroId, (map.get(event.heroId) ?? 0) + 1);
        enemyBanByEnemy.set(key, map);
      }
    }

    for (const row of allItemsFiltered) {
      if (row.matchId !== matchId) continue;
      const side = sideByMatchSteam.get(`${row.matchId}:${row.steamId}`);
      if (!side) continue;
      if (side === teamSide) {
        existing.teamItems += 1;
        const map = teamItemByEnemy.get(key) ?? new Map<number, number>();
        const itemIdNum = Number(row.itemId);
        if (Number.isFinite(itemIdNum)) map.set(itemIdNum, (map.get(itemIdNum) ?? 0) + 1);
        teamItemByEnemy.set(key, map);
      } else if (side === enemySide) {
        existing.enemyItems += 1;
        const map = enemyItemByEnemy.get(key) ?? new Map<number, number>();
        const itemIdNum = Number(row.itemId);
        if (Number.isFinite(itemIdNum)) map.set(itemIdNum, (map.get(itemIdNum) ?? 0) + 1);
        enemyItemByEnemy.set(key, map);
      }
    }

    summaryByEnemy.set(key, existing);
  }

  for (const [slug, summary] of summaryByEnemy.entries()) {
    const teamBanMap = teamBanByEnemy.get(slug) ?? new Map<string, number>();
    const enemyBanMap = enemyBanByEnemy.get(slug) ?? new Map<string, number>();
    const teamItemMap = teamItemByEnemy.get(slug) ?? new Map<number, number>();
    const enemyItemMap = enemyItemByEnemy.get(slug) ?? new Map<number, number>();

    const topTeamBan = [...teamBanMap.entries()].sort((a, b) => b[1] - a[1])[0];
    const topEnemyBan = [...enemyBanMap.entries()].sort((a, b) => b[1] - a[1])[0];
    const topTeamItem = [...teamItemMap.entries()].sort((a, b) => b[1] - a[1])[0];
    const topEnemyItem = [...enemyItemMap.entries()].sort((a, b) => b[1] - a[1])[0];

    summary.teamTopBanHeroId = topTeamBan?.[0] ?? null;
    summary.teamTopBanCount = topTeamBan?.[1] ?? 0;
    summary.enemyTopBanHeroId = topEnemyBan?.[0] ?? null;
    summary.enemyTopBanCount = topEnemyBan?.[1] ?? 0;
    summary.teamTopItemId = topTeamItem?.[0] ?? null;
    summary.teamTopItemCount = topTeamItem?.[1] ?? 0;
    summary.enemyTopItemId = topEnemyItem?.[0] ?? null;
    summary.enemyTopItemCount = topEnemyItem?.[1] ?? 0;
  }

  const opponents = [...summaryByEnemy.values()].sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
  const selectedOpponentSlug = opponents.some((row) => row.slug === enemyRaw) ? enemyRaw : (opponents[0]?.slug ?? "");
  const selected = opponents.find((row) => row.slug === selectedOpponentSlug) ?? null;

  const maxBar = selected
    ? Math.max(
        1,
        selected.teamKills,
        selected.enemyKills,
        selected.teamBans,
        selected.enemyBans,
        selected.teamItems,
        selected.enemyItems,
        selected.teamSouls,
        selected.enemySouls,
      )
    : 1;

  const teamWinRate = selected ? (selected.wins + selected.losses > 0 ? (selected.wins / (selected.wins + selected.losses)) * 100 : 0) : 0;
  const enemyWins = selected?.losses ?? 0;
  const enemyLosses = selected?.wins ?? 0;
  const enemyWinRate = selected ? (enemyWins + enemyLosses > 0 ? (enemyWins / (enemyWins + enemyLosses)) * 100 : 0) : 0;

  const teamKda = selected ? (selected.teamKills + selected.teamAssists) / Math.max(1, selected.teamDeaths) : 0;
  const enemyKda = selected ? (selected.enemyKills + selected.enemyAssists) / Math.max(1, selected.enemyDeaths) : 0;
  const avgSoulsDelta = selected && selected.matches > 0 ? (selected.teamSouls - selected.enemySouls) / selected.matches : 0;

  return (
    <main className="w-full p-5 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <a href={`/teams/${teamSlug}`} className="text-sm text-zinc-300 hover:underline">
          Back to team stats
        </a>
      </div>

      <header className="panel-premium rounded-xl p-4">
        <h1 className="heading-luxe text-3xl font-bold tracking-tight">{teamRow[0].name} enemy tracking</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Switch opponents to compare performance charts across different enemy teams.
        </p>
      </header>

      <section className="panel-premium rounded-xl p-4">
        <form method="GET" className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <input
            name="from"
            type="date"
            defaultValue={fromRaw}
            className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <input
            name="to"
            type="date"
            defaultValue={toRaw}
            className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <select
            name="enemy"
            defaultValue={selectedOpponentSlug}
            className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          >
            {opponents.map((opp) => (
              <option key={opp.slug} value={opp.slug}>{opp.name} ({opp.slug})</option>
            ))}
          </select>
          <button type="submit" className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600">
            Update
          </button>
        </form>
      </section>

      {selected ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="panel-premium-soft rounded-lg p-3">
              <p className="text-xs uppercase opacity-70">Matches vs {selected.name}</p>
              <p className="mt-1 text-xl font-semibold">{selected.matches}</p>
            </div>
            <div className="panel-premium-soft rounded-lg p-3">
              <p className="text-xs uppercase opacity-70">Record</p>
              <p className="mt-1 text-xl font-semibold">{selected.wins}-{selected.losses}</p>
            </div>
            <div className="panel-premium-soft rounded-lg p-3">
              <p className="text-xs uppercase opacity-70">KDA Δ</p>
              <p className={`mt-1 text-xl font-semibold ${teamKda - enemyKda >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{(teamKda - enemyKda >= 0 ? "+" : "") + (teamKda - enemyKda).toFixed(2)}</p>
            </div>
            <div className="panel-premium-soft rounded-lg p-3">
              <p className="text-xs uppercase opacity-70">Avg souls Δ / match</p>
              <p className={`mt-1 text-xl font-semibold ${avgSoulsDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{(avgSoulsDelta >= 0 ? "+" : "") + avgSoulsDelta.toFixed(0)}</p>
            </div>
          </section>

          <section className="panel-premium rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-2">Performance charts</h2>
            <div className="space-y-3 text-sm">
              {[{
                label: "Kills", team: selected.teamKills, enemy: selected.enemyKills,
              }, {
                label: "Bans", team: selected.teamBans, enemy: selected.enemyBans,
              }, {
                label: "Item buys", team: selected.teamItems, enemy: selected.enemyItems,
              }, {
                label: "Souls", team: selected.teamSouls, enemy: selected.enemySouls,
              }].map((row) => (
                <div key={row.label} className="panel-premium-soft rounded p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-medium">{row.label}</p>
                    <p className="font-mono text-xs">{teamRow[0].name} {row.team} • Enemy {row.enemy}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-2 overflow-hidden rounded bg-zinc-800/80">
                      <div className="h-full bg-emerald-400" style={{ width: `${(row.team / maxBar) * 100}%` }} />
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-zinc-800/80">
                      <div className="h-full bg-rose-400" style={{ width: `${(row.enemy / maxBar) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-premium rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-2">Target tendencies</h2>
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">Top banned hero (team)</p>
                <p className="mt-1 font-medium">{selected.teamTopBanHeroId ? `${heroName(selected.teamTopBanHeroId)} (${selected.teamTopBanCount})` : "-"}</p>
              </div>
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">Top banned hero (enemy)</p>
                <p className="mt-1 font-medium">{selected.enemyTopBanHeroId ? `${heroName(selected.enemyTopBanHeroId)} (${selected.enemyTopBanCount})` : "-"}</p>
              </div>
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">Top item (team)</p>
                <p className="mt-1 font-medium">{selected.teamTopItemId != null ? `${itemName(selected.teamTopItemId)} (${selected.teamTopItemCount})` : "-"}</p>
              </div>
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">Top item (enemy)</p>
                <p className="mt-1 font-medium">{selected.enemyTopItemId != null ? `${itemName(selected.enemyTopItemId)} (${selected.enemyTopItemCount})` : "-"}</p>
              </div>
            </div>
          </section>

          <section className="panel-premium rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-2">Opponent pool</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {opponents.map((opp) => {
                const href = `/teams/${teamSlug}/enemy-tracking?${new URLSearchParams({
                  ...(fromRaw ? { from: fromRaw } : {}),
                  ...(toRaw ? { to: toRaw } : {}),
                  enemy: opp.slug,
                }).toString()}`;
                return (
                  <a key={opp.slug} href={href} className={`rounded border p-3 text-sm ${selectedOpponentSlug === opp.slug ? "border-emerald-400/60 bg-emerald-500/10" : "border-zinc-800/80 bg-zinc-900/30 hover:bg-zinc-900/45"}`}>
                    <p className="font-medium">{opp.name}</p>
                    <p className="text-xs text-zinc-500">{opp.slug}</p>
                    <p className="mt-1 text-xs">Matches: <span className="font-mono">{opp.matches}</span></p>
                    <p className="text-xs">Win rate: <span className="font-mono">{(opp.wins + opp.losses > 0 ? (opp.wins / (opp.wins + opp.losses)) * 100 : 0).toFixed(1)}%</span></p>
                  </a>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <section className="panel-premium rounded-xl p-4">
          <p className="text-sm text-zinc-400">No mapped enemy teams found yet for this roster and filter.</p>
        </section>
      )}
    </main>
  );
}
