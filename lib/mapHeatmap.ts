import { DEADLOCK_PATH_GRID_BOUNDS, DEADLOCK_WORLD_BOUNDS } from "./mapBounds";

export type HeatmapPoint = {
  x: number;
  y: number;
  weight: number;
  meta?: HeatmapEventMeta;
};

export type HeatmapEventMeta = {
  type: "kill" | "death" | "presence";
  timeS: number | null;
  actor: string;
  target: string;
  by: string;
  matchId?: string | null;
  actorHeroId?: string | null;
  targetHeroId?: string | null;
};

export type HeatmapCell = {
  x: number;
  y: number;
  value: number;
  events: HeatmapEventMeta[];
};

export type HeatmapSeries = {
  cells: HeatmapCell[];
  maxValue: number;
  totalWeight: number;
  pointCount: number;
};

const COORD_PATH_PAIRS: Array<[string, string]> = [
  ["x", "y"],
  ["x", "z"],
  ["X", "Y"],
  ["X", "Z"],
  ["pos_x", "pos_y"],
  ["pos_x", "pos_z"],
  ["posX", "posY"],
  ["posX", "posZ"],
  ["position_x", "position_y"],
  ["position_x", "position_z"],
  ["positionX", "positionY"],
  ["positionX", "positionZ"],
  ["location_x", "location_y"],
  ["location_x", "location_z"],
  ["locationX", "locationY"],
  ["locationX", "locationZ"],
  ["world_x", "world_y"],
  ["world_x", "world_z"],
  ["position.x", "position.y"],
  ["position.x", "position.z"],
  ["pos.x", "pos.y"],
  ["pos.x", "pos.z"],
  ["location.x", "location.y"],
  ["location.x", "location.z"],
  ["origin.x", "origin.y"],
  ["origin.x", "origin.z"],
  ["coords.x", "coords.y"],
  ["coords.x", "coords.z"],
  ["player_position.x", "player_position.y"],
  ["player_position.x", "player_position.z"],
  ["player_pos.x", "player_pos.y"],
  ["player_pos.x", "player_pos.z"],
  ["player_location.x", "player_location.y"],
  ["player_location.x", "player_location.z"],
  ["location.pos_x", "location.pos_y"],
  ["location.pos_x", "location.pos_z"],
  ["position.pos_x", "position.pos_y"],
  ["position.pos_x", "position.pos_z"],
];

const KILL_PATHS = ["kills", "player_kills", "kill_count", "stats.kills", "stats.kill_count"];
const DEATH_PATHS = ["deaths", "player_deaths", "death_count", "stats.deaths", "stats.death_count"];

function safeNum(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function readFiniteNum(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function getByPath(source: any, path: string): unknown {
  const parts = path.split(".");
  let current = source;

  for (const part of parts) {
    current = current?.[part];
  }

  return current;
}

function normalizeRaw(raw: unknown): any {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed ?? {};
    } catch {
      return {};
    }
  }
  return raw;
}

function findPlayerBySlot(raw: any, slot: number | null): any | null {
  if (slot == null) return null;

  const players = Array.isArray(raw?.match_info?.players)
    ? raw.match_info.players
    : Array.isArray(raw?.players)
      ? raw.players
      : [];

  for (const player of players) {
    const playerSlot = Number(player?.player_slot ?? player?.playerSlot ?? NaN);
    if (Number.isFinite(playerSlot) && Math.trunc(playerSlot) === slot) {
      return player;
    }
  }

  return null;
}

