import { eq } from "drizzle-orm";

import { db } from "../db";
import { matchPlayers, matches, players } from "../db/schema";

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

type PlayerRow = {
  steamId: string;
  displayName: string | null;
  side: string | null;
  rawJson: unknown;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  netWorth: number | null;
};

export type TeamMetrics = {
  side: "0" | "1";
  label: string;
  kills: number;
  souls: number;
  damage: number;
  healing: number;
};

export type NetWorthPoint = {
  timeS: number;
  team0: number;
  team1: number;
};

function numberFromCandidate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumeric(obj: any, keys: string[]) {
  for (const key of keys) {
    const value = numberFromCandidate(obj?.[key]);
    if (value != null) return value;
  }
  return null;
}

function normalizeSide(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "team1" || raw === "t1" || raw === "hidden king") return "0";
  if (raw === "1" || raw === "team2" || raw === "t2" || raw === "archmother") return "1";
  return String(value);
}

function extractDurationS(raw: any, playerRows: PlayerRow[]) {
  const observedTimes: number[] = [];

  for (const row of playerRows) {
    const snapshots = Array.isArray((row.rawJson as any)?.stats) ? (row.rawJson as any).stats : [];
    for (const snapshot of snapshots) {
      const timeS = numberFromCandidate(
        snapshot?.time_stamp_s ?? snapshot?.game_time_s ?? snapshot?.time_s ?? snapshot?.timestamp_s
      );
      if (timeS != null && Number.isFinite(timeS) && timeS >= 0) observedTimes.push(timeS);
    }
  }

  const observed = observedTimes.length ? Math.max(...observedTimes) : null;
  if (observed != null && observed > 0) return observed;

  const rawDuration = numberFromCandidate(
    raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? raw?.duration_s ?? raw?.duration
  );

  return rawDuration != null && rawDuration > 0 ? rawDuration : 1;
}

export async function loadMatchChartsData(matchId: string): Promise<{
  matchId: string;
  durationS: number;
  score: { team0: number; team1: number };
  winnerLabel: string;
  teamMetrics: TeamMetrics[];
  netWorthSeries: NetWorthPoint[];
}> {
  const matchRow = await db
    .select({ matchId: matches.matchId, rawJson: matches.rawJson })
    .from(matches)
    .where(eq(matches.matchId, matchId))
    .limit(1);

  if (matchRow.length === 0) {
    throw new Error("Match not found");
  }

  const rows: PlayerRow[] = await db
    .select({
      steamId: matchPlayers.steamId,
      displayName: players.displayName,
      side: matchPlayers.side,
      rawJson: matchPlayers.rawJson,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      netWorth: matchPlayers.netWorth,
    })
    .from(matchPlayers)
    .leftJoin(players, eq(players.steamId, matchPlayers.steamId))
    .where(eq(matchPlayers.matchId, matchId));

  const raw: any = matchRow[0].rawJson;
  const durationS = extractDurationS(raw, rows);

  const bySide = new Map<string, PlayerRow[]>();
  for (const row of rows) {
    const side = row.side ?? "unknown";
    const list = bySide.get(side) ?? [];
    list.push(row);
    bySide.set(side, list);
  }

  const teamRows0 = bySide.get("0") ?? [];
  const teamRows1 = bySide.get("1") ?? [];

  const score0 =
    firstNumeric(raw?.match_info, ["team0_score", "score_team0"]) ??
    teamRows0.reduce((sum, row) => sum + (row.kills ?? 0), 0);
  const score1 =
    firstNumeric(raw?.match_info, ["team1_score", "score_team1"]) ??
    teamRows1.reduce((sum, row) => sum + (row.kills ?? 0), 0);

  const winnerSide = normalizeSide(raw?.match_info?.winning_team ?? raw?.winning_team ?? null);
  const winnerLabel = winnerSide === "0" || winnerSide === "1" ? TEAM_NAMES[winnerSide] : "Unknown";

  const teamDamage: Record<"0" | "1", number> = { "0": 0, "1": 0 };
  const teamHealing: Record<"0" | "1", number> = { "0": 0, "1": 0 };
  for (const row of rows) {
    const side = normalizeSide(row.side);
    if (side !== "0" && side !== "1") continue;

    const rowRaw = (row.rawJson ?? {}) as any;
    teamDamage[side] +=
      firstNumeric(rowRaw, ["hero_damage_dealt", "hero_damage", "player_damage", "player_damage_dealt"]) ?? 0;
    teamHealing[side] +=
      firstNumeric(rowRaw, ["healing_dealt", "healing_done", "player_healing", "healing"]) ?? 0;
  }

  const netWorthByTime = new Map<number, { team0: number; team1: number }>();
  for (const row of rows) {
    const side = normalizeSide(row.side);
    if (side !== "0" && side !== "1") continue;

    const snapshots = Array.isArray((row.rawJson as any)?.stats) ? (row.rawJson as any).stats : [];
    for (const snapshot of snapshots) {
      const timeS = numberFromCandidate(
        snapshot?.time_stamp_s ?? snapshot?.game_time_s ?? snapshot?.time_s ?? snapshot?.timestamp_s
      );
      if (timeS == null || !Number.isFinite(timeS)) continue;

      const netWorth = firstNumeric(snapshot, ["net_worth"]) ?? 0;
      const existing = netWorthByTime.get(timeS) ?? { team0: 0, team1: 0 };
      if (side === "0") {
        existing.team0 += netWorth;
      } else {
        existing.team1 += netWorth;
      }
      netWorthByTime.set(timeS, existing);
    }
  }

  const netWorthSeries = [...netWorthByTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timeS, value]) => ({ timeS, team0: value.team0, team1: value.team1 }));

  if (!netWorthSeries.length) {
    netWorthSeries.push({
      timeS: 0,
      team0: teamRows0.reduce((sum, row) => sum + (row.netWorth ?? 0), 0),
      team1: teamRows1.reduce((sum, row) => sum + (row.netWorth ?? 0), 0),
    });
  }

  return {
    matchId,
    durationS,
    score: { team0: score0, team1: score1 },
    winnerLabel,
    teamMetrics: [
      {
        side: "0",
        label: TEAM_NAMES["0"],
        kills: teamRows0.reduce((sum, row) => sum + (row.kills ?? 0), 0),
        souls: teamRows0.reduce((sum, row) => sum + (row.netWorth ?? 0), 0),
        damage: teamDamage["0"],
        healing: teamHealing["0"],
      },
      {
        side: "1",
        label: TEAM_NAMES["1"],
        kills: teamRows1.reduce((sum, row) => sum + (row.kills ?? 0), 0),
        souls: teamRows1.reduce((sum, row) => sum + (row.netWorth ?? 0), 0),
        damage: teamDamage["1"],
        healing: teamHealing["1"],
      },
    ],
    netWorthSeries,
  };
}