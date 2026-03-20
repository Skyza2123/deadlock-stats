import { eq } from "drizzle-orm";

import { db } from "../db";
import { matchPlayers, matches, players } from "../db/schema";
import { heroName } from "./deadlockData";

export type ComparePlayer = {
  steamId: string;
  label: string;
  team: string;
  heroName: string;
  kills: number;
  deaths: number;
  assists: number;
  netWorth: number;
  lastHits: number;
  denies: number;
  level: number;
  soulsPerMin: number;
};

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function numberFromCandidate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function loadMatchCompareData(matchId: string): Promise<{
  matchId: string;
  durationS: number;
  players: ComparePlayer[];
}> {
  const matchRow = await db
    .select({ rawJson: matches.rawJson })
    .from(matches)
    .where(eq(matches.matchId, matchId))
    .limit(1);

  if (matchRow.length === 0) {
    throw new Error("Match not found");
  }

  const raw: any = matchRow[0].rawJson;
  const rawDuration = numberFromCandidate(
    raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? raw?.duration_s ?? raw?.duration
  );
  const durationS = rawDuration != null && rawDuration > 0 ? rawDuration : 1;

  const rows = await db
    .select({
      steamId: matchPlayers.steamId,
      displayName: players.displayName,
      side: matchPlayers.side,
      heroId: matchPlayers.heroId,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      netWorth: matchPlayers.netWorth,
      lastHits: matchPlayers.lastHits,
      denies: matchPlayers.denies,
      level: matchPlayers.level,
    })
    .from(matchPlayers)
    .leftJoin(players, eq(players.steamId, matchPlayers.steamId))
    .where(eq(matchPlayers.matchId, matchId));

  const comparePlayers: ComparePlayer[] = rows.map((row) => {
    const netWorth = safeNum(row.netWorth);
    return {
      steamId: row.steamId,
      label: row.displayName ?? row.steamId,
      team: row.side ?? "unknown",
      heroName: heroName(row.heroId),
      kills: safeNum(row.kills),
      deaths: safeNum(row.deaths),
      assists: safeNum(row.assists),
      netWorth,
      lastHits: safeNum(row.lastHits),
      denies: safeNum(row.denies),
      level: safeNum(row.level),
      soulsPerMin: netWorth / Math.max(1, durationS / 60),
    };
  });

  return {
    matchId,
    durationS,
    players: comparePlayers,
  };
}