function pickSnapshotArray(raw: any): any[] {
  const candidates = [
    raw?.stats,
    raw?.player_stats,
    raw?.timeline,
    raw?.snapshots,
    raw?.player?.stats,
    raw?.player_data?.stats,
    raw?.match_player?.stats,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function findCoordPairDeep(source: any, depth = 0): { x: number; y: number } | null {
  if (!source || depth > 4) return null;

  if (Array.isArray(source)) {
    if (source.length >= 2) {
      const x = readFiniteNum(source[0]);
      const y = readFiniteNum(source[1]);
      if (x != null && y != null) return { x, y };
    }

    for (const entry of source) {
      const nested = findCoordPairDeep(entry, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  if (typeof source !== "object") return null;

  const obj = source as Record<string, unknown>;

  const vectorStringKeys = ["position", "pos", "location", "origin", "coords", "world_pos", "player_pos"];
  for (const key of vectorStringKeys) {
    const value = obj[key];
    if (typeof value === "string") {
      const parts = value
        .split(/[,\s|;]+/)
        .map((part) => readFiniteNum(part))
        .filter((part): part is number => part != null);
      if (parts.length >= 2) {
        return { x: parts[0], y: parts[1] };
      }
    }
  }

  const keyPairs: Array<[string, string]> = [
    ["x", "y"],
    ["x", "z"],
    ["X", "Y"],
    ["X", "Z"],
    ["pos_x", "pos_y"],
    ["pos_x", "pos_z"],
    ["position_x", "position_y"],
    ["position_x", "position_z"],
    ["location_x", "location_y"],
    ["location_x", "location_z"],
    ["world_x", "world_y"],
    ["world_x", "world_z"],
    ["posX", "posY"],
    ["posX", "posZ"],
    ["positionX", "positionY"],
    ["positionX", "positionZ"],
    ["locationX", "locationY"],
    ["locationX", "locationZ"],
  ];

  for (const [xKey, yKey] of keyPairs) {
    const x = readFiniteNum(obj[xKey]);
    const y = readFiniteNum(obj[yKey]);
    if (x != null && y != null) return { x, y };
  }

  const numericEntries = Object.entries(obj)
    .map(([key, value]) => ({ key, value: readFiniteNum(value) }))
    .filter((entry): entry is { key: string; value: number } => entry.value != null);

  if (numericEntries.length >= 2) {
    const xCandidate = numericEntries.find((entry) => {
      const k = entry.key.toLowerCase();
      return (
        k === "x" ||
        k.endsWith("_x") ||
        k.endsWith(".x") ||
        k.includes("posx") ||
        k.includes("positionx") ||
        ((k.includes("pos") || k.includes("loc") || k.includes("origin") || k.includes("coord") || k.includes("vec")) && k.includes("x"))
      );
    });

    const yCandidate = numericEntries.find((entry) => {
      const k = entry.key.toLowerCase();
      return (
        k === "y" ||
        k === "z" ||
        k.endsWith("_y") ||
        k.endsWith("_z") ||
        k.endsWith(".y") ||
        k.endsWith(".z") ||
        k.includes("posy") ||
        k.includes("posz") ||
        k.includes("positiony") ||
        k.includes("positionz") ||
        ((k.includes("pos") || k.includes("loc") || k.includes("origin") || k.includes("coord") || k.includes("vec")) && (k.includes("y") || k.includes("z")))
      );
    });

    if (xCandidate && yCandidate) {
      return { x: xCandidate.value, y: yCandidate.value };
    }
  }

  for (const value of Object.values(obj)) {
    const nested = findCoordPairDeep(value, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function extractCount(snapshot: any, paths: string[]): number {
  for (const path of paths) {
    const value = safeNum(getByPath(snapshot, path));
    if (value >= 0) return value;
  }

  return 0;
}

function extractCoordPair(snapshot: any): { x: number; y: number } | null {
  const arrayCandidates = [snapshot?.position, snapshot?.pos, snapshot?.location, snapshot?.origin, snapshot?.world_pos];
  for (const candidate of arrayCandidates) {
    if (Array.isArray(candidate) && candidate.length >= 2) {
      const x = readFiniteNum(candidate[0]);
      const y = readFiniteNum(candidate[1]);
      if (x != null && y != null) {
        return { x, y };
      }
    }
  }

  for (const [xPath, yPath] of COORD_PATH_PAIRS) {
    const x = readFiniteNum(getByPath(snapshot, xPath));
    const y = readFiniteNum(getByPath(snapshot, yPath));
    if (x != null && y != null) {
      return { x, y };
    }
  }

  const deepFound = findCoordPairDeep(snapshot);
  if (deepFound) return deepFound;

  return null;
}

function extractPosObject(value: any): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;

  const x = readFiniteNum(value?.x ?? value?.X ?? value?.pos_x ?? value?.posX);
  const y = readFiniteNum(value?.y ?? value?.Y ?? value?.z ?? value?.Z ?? value?.pos_y ?? value?.posY ?? value?.pos_z ?? value?.posZ);

  if (x == null || y == null) return null;
  return { x, y };
}

function buildSlotLabels(raw: any): Map<number, string> {
  const labels = new Map<number, string>();
  const players = Array.isArray(raw?.match_info?.players)
    ? raw.match_info.players
    : Array.isArray(raw?.players)
      ? raw.players
      : [];

  for (const player of players) {
    const slot = Number(player?.player_slot ?? player?.playerSlot ?? NaN);
    if (!Number.isFinite(slot)) continue;
    const accountId = player?.account_id ?? player?.accountId ?? null;
    const heroId = player?.hero_id ?? player?.heroId ?? null;
    const heroLabel = heroId != null ? `Hero ${heroId}` : null;
    if (heroLabel && accountId != null) {
      labels.set(slot, `${heroLabel} (${accountId})`);
    } else if (heroLabel) {
      labels.set(slot, heroLabel);
    } else if (accountId != null) {
      labels.set(slot, `Slot ${slot} (${accountId})`);
    } else {
      labels.set(slot, `Slot ${slot}`);
    }
  }

  return labels;
}

function buildSlotHeroIds(raw: any): Map<number, string> {
  const heroIds = new Map<number, string>();
  const players = Array.isArray(raw?.match_info?.players)
    ? raw.match_info.players
    : Array.isArray(raw?.players)
      ? raw.players
      : [];

  for (const player of players) {
    const slot = Number(player?.player_slot ?? player?.playerSlot ?? NaN);
    if (!Number.isFinite(slot)) continue;
    const heroIdRaw = player?.hero_id ?? player?.heroId ?? null;
    if (heroIdRaw == null) continue;
    const heroId = String(heroIdRaw);
    heroIds.set(slot, heroId);
  }

  return heroIds;
}

function heroIdForSlot(slot: number | null, heroIds: Map<number, string>): string | null {
  if (slot == null || !Number.isFinite(slot)) return null;
  return heroIds.get(slot) ?? null;
}

function labelForSlot(slot: number | null, labels: Map<number, string>, fallback = "Unknown"): string {
  if (slot == null || !Number.isFinite(slot)) return fallback;
  return labels.get(slot) ?? `Slot ${slot}`;
}

function extractCauseLabel(event: any): string {
  const direct = [
    event?.kill_method,
    event?.killMethod,
    event?.damage_source,
    event?.damageSource,
    event?.damage_type,
    event?.damageType,
    event?.ability_name,
    event?.abilityName,
    event?.killer_ability_name,
    event?.killerAbilityName,
    event?.weapon_name,
    event?.weaponName,
    event?.item_name,
    event?.itemName,
  ];

  for (const value of direct) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const idCandidates = [
    event?.ability_id,
    event?.abilityId,
    event?.killer_ability_id,
    event?.killerAbilityId,
    event?.item_id,
    event?.itemId,
  ];

  for (const value of idCandidates) {
    const num = Number(value);
    if (Number.isFinite(num)) return `ID ${num}`;
  }

  return "Unknown";
}

function collectDetailedEventPoints(raw: any, labelSource?: any): {
  kills: HeatmapPoint[];
  deaths: HeatmapPoint[];
  presence: HeatmapPoint[];
} {
  const kills: HeatmapPoint[] = [];
  const deaths: HeatmapPoint[] = [];
  const presence: HeatmapPoint[] = [];
  const source = labelSource ?? raw;
  const sourceMatchIdRaw = source?.match_id ?? source?.matchId ?? source?.match_info?.match_id ?? null;
  const sourceMatchId = sourceMatchIdRaw != null ? String(sourceMatchIdRaw) : null;
  const labels = buildSlotLabels(source);
  const slotHeroIds = buildSlotHeroIds(source);
  const selfSlotRaw = readFiniteNum(raw?.player_slot ?? raw?.playerSlot ?? raw?.slot);
  const selfSlot = selfSlotRaw != null ? Math.trunc(selfSlotRaw) : null;
  const selfHeroId =
    heroIdForSlot(selfSlot, slotHeroIds) ??
    (raw?.hero_id != null ? String(raw.hero_id) : raw?.heroId != null ? String(raw.heroId) : null);

  const deathDetailsSources = [
    raw?.death_details,
    raw?.deathDetails,
    raw?.combat?.death_details,
    raw?.combat?.deathDetails,
  ].filter(Array.isArray) as any[];

  for (const details of deathDetailsSources) {
    for (const event of details) {
      const deathPos = extractPosObject(event?.death_pos ?? event?.deathPos ?? event?.victim_pos ?? event?.victimPos);
      const killerPos = extractPosObject(event?.killer_pos ?? event?.killerPos ?? event?.attacker_pos ?? event?.attackerPos);
      const timeS = readFiniteNum(event?.game_time_s ?? event?.time_s ?? event?.timeStampS ?? event?.time_stamp_s);
      const killerSlotRaw = readFiniteNum(event?.killer_player_slot ?? event?.killerPlayerSlot);
      const killerSlot = killerSlotRaw != null ? Math.trunc(killerSlotRaw) : null;
      const cause = extractCauseLabel(event);
      const selfLabel = labelForSlot(selfSlot, labels, "You");
      const killerLabel = labelForSlot(killerSlot, labels);
      const killerHeroId = heroIdForSlot(killerSlot, slotHeroIds);

      if (deathPos) {
        deaths.push({
          x: deathPos.x,
          y: deathPos.y,
          weight: 1,
          meta: {
            type: "death",
            timeS,
            actor: killerLabel,
            target: selfLabel,
            by: cause,
            matchId: sourceMatchId,
            actorHeroId: killerHeroId,
            targetHeroId: selfHeroId,
          },
        });
        presence.push({
          x: deathPos.x,
          y: deathPos.y,
          weight: 1,
          meta: {
            type: "presence",
            timeS,
            actor: selfLabel,
            target: selfLabel,
            by: "Position",
            matchId: sourceMatchId,
            actorHeroId: selfHeroId,
            targetHeroId: selfHeroId,
          },
        });
      }

      if (killerPos) {
        presence.push({
          x: killerPos.x,
          y: killerPos.y,
          weight: 1,
          meta: {
            type: "presence",
            timeS,
            actor: killerLabel,
            target: selfLabel,
            by: "Position",
            matchId: sourceMatchId,
            actorHeroId: killerHeroId,
            targetHeroId: selfHeroId,
          },
        });
      }
    }
  }

  const killDetailsSources = [
    raw?.kill_details,
    raw?.killDetails,
    raw?.combat?.kill_details,
    raw?.combat?.killDetails,
  ].filter(Array.isArray) as any[];

  for (const details of killDetailsSources) {
    for (const event of details) {
      const killPos = extractPosObject(event?.kill_pos ?? event?.killPos ?? event?.killer_pos ?? event?.killerPos ?? event?.attacker_pos ?? event?.attackerPos);
      const victimPos = extractPosObject(event?.victim_pos ?? event?.victimPos ?? event?.death_pos ?? event?.deathPos);
      const timeS = readFiniteNum(event?.game_time_s ?? event?.time_s ?? event?.timeStampS ?? event?.time_stamp_s);
      const killerSlotRaw = readFiniteNum(event?.killer_player_slot ?? event?.killerPlayerSlot ?? event?.attacker_player_slot ?? event?.attackerPlayerSlot ?? selfSlot);
      const victimSlotRaw = readFiniteNum(event?.victim_player_slot ?? event?.victimPlayerSlot ?? event?.killed_player_slot ?? event?.killedPlayerSlot);
      const killerSlot = killerSlotRaw != null ? Math.trunc(killerSlotRaw) : null;
      const victimSlot = victimSlotRaw != null ? Math.trunc(victimSlotRaw) : null;
      const cause = extractCauseLabel(event);
      const killerLabel = labelForSlot(killerSlot, labels, labelForSlot(selfSlot, labels, "You"));
      const victimLabel = labelForSlot(victimSlot, labels);
      const killerHeroId = heroIdForSlot(killerSlot, slotHeroIds) ?? selfHeroId;
      const victimHeroId = heroIdForSlot(victimSlot, slotHeroIds);

      if (killPos) {
        kills.push({
          x: killPos.x,
          y: killPos.y,
          weight: 1,
          meta: {
            type: "kill",
            timeS,
            actor: killerLabel,
            target: victimLabel,
            by: cause,
            matchId: sourceMatchId,
            actorHeroId: killerHeroId,
            targetHeroId: victimHeroId,
          },
        });
        presence.push({
          x: killPos.x,
          y: killPos.y,
          weight: 1,
          meta: {
            type: "presence",
            timeS,
            actor: killerLabel,
            target: victimLabel,
            by: "Position",
            matchId: sourceMatchId,
            actorHeroId: killerHeroId,
            targetHeroId: victimHeroId,
          },
        });
      }

      if (victimPos) {
        presence.push({
          x: victimPos.x,
          y: victimPos.y,
          weight: 1,
          meta: {
            type: "presence",
            timeS,
            actor: victimLabel,
            target: victimLabel,
            by: "Position",
            matchId: sourceMatchId,
            actorHeroId: victimHeroId,
            targetHeroId: victimHeroId,
          },
        });
      }
    }
  }

  return { kills, deaths, presence };
}

function collectKillPointsFromOtherPlayersDeaths(raw: any, targetPlayerSlot: number | null): HeatmapPoint[] {
  if (targetPlayerSlot == null) return [];

  const players = Array.isArray(raw?.match_info?.players)
    ? raw.match_info.players
    : Array.isArray(raw?.players)
      ? raw.players
      : [];

  const kills: HeatmapPoint[] = [];
  const sourceMatchIdRaw = raw?.match_id ?? raw?.matchId ?? raw?.match_info?.match_id ?? null;
  const sourceMatchId = sourceMatchIdRaw != null ? String(sourceMatchIdRaw) : null;
  const labels = buildSlotLabels(raw);
  const slotHeroIds = buildSlotHeroIds(raw);
  const killerLabel = labelForSlot(targetPlayerSlot, labels, "You");
  const killerHeroId = heroIdForSlot(targetPlayerSlot, slotHeroIds);

  for (const player of players) {
    const playerSlot = Number(player?.player_slot ?? player?.playerSlot ?? NaN);
    if (Number.isFinite(playerSlot) && playerSlot === targetPlayerSlot) {
      continue;
    }

    const deathDetails = Array.isArray(player?.death_details)
      ? player.death_details
      : Array.isArray(player?.deathDetails)
        ? player.deathDetails
        : [];

    for (const event of deathDetails) {
      const killerSlot = Number(event?.killer_player_slot ?? event?.killerPlayerSlot ?? NaN);
      if (!Number.isFinite(killerSlot) || killerSlot !== targetPlayerSlot) continue;

      const deathPos = extractPosObject(event?.death_pos ?? event?.deathPos ?? event?.victim_pos ?? event?.victimPos);
      if (!deathPos) continue;

      const timeS = readFiniteNum(event?.game_time_s ?? event?.time_s ?? event?.timeStampS ?? event?.time_stamp_s);
      const cause = extractCauseLabel(event);
      const victimLabel = labelForSlot(
        Number.isFinite(playerSlot) ? Math.trunc(playerSlot) : null,
        labels,
        Number.isFinite(playerSlot) ? `Slot ${playerSlot}` : "Unknown"
      );
      const victimHeroId = heroIdForSlot(Number.isFinite(playerSlot) ? Math.trunc(playerSlot) : null, slotHeroIds);

      kills.push({
        x: deathPos.x,
        y: deathPos.y,
        weight: 1,
        meta: {
          type: "kill",
          timeS,
          actor: killerLabel,
          target: victimLabel,
          by: cause,
          matchId: sourceMatchId,
          actorHeroId: killerHeroId,
          targetHeroId: victimHeroId,
        },
      });
    }
  }

  return kills;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];

  const clampedQ = Math.min(1, Math.max(0, q));
  const index = (sorted.length - 1) * clampedQ;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];

  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

type CoordBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type Normalizer = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  invertY: boolean;
};

const PATH_GRID_BOUNDS: CoordBounds = DEADLOCK_PATH_GRID_BOUNDS;

const WORLD_BOUNDS: CoordBounds = DEADLOCK_WORLD_BOUNDS;

function resolveBounds(points: HeatmapPoint[]): CoordBounds | null {
  if (!points.length) return null;

  const isPathGrid = points.every(
    (entry) => entry.x >= PATH_GRID_BOUNDS.minX && entry.x <= PATH_GRID_BOUNDS.maxX && entry.y >= PATH_GRID_BOUNDS.minY && entry.y <= PATH_GRID_BOUNDS.maxY
  );

  if (isPathGrid) return PATH_GRID_BOUNDS;

  const isWorldLike = points.every(
    (entry) => entry.x >= WORLD_BOUNDS.minX * 1.4 && entry.x <= WORLD_BOUNDS.maxX * 1.4 && entry.y >= WORLD_BOUNDS.minY * 1.4 && entry.y <= WORLD_BOUNDS.maxY * 1.4
  );

  if (isWorldLike) return WORLD_BOUNDS;

  return null;
}

function createNormalizer(points: HeatmapPoint[]): Normalizer {
  const isAlreadyNormalized = points.every((entry) => entry.x >= 0 && entry.x <= 1 && entry.y >= 0 && entry.y <= 1);
  if (isAlreadyNormalized) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1, invertY: true };
  }

  const knownBounds = resolveBounds(points);
  if (knownBounds) {
    return {
      minX: knownBounds.minX,
      maxX: knownBounds.maxX,
      minY: knownBounds.minY,
      maxY: knownBounds.maxY,
      invertY: true,
    };
  }

  const xs = points.map((entry) => entry.x).sort((a, b) => a - b);
  const ys = points.map((entry) => entry.y).sort((a, b) => a - b);

  let minX = quantile(xs, 0.02);
  let maxX = quantile(xs, 0.98);
  let minY = quantile(ys, 0.02);
  let maxY = quantile(ys, 0.98);

  if (maxX - minX < 1e-6) {
    minX = xs[0];
    maxX = xs[xs.length - 1];
  }
  if (maxY - minY < 1e-6) {
    minY = ys[0];
    maxY = ys[ys.length - 1];
  }

  if (maxX - minX < 1e-6) {
    minX -= 1;
    maxX += 1;
  }
  if (maxY - minY < 1e-6) {
    minY -= 1;
    maxY += 1;
  }

  return { minX, maxX, minY, maxY, invertY: true };
}

function normalizePoint(point: { x: number; y: number }, normalizer: Normalizer): { x: number; y: number } {
  const nx = clamp01((point.x - normalizer.minX) / Math.max(1e-6, normalizer.maxX - normalizer.minX));
  const nyRaw = clamp01((point.y - normalizer.minY) / Math.max(1e-6, normalizer.maxY - normalizer.minY));

  return {
    x: nx,
    y: normalizer.invertY ? clamp01(1 - nyRaw) : nyRaw,
  };
}

function emptySeries(): HeatmapSeries {
  return {
    cells: [],
    maxValue: 0,
    totalWeight: 0,
    pointCount: 0,
  };
}

export function buildHeatmapSeries(points: HeatmapPoint[], gridSize = 34): HeatmapSeries {
  if (!points.length) return emptySeries();
  const normalizer = createNormalizer(points);

  const cells = new Map<string, { value: number; events: HeatmapEventMeta[] }>();
  let totalWeight = 0;

  for (const point of points) {
    const normalized = normalizePoint(point, normalizer);
    const col = Math.max(0, Math.min(gridSize - 1, Math.floor(normalized.x * gridSize)));
    const row = Math.max(0, Math.min(gridSize - 1, Math.floor(normalized.y * gridSize)));
    const key = `${col}:${row}`;

    const weight = point.weight > 0 ? point.weight : 1;
    totalWeight += weight;
    const existing = cells.get(key) ?? { value: 0, events: [] };
    existing.value += weight;
    if (point.meta && existing.events.length < 20) {
      existing.events.push(point.meta);
    }
    cells.set(key, existing);
  }

  const resultCells: HeatmapCell[] = [];
  let maxValue = 0;

  for (const [key, cellData] of cells.entries()) {
    if (cellData.value <= 0) continue;
    const [colRaw, rowRaw] = key.split(":");
    const col = Number(colRaw);
    const row = Number(rowRaw);
    const events = [...cellData.events].sort((a, b) => {
      const ta = a.timeS ?? Number.POSITIVE_INFINITY;
      const tb = b.timeS ?? Number.POSITIVE_INFINITY;
      return ta - tb;
    });
    resultCells.push({
      x: (col + 0.5) / gridSize,
      y: (row + 0.5) / gridSize,
      value: cellData.value,
      events,
    });
    if (cellData.value > maxValue) maxValue = cellData.value;
  }

  return {
    cells: resultCells,
    maxValue,
    totalWeight,
    pointCount: points.length,
  };
}

export function extractHeatmapEventPoints(playerRawJson: unknown): {
  kills: HeatmapPoint[];
  deaths: HeatmapPoint[];
  presence: HeatmapPoint[];
} {
  const rawInput: any = playerRawJson;
  const rawSource =
    rawInput && typeof rawInput === "object" && rawInput.__heatmapRaw !== undefined
      ? rawInput.__heatmapRaw
      : rawInput;

  const raw: any = normalizeRaw(rawSource);
  const sourceMatchIdRaw = rawInput?.__heatmapMatchId ?? raw?.match_id ?? raw?.matchId ?? raw?.match_info?.match_id ?? null;
  const sourceMatchId = sourceMatchIdRaw != null ? String(sourceMatchIdRaw) : null;
  const strictPlayerOnly = Boolean(rawInput?.__heatmapStrictPlayer);
  const targetPlayerSlotNum = readFiniteNum(
    rawInput?.__heatmapTargetSlot ?? raw?.player_slot ?? raw?.playerSlot ?? raw?.slot
  );
  const targetPlayerSlot = targetPlayerSlotNum != null ? Math.trunc(targetPlayerSlotNum) : null;
  const targetPlayerRaw = findPlayerBySlot(raw, targetPlayerSlot) ?? raw;
  const snapshots: any[] = pickSnapshotArray(targetPlayerRaw);
  const snapshotStep = Math.max(1, Math.floor(snapshots.length / 600));

  const kills: HeatmapPoint[] = [];
  const snapshotKills: HeatmapPoint[] = [];
  const deaths: HeatmapPoint[] = [];
  const snapshotDeaths: HeatmapPoint[] = [];
  const presence: HeatmapPoint[] = [];

  let lastPresenceX: number | null = null;
  let lastPresenceY: number | null = null;

  for (let index = 0; index < snapshots.length; index += snapshotStep) {
    const current = snapshots[index] ?? {};
    const previous = index > 0 ? snapshots[index - 1] ?? {} : null;

    const coord = extractCoordPair(current);
    if (!coord) continue;

    const isSameAsLast =
      lastPresenceX != null &&
      lastPresenceY != null &&
      Math.abs(coord.x - lastPresenceX) < 1e-6 &&
      Math.abs(coord.y - lastPresenceY) < 1e-6;

    if (!isSameAsLast) {
      presence.push({
        x: coord.x,
        y: coord.y,
        weight: 1,
        meta: {
          type: "presence",
          timeS: readFiniteNum(current?.time_stamp_s ?? current?.timeStampS ?? current?.game_time_s),
          actor: "You",
          target: "You",
          by: "Position",
          matchId: sourceMatchId,
        },
      });
      lastPresenceX = coord.x;
      lastPresenceY = coord.y;
    }

    if (!previous) continue;

    const killDelta = extractCount(current, KILL_PATHS) - extractCount(previous, KILL_PATHS);
    const deathDelta = extractCount(current, DEATH_PATHS) - extractCount(previous, DEATH_PATHS);

    if (killDelta > 0) {
      snapshotKills.push({
        x: coord.x,
        y: coord.y,
        weight: killDelta,
        meta: {
          type: "kill",
          timeS: readFiniteNum(current?.time_stamp_s ?? current?.timeStampS ?? current?.game_time_s),
          actor: "You",
          target: "Unknown",
          by: "Snapshot delta",
          matchId: sourceMatchId,
        },
      });
    }

    if (deathDelta > 0) {
      snapshotDeaths.push({
        x: coord.x,
        y: coord.y,
        weight: deathDelta,
        meta: {
          type: "death",
          timeS: readFiniteNum(current?.time_stamp_s ?? current?.timeStampS ?? current?.game_time_s),
          actor: "Unknown",
          target: "You",
          by: "Snapshot delta",
          matchId: sourceMatchId,
        },
      });
    }
  }

  const detailed = collectDetailedEventPoints(targetPlayerRaw, raw);
  const matchBasedKills = collectKillPointsFromOtherPlayersDeaths(raw, targetPlayerSlot);

  if (strictPlayerOnly) {
    if (matchBasedKills.length) {
      kills.push(...matchBasedKills);
    } else {
      kills.push(...detailed.kills);
    }

    deaths.push(...detailed.deaths);
    return { kills, deaths, presence: [] };
  }

  if (matchBasedKills.length) {
    kills.push(...matchBasedKills);
  } else if (detailed.kills.length) {
    kills.push(...detailed.kills);
  } else {
    kills.push(...snapshotKills);
  }

  if (detailed.deaths.length) {
    deaths.push(...detailed.deaths);
  } else {
    deaths.push(...snapshotDeaths);
  }
  presence.push(...detailed.presence);

  return { kills, deaths, presence };
}

export function buildHeatmapSeriesFromPlayerRaw(playerRawJson: unknown, gridSize = 34): {
  kills: HeatmapSeries;
  deaths: HeatmapSeries;
  presence: HeatmapSeries;
} {
  const points = extractHeatmapEventPoints(playerRawJson);
  return {
    kills: buildHeatmapSeries(points.kills, gridSize),
    deaths: buildHeatmapSeries(points.deaths, gridSize),
    presence: buildHeatmapSeries(points.presence, gridSize),
  };
}

export function buildHeatmapSeriesFromManyPlayerRaw(playerRawJsonList: unknown[], gridSize = 34): {
  kills: HeatmapSeries;
  deaths: HeatmapSeries;
  presence: HeatmapSeries;
} {
  const allKills: HeatmapPoint[] = [];
  const allDeaths: HeatmapPoint[] = [];
  const allPresence: HeatmapPoint[] = [];

  for (const raw of playerRawJsonList) {
    const points = extractHeatmapEventPoints(raw);
    allKills.push(...points.kills);
    allDeaths.push(...points.deaths);
    allPresence.push(...points.presence);
  }

  return {
    kills: buildHeatmapSeries(allKills, gridSize),
    deaths: buildHeatmapSeries(allDeaths, gridSize),
    presence: buildHeatmapSeries(allPresence, gridSize),
  };
}
