import { eq, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { db } from "../db";
import { matchPlayers, matches, players } from "../db/schema";
import { getAbilityMeta } from "./abilityCatalog";
import { hasItem, heroName, itemName } from "./deadlockData";
import { itemIconPath } from "./itemIcons";

export type MatchTabKey = "overview" | "timeline" | "lanes" | "charts" | "compare" | "notes" | "vod";

export type TimelineEvent = {
  id: string;
  timeS: number;
  type: "death" | "item" | "ability" | "ability_unlock" | "ability_imbue" | "objective" | "pause" | "other";
  title: string;
  detail: string;
  actorHeroId: string | null;
  itemId: number | null;
  itemIconSrc: string | null;
  abilityId: number | null;
  abilityName: string | null;
  abilityIconSrc: string | null;
  abilityEventKind: "upgrade" | "unlock" | "imbue" | null;
};

export type PhaseInsight = {
  title: string;
  summary: string;
  bullets: string[];
};

export type TeamMetrics = {
  side: "0" | "1";
  label: string;
  kills: number;
  souls: number;
  damage: number;
  healing: number;
};

export type MatchPlayer = {
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

export type NetWorthPoint = {
  timeS: number;
  team0: number;
  team1: number;
};

export type InventoryEvent = {
  gameTimeS: number;
  itemId: number;
  itemName: string;
  itemIconSrc: string | null;
  soldTimeS: number | null;
};

export type PlayerInventoryTimeline = {
  steamId: string;
  label: string;
  team: string;
  heroId: string | null;
  heroName: string;
  inventoryEvents: InventoryEvent[];
};

export type MapSnapshotPoint = {
  timeS: number;
  x: number;
  y: number;
};

export type PlayerMapTimeline = {
  steamId: string;
  label: string;
  team: string;
  heroId: string | null;
  heroName: string;
  snapshots: MapSnapshotPoint[];
};

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

export const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

const DEMO_MATCH_ID = "68623064";

type PlayerRow = {
  steamId: string;
  displayName: string | null;
  side: string | null;
  heroId: string | null;
  rawJson: unknown;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  netWorth: number | null;
  lastHits: number | null;
  denies: number | null;
  level: number | null;
};

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function fmtMetric(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

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

function firstText(obj: any, keys: string[]) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function detectAbilityEventKind(event: any): "unlock" | "upgrade" | "imbue" {
  const rawKind = String(
    event?.event_type ?? event?.eventType ?? event?.kind ?? event?.action ?? event?.type ?? ""
  )
    .toLowerCase()
    .trim();

  if (firstNumeric(event, ["imbued_ability_id", "imbuedAbilityId"]) != null || rawKind.includes("imbue")) {
    return "imbue";
  }

  if (
    rawKind.includes("unlock") ||
    rawKind.includes("learn") ||
    rawKind.includes("acquire") ||
    rawKind.includes("first")
  ) {
    return "unlock";
  }

  return "upgrade";
}

function extractPosXY(candidate: any): { x: number; y: number } | null {
  if (!candidate || typeof candidate !== "object") return null;

  const x = firstNumeric(candidate, [
    "x",
    "X",
    "xpos",
    "xPos",
    "pos_x",
    "posX",
    "position_x",
    "positionX",
    "world_x",
    "worldX",
  ]);
  const y = firstNumeric(candidate, [
    "y",
    "Y",
    "ypos",
    "yPos",
    "z",
    "Z",
    "pos_y",
    "posY",
    "pos_z",
    "posZ",
    "position_y",
    "positionY",
    "position_z",
    "positionZ",
    "world_y",
    "worldY",
    "world_z",
    "worldZ",
  ]);

  if (x == null || y == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x: Number(x), y: Number(y) };
}

function normalizeDraftSide(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "0" || raw === "team1" || raw === "t1" || raw === "hidden king") return "0";
  if (raw === "1" || raw === "team2" || raw === "t2" || raw === "archmother") return "1";
  return String(value);
}

function extractRawParticipants(raw: any): any[] {
  const candidates = [
    raw?.match_info?.players,
    raw?.players,
    raw?.match_info?.participants,
    raw?.participants,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function extractParticipantSide(participant: any) {
  return normalizeDraftSide(
    participant?.side ??
      participant?.team ??
      participant?.team_id ??
      participant?.teamId ??
      participant?.team_number ??
      null
  );
}

function extractTeamScore(raw: any, side: "0" | "1") {
  const direct = firstNumeric(raw?.match_info, [
    side === "0" ? "team0_score" : "team1_score",
    side === "0" ? "score_team0" : "score_team1",
  ]);
  if (direct != null) return direct;

  const indexedSources = [raw?.match_info?.team_scores, raw?.team_scores, raw?.score_by_team];
  for (const source of indexedSources) {
    if (Array.isArray(source)) {
      const fromArray = numberFromCandidate(source[Number(side)]);
      if (fromArray != null) return fromArray;
    }

    if (source && typeof source === "object") {
      const fromObj = numberFromCandidate((source as any)?.[side]);
      if (fromObj != null) return fromObj;
    }
  }

  return null;
}

async function fetchStatlockerMatchPaths(matchId: string) {
  const endpoint = `https://statlocker.gg/api/match/get-match-paths/${encodeURIComponent(matchId)}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || typeof payload !== "object") return null;
    return payload as any;
  } catch {
    return null;
  }
}

async function loadStaticDemoMatchData() {
  try {
    const [demoRaw, demoPathRaw] = await Promise.all([
      readFile(path.join(process.cwd(), "public", "demos", "demo.json"), "utf8"),
      readFile(path.join(process.cwd(), "public", "demos", "demo_path.json"), "utf8"),
    ]);

    const demo = JSON.parse(demoRaw);
    const demoPath = JSON.parse(demoPathRaw);

    return {
      ...(demo && typeof demo === "object" ? demo : {}),
      ...(demoPath && typeof demoPath === "object" ? demoPath : {}),
    };
  } catch {
    return null;
  }
}

function extractCachedStatlockerMatchPaths(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const source = raw as any;
  const candidates = [
    source?.statlockerMatchPaths,
    source?.statlocker_match_paths,
    source?.extensions?.statlockerMatchPaths,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const pathMap = (candidate as any)?.playerMatchPaths;
    if (pathMap && typeof pathMap === "object") {
      return candidate as any;
    }
  }

  return null;
}

async function getOrCacheStatlockerMatchPaths(matchId: string, raw: unknown) {
  const cached = extractCachedStatlockerMatchPaths(raw);
  if (cached) return cached;

  const fetched = await fetchStatlockerMatchPaths(matchId);
  if (!fetched) return null;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rawObject = raw as Record<string, unknown>;
    rawObject.statlockerMatchPaths = fetched;

    try {
      await db
        .update(matches)
        .set({ rawJson: rawObject })
        .where(eq(matches.matchId, matchId));
    } catch {}
  }

  return fetched;
}

function extractStatlockerPathArray(entry: any): any[] {
  const directCandidates = [
    entry?.playerMatchPaths,
    entry?.matchPaths,
    entry?.path,
    entry?.paths,
    entry?.points,
    entry?.positions,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  const nestedCandidates = [entry?.playerMatchPaths, entry?.paths, entry?.positions].filter(
    (candidate) => candidate && typeof candidate === "object"
  );

  for (const nested of nestedCandidates) {
    for (const value of Object.values(nested as Record<string, unknown>)) {
      if (Array.isArray(value)) return value as any[];
    }
  }

  return [];
}

function extractStatlockerSnapshots(entry: any, durationS: number): MapSnapshotPoint[] {
  const points = extractStatlockerPathArray(entry);
  if (!points.length) return [];

  const rows = points
    .map((point, index) => {
      if (!point || typeof point !== "object") return null;

      const explicitTimeS =
        firstNumeric(point, ["time_s", "timeS", "game_time_s", "time_stamp_s", "timestamp_s", "time", "t", "ts"]) ??
        (() => {
          const timeMs = firstNumeric(point, ["time_ms", "timestamp_ms", "ts_ms"]);
          return timeMs != null && Number.isFinite(timeMs) ? Number(timeMs) / 1000 : null;
        })();

      const indexLike = firstNumeric(point, ["index", "idx", "i", "tick", "frame"]) ?? index;

      const coord =
        extractPosXY(point) ??
        extractPosXY(point?.position) ??
        extractPosXY(point?.pos) ??
        extractPosXY(point?.location) ??
        extractPosXY(point?.world_pos) ??
        null;

      if (!coord) return null;

      return {
        explicitTimeS: explicitTimeS != null && Number.isFinite(explicitTimeS) ? Number(explicitTimeS) : null,
        indexLike: Number.isFinite(indexLike) ? Number(indexLike) : index,
        x: coord.x,
        y: coord.y,
      };
    })
    .filter((row): row is { explicitTimeS: number | null; indexLike: number; x: number; y: number } => row != null);

  if (!rows.length) return [];

  const hasExplicitTimes = rows.some((row) => row.explicitTimeS != null);
  const explicitTimes = rows
    .map((row) => row.explicitTimeS)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const maxExplicitTime = explicitTimes.length ? Math.max(...explicitTimes) : 0;
  const likelyExplicitMs = hasExplicitTimes && durationS > 0 && maxExplicitTime > durationS * 5;
  const maxIndex = Math.max(0, ...rows.map((row) => row.indexLike));
  const shouldScaleIndexToDuration = !hasExplicitTimes && maxIndex > Math.max(1, durationS * 1.5);

  const snapshots = rows.map((row) => {
    const fallbackTime =
      shouldScaleIndexToDuration && maxIndex > 0
        ? (row.indexLike / maxIndex) * Math.max(1, durationS)
        : row.indexLike;

    const explicitSeconds = row.explicitTimeS == null ? null : likelyExplicitMs ? row.explicitTimeS / 1000 : row.explicitTimeS;
    const timeS = explicitSeconds ?? fallbackTime;

    return {
      timeS: Math.max(0, Number(timeS)),
      x: Number(row.x),
      y: Number(row.y),
    } satisfies MapSnapshotPoint;
  });

  snapshots.sort((a, b) => a.timeS - b.timeS);
  return snapshots;
}

export async function loadMatchExperienceData(matchId: string): Promise<{
  matchId: string;
  durationS: number;
  score: { team0: number; team1: number };
  winnerLabel: string;
  teamMetrics: TeamMetrics[];
  timeline: TimelineEvent[];
  phaseInsights: PhaseInsight[];
  players: MatchPlayer[];
  netWorthSeries: NetWorthPoint[];
  playerInventories: PlayerInventoryTimeline[];
  playerMapTimelines: PlayerMapTimeline[];
  laneSummary: LaneSummary;
}> {
  const scrimDateColumnCheck = await db.execute(
    sql`select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
  );
  const hasScrimDateColumn = scrimDateColumnCheck.rows.length > 0;

  let matchRow = hasScrimDateColumn
    ? await db
        .select({ matchId: matches.matchId, rawJson: matches.rawJson, scrimDate: matches.scrimDate })
        .from(matches)
        .where(eq(matches.matchId, matchId))
        .limit(1)
    : (
        await db
          .select({ matchId: matches.matchId, rawJson: matches.rawJson })
          .from(matches)
          .where(eq(matches.matchId, matchId))
          .limit(1)
      ).map((row) => ({ ...row, scrimDate: null as Date | null }));

  const usingStaticDemo = matchRow.length === 0 && matchId === DEMO_MATCH_ID;
  if (usingStaticDemo) {
    const demoRawJson = await loadStaticDemoMatchData();
    if (demoRawJson) {
      matchRow = [{ matchId, rawJson: demoRawJson, scrimDate: null as Date | null }];
    }
  }

  if (matchRow.length === 0) {
    throw new Error("Match not found");
  }

  let rows: PlayerRow[] = await db
    .select({
      steamId: matchPlayers.steamId,
      displayName: players.displayName,
      side: matchPlayers.side,
      heroId: matchPlayers.heroId,
      rawJson: matchPlayers.rawJson,
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

  const raw: any = matchRow[0].rawJson;

  if (rows.length === 0 && matchId === DEMO_MATCH_ID) {
    const participants = extractRawParticipants(raw);
    rows = participants
      .map((participant: any, index: number) => {
        const steamId = String(participant?.account_id ?? "").trim();
        if (!steamId) return null;

        const side = normalizeDraftSide(
          participant?.side ??
            participant?.team ??
            participant?.team_id ??
            participant?.teamId ??
            participant?.team_number ??
            null
        );

        return {
          steamId,
          displayName: firstText(participant, ["name", "display_name", "displayName"]),
          side,
          heroId:
            participant?.hero_id != null || participant?.heroId != null
              ? String(participant?.hero_id ?? participant?.heroId)
              : null,
          rawJson: participant,
          kills: firstNumeric(participant, ["kills"]),
          deaths: firstNumeric(participant, ["deaths"]),
          assists: firstNumeric(participant, ["assists"]),
          netWorth: firstNumeric(participant, ["net_worth", "netWorth"]),
          lastHits: firstNumeric(participant, ["last_hits", "creep_kills"]),
          denies: firstNumeric(participant, ["denies"]),
          level: firstNumeric(participant, ["level"]),
        } satisfies PlayerRow;
      })
      .filter((row: PlayerRow | null): row is PlayerRow => row != null);
  }

  const rawDuration = Number(
    raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? raw?.duration_s ?? NaN
  );

  const observedGameTimes: number[] = [];
  const pushObservedTime = (value: unknown) => {
    const n = numberFromCandidate(value);
    if (n != null && Number.isFinite(n) && n >= 0) observedGameTimes.push(n);
  };

  const participantCandidates = extractRawParticipants(raw);
  for (const participant of participantCandidates) {
    const deathDetails = Array.isArray(participant?.death_details) ? participant.death_details : [];
    for (const death of deathDetails) {
      pushObservedTime(death?.game_time_s ?? death?.time_s ?? death?.time_stamp_s);
    }

    const itemEvents = Array.isArray(participant?.items) ? participant.items : [];
    for (const itemEvent of itemEvents) {
      pushObservedTime(itemEvent?.game_time_s ?? itemEvent?.time_s ?? itemEvent?.time_stamp_s);
      pushObservedTime(itemEvent?.sold_time_s ?? itemEvent?.soldTimeS);
    }

    const abilityEventArrays: any[][] = [
      participant?.ability_events,
      participant?.abilityEvents,
      participant?.ability_casts,
      participant?.abilityCasts,
      participant?.cast_events,
      participant?.casts,
      participant?.abilities,
    ].filter(Array.isArray);

    for (const eventArray of abilityEventArrays) {
      for (const abilityEvent of eventArray) {
        pushObservedTime(
          abilityEvent?.game_time_s ??
            abilityEvent?.time_stamp_s ??
            abilityEvent?.time_s ??
            abilityEvent?.cast_time_s ??
            abilityEvent?.event_time_s ??
            abilityEvent?.timestamp_s
        );
      }
    }

    const stats = Array.isArray(participant?.stats) ? participant.stats : [];
    for (const snapshot of stats) {
      pushObservedTime(snapshot?.time_stamp_s ?? snapshot?.game_time_s ?? snapshot?.time_s);
    }
  }

  const observedObjectiveEvents = Array.isArray(raw?.match_info?.objectives)
    ? raw.match_info.objectives
    : Array.isArray(raw?.objectives)
      ? raw.objectives
      : [];
  for (const objective of observedObjectiveEvents) {
    pushObservedTime(objective?.destroyed_time_s ?? objective?.game_time_s ?? objective?.time_s);
  }

  const observedPauseEvents = Array.isArray(raw?.match_info?.match_pauses)
    ? raw.match_info.match_pauses
    : Array.isArray(raw?.match_pauses)
      ? raw.match_pauses
      : [];
  for (const pause of observedPauseEvents) {
    pushObservedTime(pause?.game_time_s ?? pause?.start_time_s ?? pause?.time_s);
  }

  const observedDuration = observedGameTimes.length ? Math.max(...observedGameTimes) : null;
  const durationS = observedDuration != null && observedDuration > 0
    ? observedDuration
    : Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : 1;

  const bySide = new Map<string, PlayerRow[]>();
  for (const row of rows) {
    const side = row.side ?? "unknown";
    const list = bySide.get(side) ?? [];
    list.push(row);
    bySide.set(side, list);
  }

  const teamRows0 = bySide.get("0") ?? [];
  const teamRows1 = bySide.get("1") ?? [];

  const kills0 = teamRows0.reduce((sum, row) => sum + safeNum(row.kills), 0);
  const kills1 = teamRows1.reduce((sum, row) => sum + safeNum(row.kills), 0);

  const participants = extractRawParticipants(raw);
  const participantMeta = participants.map((participant: any, index: number) => {
    const playerSlot = Number(participant?.player_slot ?? index);
    const accountId = String(participant?.account_id ?? "").trim();
    const linkedRow = accountId ? rows.find((row) => row.steamId === accountId) : undefined;
    const side = normalizeDraftSide(participant?.team ?? participant?.side ?? null);
    const label = linkedRow?.displayName ?? `Player ${playerSlot}`;

    return {
      playerSlot,
      accountId,
      side,
      label,
      heroId:
        linkedRow?.heroId ??
        (participant?.hero_id != null || participant?.heroId != null
          ? String(participant?.hero_id ?? participant?.heroId)
          : null),
      participant,
    };
  });

  const participantBySlot = new Map(participantMeta.map((entry) => [entry.playerSlot, entry]));

  const participantDamageBySide: Record<"0" | "1", number> = { "0": 0, "1": 0 };
  const participantHealingBySide: Record<"0" | "1", number> = { "0": 0, "1": 0 };
  let hasParticipantCombatData = false;

  for (const participant of participants) {
    const side = extractParticipantSide(participant);
    if (side !== "0" && side !== "1") continue;

    const heroDamage =
      firstNumeric(participant, [
        "hero_damage_dealt",
        "hero_damage",
        "player_damage",
        "player_damage_dealt",
      ]) ?? 0;

    const healing =
      firstNumeric(participant, [
        "healing_dealt",
        "healing_done",
        "player_healing",
        "healing",
      ]) ?? 0;

    participantDamageBySide[side] += heroDamage;
    participantHealingBySide[side] += healing;
    if (heroDamage > 0 || healing > 0) hasParticipantCombatData = true;
  }

  const rowDamageBySide: Record<"0" | "1", number> = { "0": 0, "1": 0 };
  const rowHealingBySide: Record<"0" | "1", number> = { "0": 0, "1": 0 };

  for (const row of rows) {
    const side = normalizeDraftSide(row.side);
    if (side !== "0" && side !== "1") continue;
    const rowRaw = (row.rawJson ?? {}) as any;

    rowDamageBySide[side] +=
      firstNumeric(rowRaw, ["hero_damage_dealt", "hero_damage", "player_damage", "player_damage_dealt"]) ?? 0;

    rowHealingBySide[side] +=
      firstNumeric(rowRaw, ["healing_dealt", "healing_done", "player_healing", "healing"]) ?? 0;
  }

  const teamDamage = hasParticipantCombatData ? participantDamageBySide : rowDamageBySide;
  const teamHealing = hasParticipantCombatData ? participantHealingBySide : rowHealingBySide;

  const score0 = extractTeamScore(raw, "0") ?? kills0;
  const score1 = extractTeamScore(raw, "1") ?? kills1;

  const winnerSide = normalizeDraftSide(raw?.match_info?.winning_team ?? raw?.winning_team ?? null);
  const winnerLabel = winnerSide === "0" || winnerSide === "1" ? TEAM_NAMES[winnerSide] : "Unknown";

  const timelineEvents: Array<{
    id: string;
    timeS: number;
    type: "death" | "item" | "ability" | "ability_unlock" | "ability_imbue" | "objective" | "pause" | "other";
    title: string;
    detail: string;
    team: "0" | "1" | "unknown";
    actorHeroId: string | null;
    itemId: number | null;
    itemIconSrc: string | null;
    abilityId: number | null;
    abilityName: string | null;
    abilityIconSrc: string | null;
    abilityEventKind: "upgrade" | "unlock" | "imbue" | null;
  }> = [];

  for (const entry of participantMeta) {
    const seenAbilityKeys = new Set<string>();

    const deathDetails = Array.isArray(entry.participant?.death_details)
      ? entry.participant.death_details
      : [];

    for (const death of deathDetails) {
      const timeS = Math.max(0, Number(death?.game_time_s ?? 0));
      const killerSlot = Number(death?.killer_player_slot ?? -1);
      const killer = participantBySlot.get(killerSlot);
      const killerName = killer?.label ?? `Player ${killerSlot}`;
      const killerTeam = killer?.side === "0" || killer?.side === "1" ? killer.side : "unknown";
      const ttk = Number(death?.time_to_kill_s ?? NaN);
      const respawn = Number(death?.death_duration_s ?? NaN);

      timelineEvents.push({
        id: `death-${entry.playerSlot}-${timeS}-${killerSlot}-${timelineEvents.length}`,
        timeS,
        type: "death",
        title: `${entry.label} died`,
        detail: `${killerName} secured the kill${Number.isFinite(ttk) ? ` • TTK ${ttk.toFixed(1)}s` : ""}${Number.isFinite(respawn) ? ` • Respawn ${respawn}s` : ""}`,
        team: killerTeam,
        actorHeroId: entry.heroId,
        itemId: null,
        itemIconSrc: null,
        abilityId: null,
        abilityName: null,
        abilityIconSrc: null,
        abilityEventKind: null,
      });
    }

    const itemEvents = Array.isArray(entry.participant?.items) ? entry.participant.items : [];
    for (const itemEvent of itemEvents) {
      const timeS = Math.max(0, Number(itemEvent?.game_time_s ?? 0));
      const itemId = Number(itemEvent?.item_id ?? NaN);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;

      const isKnownShopItem = hasItem(itemId);
      const directAbilityMeta = !isKnownShopItem ? getAbilityMeta(itemId) : null;
      const imbuedAbilityId = firstNumeric(itemEvent, ["imbued_ability_id", "imbuedAbilityId"]);
      const imbuedAbilityMeta =
        imbuedAbilityId != null && Number.isFinite(imbuedAbilityId) && imbuedAbilityId > 0
          ? getAbilityMeta(Number(imbuedAbilityId))
          : null;

      if (!isKnownShopItem && directAbilityMeta) {
        const abilityKey = `id:${itemId}`;
        const abilityEventKind = seenAbilityKeys.has(abilityKey) ? "upgrade" : "unlock";
        seenAbilityKeys.add(abilityKey);

        timelineEvents.push({
          id: `ability-${abilityEventKind}-item-stream-${entry.playerSlot}-${timeS}-${itemId}-${timelineEvents.length}`,
          timeS,
          type: abilityEventKind === "unlock" ? "ability_unlock" : "ability",
          title: `${entry.label} ${abilityEventKind === "unlock" ? "unlocked" : "upgraded"} ${directAbilityMeta.name ?? `Ability ${itemId}`}`,
          detail: `Ability ${abilityEventKind} at ${timeS}s (reported in item stream)`,
          team: entry.side === "0" || entry.side === "1" ? entry.side : "unknown",
          actorHeroId: entry.heroId,
          itemId: null,
          itemIconSrc: null,
          abilityId: itemId,
          abilityName: directAbilityMeta.name ?? `Ability ${itemId}`,
          abilityIconSrc: directAbilityMeta.iconSrc,
          abilityEventKind,
        });
        continue;
      }

      const imbuedDetail = imbuedAbilityMeta?.name ? ` • Imbued: ${imbuedAbilityMeta.name}` : "";

      timelineEvents.push({
        id: `item-${entry.playerSlot}-${timeS}-${itemId}-${timelineEvents.length}`,
        timeS,
        type: "item",
        title: `${entry.label} purchased ${itemName(itemId)}`,
        detail: `Item purchase at ${timeS}s${itemEvent?.sold_time_s ? ` • Sold at ${Number(itemEvent.sold_time_s)}s` : ""}${imbuedDetail}`,
        team: entry.side === "0" || entry.side === "1" ? entry.side : "unknown",
        actorHeroId: entry.heroId,
        itemId,
        itemIconSrc: itemIconPath(itemId),
        abilityId: null,
        abilityName: null,
        abilityIconSrc: null,
        abilityEventKind: null,
      });

      if (imbuedAbilityMeta && Number(imbuedAbilityId) > 0) {
        timelineEvents.push({
          id: `ability-imbue-item-stream-${entry.playerSlot}-${timeS}-${Number(imbuedAbilityId)}-${timelineEvents.length}`,
          timeS,
          type: "ability_imbue",
          title: `${entry.label} imbued ${imbuedAbilityMeta.name ?? `Ability ${Number(imbuedAbilityId)}`}`,
          detail: `Ability imbue at ${timeS}s`,
          team: entry.side === "0" || entry.side === "1" ? entry.side : "unknown",
          actorHeroId: entry.heroId,
          itemId: itemId,
          itemIconSrc: itemIconPath(itemId),
          abilityId: Number(imbuedAbilityId),
          abilityName: imbuedAbilityMeta.name ?? `Ability ${Number(imbuedAbilityId)}`,
          abilityIconSrc: imbuedAbilityMeta.iconSrc,
          abilityEventKind: "imbue",
        });
      }
    }

    const abilityEventArrays: any[][] = [
      entry.participant?.ability_events,
      entry.participant?.abilityEvents,
      entry.participant?.ability_casts,
      entry.participant?.abilityCasts,
      entry.participant?.cast_events,
      entry.participant?.casts,
      entry.participant?.abilities,
    ].filter(Array.isArray);

    for (const eventArray of abilityEventArrays) {
      for (const abilityEvent of eventArray) {
        const timeS =
          firstNumeric(abilityEvent, [
            "game_time_s",
            "time_stamp_s",
            "time_s",
            "cast_time_s",
            "event_time_s",
            "timestamp_s",
          ]) ?? NaN;

        if (!Number.isFinite(timeS)) continue;

        const detectedKind = detectAbilityEventKind(abilityEvent);

        const rawAbilityId = firstNumeric(abilityEvent, [
          "ability_id",
          "abilityId",
          "killer_ability_id",
          "caster_ability_id",
          "imbued_ability_id",
          "imbuedAbilityId",
        ]);

        const parsedAbilityId = rawAbilityId != null ? Number(rawAbilityId) : null;
        const abilityId = parsedAbilityId != null && parsedAbilityId > 0 ? parsedAbilityId : null;
        const directAbilityName = firstText(abilityEvent, [
          "ability_name",
          "abilityName",
          "killer_ability_name",
          "cast_name",
          "name",
        ]);

        const catalogMeta = abilityId != null ? getAbilityMeta(abilityId) : null;
        const abilityName = catalogMeta?.name ?? directAbilityName ?? (abilityId != null ? `Ability ${abilityId}` : null);

  if ((abilityId != null && abilityId <= 0) || abilityName === "Ability 0") continue;
        if (!abilityName && abilityId == null) continue;

        const abilityIconSrc =
          catalogMeta?.iconSrc ??
          firstText(abilityEvent, ["ability_icon", "abilityIcon", "image", "image_webp", "icon"]);

        const abilityKey =
          abilityId != null
            ? `id:${abilityId}`
            : abilityName
              ? `name:${abilityName.toLowerCase()}`
              : null;

        const abilityEventKind =
          detectedKind === "imbue"
            ? "imbue"
            : abilityKey && seenAbilityKeys.has(abilityKey)
              ? "upgrade"
              : "unlock";

        if (abilityKey) seenAbilityKeys.add(abilityKey);

        const timelineType =
          abilityEventKind === "unlock"
            ? "ability_unlock"
            : abilityEventKind === "imbue"
              ? "ability_imbue"
              : "ability";

        const eventVerb =
          abilityEventKind === "unlock"
            ? "unlocked"
            : abilityEventKind === "imbue"
              ? "imbued"
              : "upgraded";

        timelineEvents.push({
          id: `ability-${entry.playerSlot}-${Math.floor(timeS)}-${abilityId ?? "x"}-${timelineEvents.length}`,
          timeS: Math.max(0, timeS),
          type: timelineType,
          title: `${entry.label} ${eventVerb} ${abilityName ?? "an ability"}`,
          detail: `Ability ${abilityEventKind} at ${Math.max(0, Math.floor(timeS))}s`,
          team: entry.side === "0" || entry.side === "1" ? entry.side : "unknown",
          actorHeroId: entry.heroId,
          itemId: null,
          itemIconSrc: null,
          abilityId,
          abilityName,
          abilityIconSrc: abilityIconSrc ?? null,
          abilityEventKind,
        });
      }
    }
  }

  const objectiveEvents = Array.isArray(raw?.match_info?.objectives)
    ? raw.match_info.objectives
    : Array.isArray(raw?.objectives)
      ? raw.objectives
      : [];

  for (const objective of objectiveEvents) {
    const timeS = Math.max(0, Number(objective?.destroyed_time_s ?? 0));
    if (!Number.isFinite(timeS) || timeS <= 0) continue;
    const objectiveTeam = normalizeDraftSide(objective?.team ?? null);
    const objectiveSide = objectiveTeam === "0" || objectiveTeam === "1" ? objectiveTeam : "unknown";
    const objectiveId = Number(objective?.team_objective_id ?? 0);

    timelineEvents.push({
      id: `objective-${objectiveSide}-${objectiveId}-${timeS}-${timelineEvents.length}`,
      timeS,
      type: "objective",
      title: `${objectiveSide === "unknown" ? "Unknown" : TEAM_NAMES[objectiveSide]} objective pressure`,
      detail: `Objective ${objectiveId} destroyed at ${timeS}s`,
      team: objectiveSide,
      actorHeroId: null,
      itemId: null,
      itemIconSrc: null,
      abilityId: null,
      abilityName: null,
      abilityIconSrc: null,
      abilityEventKind: null,
    });
  }

  const pauseEvents = Array.isArray(raw?.match_info?.match_pauses)
    ? raw.match_info.match_pauses
    : Array.isArray(raw?.match_pauses)
      ? raw.match_pauses
      : [];

  for (const pause of pauseEvents) {
    const timeS = Math.max(0, Number(pause?.game_time_s ?? pause?.start_time_s ?? 0));
    if (!Number.isFinite(timeS)) continue;
    timelineEvents.push({
      id: `pause-${timeS}-${timelineEvents.length}`,
      timeS,
      type: "pause",
      title: "Match pause",
      detail: `Pause event logged at ${timeS}s`,
      team: "unknown",
      actorHeroId: null,
      itemId: null,
      itemIconSrc: null,
      abilityId: null,
      abilityName: null,
      abilityIconSrc: null,
      abilityEventKind: null,
    });
  }

  timelineEvents.sort((a, b) => a.timeS - b.timeS);

  const earlyCutoff = Math.max(300, Math.min(480, Math.floor(durationS * 0.33)));
  const midCutoff = Math.max(720, Math.min(1080, Math.floor(durationS * 0.75)));

  function netWorthAtTime(side: "0" | "1", targetTimeS: number) {
    let total = 0;
    for (const entry of participantMeta) {
      if (entry.side !== side) continue;
      const snapshots = Array.isArray(entry.participant?.stats) ? entry.participant.stats : [];
      let best: any = null;
      for (const snapshot of snapshots) {
        const t = Number(snapshot?.time_stamp_s ?? NaN);
        if (!Number.isFinite(t) || t > targetTimeS) break;
        best = snapshot;
      }
      if (best) {
        total += firstNumeric(best, ["net_worth"]) ?? 0;
      } else {
        total += Number(entry.participant?.net_worth ?? 0) || 0;
      }
    }
    return total;
  }

  function killsInRange(startS: number, endS: number, side: "0" | "1") {
    return timelineEvents.filter(
      (event) => event.type === "death" && event.timeS >= startS && event.timeS < endS && event.team === side
    ).length;
  }

  function objectivesInRange(startS: number, endS: number, side: "0" | "1") {
    return timelineEvents.filter(
      (event) => event.type === "objective" && event.timeS >= startS && event.timeS < endS && event.team === side
    ).length;
  }

  const laneSouls0 = netWorthAtTime("0", earlyCutoff);
  const laneSouls1 = netWorthAtTime("1", earlyCutoff);
  const laneLeadSide = laneSouls0 === laneSouls1 ? "unknown" : laneSouls0 > laneSouls1 ? "0" : "1";

  const midKills0 = killsInRange(earlyCutoff, midCutoff, "0");
  const midKills1 = killsInRange(earlyCutoff, midCutoff, "1");
  const endKills0 = killsInRange(midCutoff, Number.MAX_SAFE_INTEGER, "0");
  const endKills1 = killsInRange(midCutoff, Number.MAX_SAFE_INTEGER, "1");
  const endObj0 = objectivesInRange(midCutoff, Number.MAX_SAFE_INTEGER, "0");
  const endObj1 = objectivesInRange(midCutoff, Number.MAX_SAFE_INTEGER, "1");

  const phaseInsights: PhaseInsight[] = [
    {
      title: "Laning",
      summary:
        laneLeadSide === "unknown"
          ? "Both teams were even in lane economy."
          : `${TEAM_NAMES[laneLeadSide as "0" | "1"]} led lane economy by ${fmtMetric(Math.abs(laneSouls0 - laneSouls1))} souls.`,
      bullets: [
        `${TEAM_NAMES["0"]}: ${fmtMetric(laneSouls0)} lane souls by ${earlyCutoff}s`,
        `${TEAM_NAMES["1"]}: ${fmtMetric(laneSouls1)} lane souls by ${earlyCutoff}s`,
        `Early kill pressure: ${TEAM_NAMES["0"]} ${killsInRange(0, earlyCutoff, "0")} vs ${TEAM_NAMES["1"]} ${killsInRange(0, earlyCutoff, "1")}`,
      ],
    },
    {
      title: "Midfight",
      summary:
        midKills0 === midKills1
          ? "Mid game fights were balanced."
          : `${midKills0 > midKills1 ? TEAM_NAMES["0"] : TEAM_NAMES["1"]} won more mid-game fights.`,
      bullets: [
        `Mid kills: ${TEAM_NAMES["0"]} ${midKills0} vs ${TEAM_NAMES["1"]} ${midKills1}`,
        `Hero damage: ${TEAM_NAMES["0"]} ${fmtMetric(teamDamage["0"])} vs ${TEAM_NAMES["1"]} ${fmtMetric(teamDamage["1"])}`,
        `Team healing: ${TEAM_NAMES["0"]} ${fmtMetric(teamHealing["0"])} vs ${TEAM_NAMES["1"]} ${fmtMetric(teamHealing["1"])}`,
      ],
    },
    {
      title: "Endgame",
      summary:
        winnerSide === "0" || winnerSide === "1"
          ? `${TEAM_NAMES[winnerSide]} converted late-game pressure into the win.`
          : "Late-game winner could not be determined.",
      bullets: [
        `Endgame kills: ${TEAM_NAMES["0"]} ${endKills0} vs ${TEAM_NAMES["1"]} ${endKills1}`,
        `Endgame objectives: ${TEAM_NAMES["0"]} ${endObj0} vs ${TEAM_NAMES["1"]} ${endObj1}`,
        `Final score line: ${score0} - ${score1}`,
      ],
    },
  ];

  const comparePlayers: MatchPlayer[] = rows.map((row) => ({
    steamId: row.steamId,
    label: row.displayName ?? row.steamId,
    team: row.side ?? "unknown",
    heroName: heroName(row.heroId),
    kills: safeNum(row.kills),
    deaths: safeNum(row.deaths),
    assists: safeNum(row.assists),
    netWorth: safeNum(row.netWorth),
    lastHits: safeNum(row.lastHits),
    denies: safeNum(row.denies),
    level: safeNum(row.level),
    soulsPerMin: safeNum(row.netWorth) / Math.max(1, durationS / 60),
  }));

  const laneCutoffS = Math.max(1, Math.min(600, Math.floor(durationS)));
  const laneSnapshots: LanePlayerSnapshot[] = participantMeta.map((entry) => {
    const snapshots = Array.isArray(entry.participant?.stats) ? entry.participant.stats : [];

    let bestSnapshot: any = null;
    let bestSnapshotTime = 0;
    for (const snapshot of snapshots) {
      const snapshotTime = firstNumeric(snapshot, ["time_stamp_s", "game_time_s", "time_s"]);
      if (snapshotTime == null || !Number.isFinite(snapshotTime)) continue;
      if (snapshotTime > laneCutoffS) break;
      bestSnapshot = snapshot;
      bestSnapshotTime = Number(snapshotTime);
    }

    const fallback = entry.participant ?? {};
    const source = bestSnapshot ?? fallback;

    const souls = firstNumeric(source, ["net_worth"]) ?? 0;
    const lastHits = firstNumeric(source, ["creep_kills", "last_hits"]) ?? 0;
    const denies = firstNumeric(source, ["denies"]) ?? 0;
    const kills = firstNumeric(source, ["kills"]) ?? 0;
    const deaths = firstNumeric(source, ["deaths"]) ?? 0;
    const assists = firstNumeric(source, ["assists"]) ?? 0;
    const heroDamage = firstNumeric(source, ["player_damage", "hero_damage", "hero_damage_dealt"]) ?? 0;
    const healing = firstNumeric(source, ["player_healing", "healing", "healing_dealt"]) ?? 0;

    const steamId = entry.accountId || `slot-${entry.playerSlot}`;
    const effectiveTime = Math.max(1, Math.min(laneCutoffS, bestSnapshotTime || laneCutoffS));
    const assignedLaneRaw = firstNumeric(entry.participant, ["assigned_lane", "assignedLane", "lane", "lane_id", "laneId"]);
    const assignedLane = assignedLaneRaw != null && Number.isFinite(assignedLaneRaw)
      ? Math.trunc(Number(assignedLaneRaw))
      : null;

    return {
      steamId,
      label: entry.label,
      team: entry.side ?? "unknown",
      assignedLane,
      heroId: entry.heroId,
      heroName: heroName(entry.heroId),
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

  const sortLaneSnapshots = (items: LanePlayerSnapshot[]) =>
    [...items].sort((a, b) => {
      if (b.souls !== a.souls) return b.souls - a.souls;
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.label.localeCompare(b.label);
    });

  const laneSummary: LaneSummary = {
    cutoffS: laneCutoffS,
    team0: sortLaneSnapshots(laneSnapshots.filter((snapshot) => snapshot.team === "0")),
    team1: sortLaneSnapshots(laneSnapshots.filter((snapshot) => snapshot.team === "1")),
  };

  const netWorthByTime = new Map<number, { team0: number; team1: number }>();
  for (const entry of participantMeta) {
    if (entry.side !== "0" && entry.side !== "1") continue;
    const snapshots = Array.isArray(entry.participant?.stats) ? entry.participant.stats : [];
    for (const snapshot of snapshots) {
      const timeS = Number(snapshot?.time_stamp_s ?? NaN);
      if (!Number.isFinite(timeS)) continue;
      const netWorth = firstNumeric(snapshot, ["net_worth"]) ?? 0;
      const existing = netWorthByTime.get(timeS) ?? { team0: 0, team1: 0 };
      if (entry.side === "0") existing.team0 += netWorth;
      if (entry.side === "1") existing.team1 += netWorth;
      netWorthByTime.set(timeS, existing);
    }
  }

  const netWorthSeries = [...netWorthByTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timeS, value]) => ({ timeS, team0: value.team0, team1: value.team1 }));

  if (!netWorthSeries.length) {
    netWorthSeries.push({ timeS: 0, team0: 0, team1: 0 });
  }

  const playerInventoryById = new Map<string, PlayerInventoryTimeline>();

  for (const row of rows) {
    const steamId = row.steamId;
    playerInventoryById.set(steamId, {
      steamId,
      label: row.displayName ?? steamId,
      team: row.side ?? "unknown",
      heroId: row.heroId,
      heroName: heroName(row.heroId),
      inventoryEvents: [],
    });
  }

  for (const participantEntry of participantMeta) {
    const steamId = participantEntry.accountId || `slot-${participantEntry.playerSlot}`;
    const existing = playerInventoryById.get(steamId);
    const base: PlayerInventoryTimeline = existing ?? {
      steamId,
      label: participantEntry.label,
      team: participantEntry.side ?? "unknown",
      heroId: participantEntry.heroId,
      heroName: heroName(participantEntry.heroId),
      inventoryEvents: [],
    };

    base.label = participantEntry.label || base.label;
    base.team = participantEntry.side ?? base.team;
    base.heroId = participantEntry.heroId ?? base.heroId;
    base.heroName = heroName(base.heroId);

    const itemEvents = Array.isArray(participantEntry.participant?.items)
      ? participantEntry.participant.items
      : [];

    for (const itemEvent of itemEvents) {
      const itemId = Number(itemEvent?.item_id ?? NaN);
      if (!Number.isFinite(itemId) || !hasItem(itemId)) continue;

      const gameTimeS = Math.max(0, Number(itemEvent?.game_time_s ?? 0));
      if (!Number.isFinite(gameTimeS)) continue;

      const soldRaw = firstNumeric(itemEvent, ["sold_time_s", "soldTimeS"]);
      const soldTimeS =
        soldRaw != null && Number.isFinite(soldRaw) && soldRaw > 0 && soldRaw <= durationS
          ? Number(soldRaw)
          : null;

      base.inventoryEvents.push({
        gameTimeS,
        itemId,
        itemName: itemName(itemId),
        itemIconSrc: itemIconPath(itemId),
        soldTimeS,
      });
    }

    playerInventoryById.set(steamId, base);
  }

  const playerInventories = [...playerInventoryById.values()]
    .map((playerInventory) => ({
      ...playerInventory,
      inventoryEvents: [...playerInventory.inventoryEvents].sort((a, b) => a.gameTimeS - b.gameTimeS),
    }))
    .sort((a, b) => {
      const rank = (team: string) => (team === "0" ? 0 : team === "1" ? 1 : 2);
      const teamRank = rank(a.team) - rank(b.team);
      if (teamRank !== 0) return teamRank;
      return a.label.localeCompare(b.label);
    });

  const playerMapById = new Map<string, PlayerMapTimeline>();

  const statlockerMatchPaths = await getOrCacheStatlockerMatchPaths(matchId, raw);
  const statlockerPathBySlot = new Map<number, any>();

  const statlockerPlayers =
    statlockerMatchPaths && typeof statlockerMatchPaths === "object"
      ? (statlockerMatchPaths as any).playerMatchPaths
      : null;

  if (Array.isArray(statlockerPlayers)) {
    for (const rawEntry of statlockerPlayers) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const slotFromEntry = firstNumeric(rawEntry, ["playerSlot", "player_slot", "slot"]);
      if (slotFromEntry == null || !Number.isFinite(slotFromEntry)) continue;
      statlockerPathBySlot.set(Number(slotFromEntry), rawEntry);
    }
  } else if (statlockerPlayers && typeof statlockerPlayers === "object") {
    for (const [slotKey, rawEntry] of Object.entries(statlockerPlayers)) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const slotFromEntry = firstNumeric(rawEntry, ["playerSlot", "player_slot", "slot"]);
      const slotFromKey = numberFromCandidate(slotKey);
      const playerSlot =
        slotFromEntry != null && Number.isFinite(slotFromEntry)
          ? Number(slotFromEntry)
          : slotFromKey != null && Number.isFinite(slotFromKey)
            ? Number(slotFromKey)
            : null;

      if (playerSlot == null) continue;
      statlockerPathBySlot.set(playerSlot, rawEntry);
    }
  }

  for (const row of rows) {
    const steamId = row.steamId;
    playerMapById.set(steamId, {
      steamId,
      label: row.displayName ?? steamId,
      team: row.side ?? "unknown",
      heroId: row.heroId,
      heroName: heroName(row.heroId),
      snapshots: [],
    });
  }

  for (const participantEntry of participantMeta) {
    const steamId = participantEntry.accountId || `slot-${participantEntry.playerSlot}`;
    const existing = playerMapById.get(steamId);
    const base: PlayerMapTimeline = existing ?? {
      steamId,
      label: participantEntry.label,
      team: participantEntry.side ?? "unknown",
      heroId: participantEntry.heroId,
      heroName: heroName(participantEntry.heroId),
      snapshots: [],
    };

    base.label = participantEntry.label || base.label;
    base.team = participantEntry.side ?? base.team;
    base.heroId = participantEntry.heroId ?? base.heroId;
    base.heroName = heroName(base.heroId);

    const statlockerEntry =
      statlockerPathBySlot.get(participantEntry.playerSlot) ??
      statlockerPathBySlot.get(participantEntry.playerSlot + 1) ??
      statlockerPathBySlot.get(participantEntry.playerSlot - 1);
    const statlockerSnapshots = extractStatlockerSnapshots(statlockerEntry, durationS);

    let usedStatlockerSnapshots = false;
    if (statlockerSnapshots.length) {
      base.snapshots.push(...statlockerSnapshots);
      usedStatlockerSnapshots = true;
    }

    if (usedStatlockerSnapshots) {
      playerMapById.set(steamId, base);
      continue;
    }

    const stats = Array.isArray(participantEntry.participant?.stats) ? participantEntry.participant.stats : [];
    for (const snapshot of stats) {
      const timeS = firstNumeric(snapshot, ["time_stamp_s", "time_s", "game_time_s", "timestamp_s"]);
      if (timeS == null || !Number.isFinite(timeS)) continue;

      const directPos = extractPosXY(snapshot);
      const nestedPos =
        extractPosXY(snapshot?.position) ??
        extractPosXY(snapshot?.pos) ??
        extractPosXY(snapshot?.location) ??
        extractPosXY(snapshot?.world_pos) ??
        null;

      const pos = directPos ?? nestedPos;
      if (!pos) continue;

      base.snapshots.push({
        timeS: Math.max(0, Number(timeS)),
        x: pos.x,
        y: pos.y,
      });
    }

    const deathDetails = Array.isArray(participantEntry.participant?.death_details)
      ? participantEntry.participant.death_details
      : [];

    for (const death of deathDetails) {
      const timeS = firstNumeric(death, ["game_time_s", "time_s"]);
      if (timeS == null || !Number.isFinite(timeS)) continue;
      const deathPos = extractPosXY(death?.death_pos);
      if (!deathPos) continue;

      base.snapshots.push({
        timeS: Math.max(0, Number(timeS)),
        x: deathPos.x,
        y: deathPos.y,
      });
    }

    playerMapById.set(steamId, base);
  }

  const playerMapTimelines = [...playerMapById.values()]
    .map((playerMap) => ({
      ...playerMap,
      snapshots: [...playerMap.snapshots].sort((a, b) => a.timeS - b.timeS),
    }))
    .sort((a, b) => {
      const rank = (team: string) => (team === "0" ? 0 : team === "1" ? 1 : 2);
      const teamRank = rank(a.team) - rank(b.team);
      if (teamRank !== 0) return teamRank;
      return a.label.localeCompare(b.label);
    });

  return {
    matchId,
    durationS,
    score: { team0: score0, team1: score1 },
    winnerLabel,
    teamMetrics: [
      {
        side: "0",
        label: TEAM_NAMES["0"],
        kills: kills0,
        souls: teamRows0.reduce((sum, row) => sum + safeNum(row.netWorth), 0),
        damage: teamDamage["0"],
        healing: teamHealing["0"],
      },
      {
        side: "1",
        label: TEAM_NAMES["1"],
        kills: kills1,
        souls: teamRows1.reduce((sum, row) => sum + safeNum(row.netWorth), 0),
        damage: teamDamage["1"],
        healing: teamHealing["1"],
      },
    ],
    timeline: timelineEvents.map((event) => ({
      id: event.id,
      timeS: event.timeS,
      type: event.type,
      title: event.title,
      detail: event.detail,
      actorHeroId: event.actorHeroId,
      itemId: event.itemId,
      itemIconSrc: event.itemIconSrc,
      abilityId: event.abilityId,
      abilityName: event.abilityName,
      abilityIconSrc: event.abilityIconSrc,
      abilityEventKind: event.abilityEventKind,
    })),
    phaseInsights,
    players: comparePlayers,
    netWorthSeries,
    playerInventories,
    playerMapTimelines,
    laneSummary,
  };
}
