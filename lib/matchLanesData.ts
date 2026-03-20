import { eq } from "drizzle-orm";

import { db } from "../db";
import { matchPlayers, matches, players } from "../db/schema";
import { heroName } from "./deadlockData";

export type LanePlayerSnapshot = {
  steamId: string;
  label: string;
  team: string;
  assignedLane: number | null;
  heroId: string | null;
  heroName: string;
  timeS: number;
  souls: number;
  lastHits: number;
  denies: number;
  kills: number;
  deaths: number;
  assists: number;
  heroDamage: number;
  healing: number;
  soulsPerMin: number;
};

export type LaneSummary = {
  cutoffS: number;
  team0: LanePlayerSnapshot[];
  team1: LanePlayerSnapshot[];
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

function extractDurationS(raw: any) {
  const rawDuration = numberFromCandidate(
    raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? raw?.duration_s ?? raw?.duration
  );
  return rawDuration != null && rawDuration > 0 ? rawDuration : 1;
}

function sortLaneSnapshots(items: LanePlayerSnapshot[]) {
  return [...items].sort((a, b) => {
    if (b.souls !== a.souls) return b.souls - a.souls;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return a.label.localeCompare(b.label);
  });
}

export async function loadMatchLanesData(matchId: string): Promise<{
  matchId: string;
  laneSummary: LaneSummary;
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
  const durationS = extractDurationS(raw);

  const rows = await db
    .select({
      steamId: matchPlayers.steamId,
      displayName: players.displayName,
      side: matchPlayers.side,
      heroId: matchPlayers.heroId,
      rawJson: matchPlayers.rawJson,
    })
    .from(matchPlayers)
    .leftJoin(players, eq(players.steamId, matchPlayers.steamId))
    .where(eq(matchPlayers.matchId, matchId));

  const laneCutoffS = Math.max(1, Math.min(600, Math.floor(durationS)));
  const laneSnapshots: LanePlayerSnapshot[] = rows.map((row) => {
    const playerRaw = (row.rawJson ?? {}) as any;
    const snapshots = Array.isArray(playerRaw?.stats) ? playerRaw.stats : [];

    let bestSnapshot: any = null;
    let bestSnapshotTime = 0;
    for (const snapshot of snapshots) {
      const snapshotTime = firstNumeric(snapshot, ["time_stamp_s", "game_time_s", "time_s"]);
      if (snapshotTime == null || !Number.isFinite(snapshotTime)) continue;
      if (snapshotTime > laneCutoffS) break;
      bestSnapshot = snapshot;
      bestSnapshotTime = Number(snapshotTime);
    }

    const source = bestSnapshot ?? playerRaw;
    const souls = firstNumeric(source, ["net_worth"]) ?? 0;
    const lastHits = firstNumeric(source, ["creep_kills", "last_hits"]) ?? 0;
    const denies = firstNumeric(source, ["denies"]) ?? 0;
    const kills = firstNumeric(source, ["kills"]) ?? 0;
    const deaths = firstNumeric(source, ["deaths"]) ?? 0;
    const assists = firstNumeric(source, ["assists"]) ?? 0;
    const heroDamage = firstNumeric(source, ["player_damage", "hero_damage", "hero_damage_dealt"]) ?? 0;
    const healing = firstNumeric(source, ["player_healing", "healing", "healing_dealt"]) ?? 0;

    const effectiveTime = Math.max(1, Math.min(laneCutoffS, bestSnapshotTime || laneCutoffS));
    const assignedLaneRaw = firstNumeric(playerRaw, ["assigned_lane", "assignedLane", "lane", "lane_id", "laneId"]);
    const assignedLane = assignedLaneRaw != null && Number.isFinite(assignedLaneRaw)
      ? Math.trunc(Number(assignedLaneRaw))
      : null;

    const heroId = row.heroId ? String(row.heroId) : null;
    const team = normalizeSide(row.side ?? "unknown");

    return {
      steamId: row.steamId,
      label: row.displayName ?? row.steamId,
      team,
      assignedLane,
      heroId,
      heroName: heroName(heroId),
      timeS: effectiveTime,
      souls: Number(souls),
      lastHits: Number(lastHits),
      denies: Number(denies),
      kills: Number(kills),
      deaths: Number(deaths),
      assists: Number(assists),
      heroDamage: Number(heroDamage),
      healing: Number(healing),
      soulsPerMin: Number(souls) / Math.max(1 / 60, effectiveTime / 60),
    };
  });

  const laneSummary: LaneSummary = {
    cutoffS: laneCutoffS,
    team0: sortLaneSnapshots(laneSnapshots.filter((snapshot) => snapshot.team === "0")),
    team1: sortLaneSnapshots(laneSnapshots.filter((snapshot) => snapshot.team === "1")),
  };

  return {
    matchId,
    laneSummary,
  };
}