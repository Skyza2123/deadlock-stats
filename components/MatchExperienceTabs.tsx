"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import HeroIcon from "./HeroIcon";
import { heroCardIconPath, heroSmallIconPath } from "../lib/heroIcons.client";
import { resolveInventorySlotsAtTime } from "../lib/inventoryTimeline";
import { DEADLOCK_PATH_GRID_BOUNDS, DEADLOCK_WORLD_BOUNDS, type MapBounds } from "../lib/mapBounds";

type TabKey = "overview" | "timeline" | "lanes" | "charts" | "compare" | "notes" | "vod";

type TimelineEvent = {
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

type PhaseInsight = {
  title: string;
  summary: string;
  bullets: string[];
};

type TeamMetrics = {
  side: "0" | "1";
  label: string;
  kills: number;
  souls: number;
  damage: number;
  healing: number;
};

type MatchPlayer = {
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

type NetWorthPoint = {
  timeS: number;
  team0: number;
  team1: number;
};

type InventoryEvent = {
  gameTimeS: number;
  itemId: number;
  itemName: string;
  itemIconSrc: string | null;
  soldTimeS: number | null;
};

type PlayerInventoryTimeline = {
  steamId: string;
  label: string;
  team: string;
  heroId: string | null;
  heroName: string;
  inventoryEvents: InventoryEvent[];
};

type MapSnapshotPoint = {
  timeS: number;
  x: number;
  y: number;
};

type PlayerMapTimeline = {
  steamId: string;
  label: string;
  team: string;
  heroId: string | null;
  heroName: string;
  snapshots: MapSnapshotPoint[];
};

type LanePlayerSnapshot = {
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

type LaneSummary = {
  cutoffS: number;
  team0: LanePlayerSnapshot[];
  team1: LanePlayerSnapshot[];
};

type MapOrientation = "standard" | "flipX" | "flipY" | "flipXY";

type LaneOverlay = {
  laneId: 1 | 4 | 6;
  name: string;
  strokeClass: string;
  glowClass: string;
  pathD: string;
  nodes: Array<{ x: number; y: number }>;
};

const MAP_LANE_OVERLAYS: LaneOverlay[] = [
  {
    laneId: 1,
    name: "York",
    strokeClass: "stroke-yellow-300/90",
    glowClass: "stroke-yellow-300/35",
    pathD: "M48.9 0.0 L47.0 13.7 L31.1 26.2 L22.5 31.5 L18.2 36.7 L14.6 50.0 L12.1 61.4 L18.5 67.3 L31.5 75.3 L47.0 86.3 L48.9 100.0",
    nodes: [
      { x: 47, y: 13.7 },
      { x: 31.1, y: 26.2 },
      { x: 22.5, y: 31.5 },
      { x: 18.2, y: 36.7 },
      { x: 14.6, y: 50 },
      { x: 12.1, y: 61.4 },
      { x: 18.5, y: 67.3 },
      { x: 31.5, y: 75.3 },
      { x: 47, y: 86.3 },
    ],
  },
  {
    laneId: 4,
    name: "Broadway",
    strokeClass: "stroke-blue-300/90",
    glowClass: "stroke-blue-300/35",
    pathD: "M50.0 100.0 L50.0 89.3 L46.1 72.5 L48.2 63.7 L51.2 55.7 L50.0 49.3 L48.8 44.3 L51.8 36.3 L53.9 27.5 L50.0 10.7 L50.0 0.0",
    nodes: [
      { x: 50, y: 89.3 },
      { x: 46.1, y: 72.5 },
      { x: 48.2, y: 63.7 },
      { x: 51.2, y: 55.7 },
      { x: 50, y: 49.3 },
      { x: 48.8, y: 44.3 },
      { x: 51.8, y: 36.3 },
      { x: 53.9, y: 27.5 },
      { x: 50, y: 10.7 },
    ],
  },
  {
    laneId: 6,
    name: "Grenich",
    strokeClass: "stroke-emerald-300/90",
    glowClass: "stroke-emerald-300/35",
    pathD: "M51.1 100.0 L53.0 86.3 L69.0 73.8 L77.6 68.5 L81.9 63.3 L85.5 50.0 L88.0 38.6 L81.5 32.7 L68.5 24.7 L53.0 13.7 L51.1 0.0",
    nodes: [
      { x: 53, y: 86.3 },
      { x: 69, y: 73.8 },
      { x: 77.6, y: 68.5 },
      { x: 81.9, y: 63.3 },
      { x: 85.5, y: 50 },
      { x: 88, y: 38.6 },
      { x: 81.5, y: 32.7 },
      { x: 68.5, y: 24.7 },
      { x: 53, y: 13.7 },
    ],
  },
];

function fmtTimeCompact(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function fmtNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function fmtDelta(value: number) {
  if (value > 0) return `+${fmtNumber(value)}`;
  if (value < 0) return `-${fmtNumber(Math.abs(value))}`;
  return "0";
}

function kda(k: number, d: number, a: number) {
  return (k + a) / Math.max(1, d);
}

function clamp01(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function resolveMapBounds(points: MapSnapshotPoint[]): MapBounds {
  if (!points.length) return DEADLOCK_WORLD_BOUNDS;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const isPathGrid = points.every(
    (entry) =>
      entry.x >= DEADLOCK_PATH_GRID_BOUNDS.minX &&
      entry.x <= DEADLOCK_PATH_GRID_BOUNDS.maxX &&
      entry.y >= DEADLOCK_PATH_GRID_BOUNDS.minY &&
      entry.y <= DEADLOCK_PATH_GRID_BOUNDS.maxY
  );
  if (isPathGrid) return DEADLOCK_PATH_GRID_BOUNDS;

  const isPositiveDomainGridLike =
    minX >= 0 &&
    minY >= 0 &&
    maxX > 1000 &&
    maxY > 1000 &&
    !points.some((point) => point.x < 0 || point.y < 0);

  if (isPositiveDomainGridLike) {
    return {
      minX: 0,
      maxX: Math.max(1, maxX),
      minY: 0,
      maxY: Math.max(1, maxY),
    };
  }

  const isWorldLike = points.every(
    (entry) =>
      entry.x >= DEADLOCK_WORLD_BOUNDS.minX * 1.4 &&
      entry.x <= DEADLOCK_WORLD_BOUNDS.maxX * 1.4 &&
      entry.y >= DEADLOCK_WORLD_BOUNDS.minY * 1.4 &&
      entry.y <= DEADLOCK_WORLD_BOUNDS.maxY * 1.4
  );
  if (isWorldLike) return DEADLOCK_WORLD_BOUNDS;

  const xAbsMax = Math.max(...points.map((point) => Math.abs(point.x)));
  const yAbsMax = Math.max(...points.map((point) => Math.abs(point.y)));
  const hasWorldScaleMagnitude = xAbsMax > 1500 || yAbsMax > 1500;
  const hasNegX = points.some((point) => point.x < 0);
  const hasPosX = points.some((point) => point.x > 0);
  const hasNegY = points.some((point) => point.y < 0);
  const hasPosY = points.some((point) => point.y > 0);
  const crossesMapCenter = hasNegX && hasPosX && hasNegY && hasPosY;

  if (hasWorldScaleMagnitude || crossesMapCenter) {
    return DEADLOCK_WORLD_BOUNDS;
  }

  return {
    minX,
    maxX: maxX === minX ? minX + 1 : maxX,
    minY,
    maxY: maxY === minY ? minY + 1 : maxY,
  };
}

function normalizeMapPoint(point: MapSnapshotPoint, bounds: MapBounds) {
  const nx = clamp01((point.x - bounds.minX) / Math.max(1e-6, bounds.maxX - bounds.minX));
  const nyRaw = clamp01((point.y - bounds.minY) / Math.max(1e-6, bounds.maxY - bounds.minY));
  return { x: nx, y: 1 - nyRaw };
}

function applyMapOrientation(
  point: { x: number; y: number },
  orientation: MapOrientation
) {
  if (orientation === "flipX") return { x: 1 - point.x, y: point.y };
  if (orientation === "flipY") return { x: point.x, y: 1 - point.y };
  if (orientation === "flipXY") return { x: 1 - point.x, y: 1 - point.y };
  return point;
}

const MAP_RENDER_INSET_PCT = 5.5;
const MAP_RENDER_SCALE = 100 - MAP_RENDER_INSET_PCT * 2;

function toMapRenderPoint(point: { x: number; y: number }, orientation: MapOrientation) {
  const oriented = applyMapOrientation(point, orientation);
  return {
    x: MAP_RENDER_INSET_PCT + oriented.x * MAP_RENDER_SCALE,
    y: MAP_RENDER_INSET_PCT + oriented.y * MAP_RENDER_SCALE,
  };
}

function laneOverlayTransform(orientation: MapOrientation) {
  if (orientation === "flipX") return "translate(100 0) scale(-1 1)";
  if (orientation === "flipY") return "translate(0 100) scale(1 -1)";
  if (orientation === "flipXY") return "translate(100 100) scale(-1 -1)";
  return "";
}

export default function MatchExperienceTabs({
  activeTab,
  basePath,
  matchId,
  durationS,
  score,
  winnerLabel,
  teamMetrics,
  timeline,
  phaseInsights,
  players,
  netWorthSeries,
  playerInventories,
  playerMapTimelines,
  laneSummary,
}: {
  activeTab: TabKey;
  basePath: string;
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
}) {
  const [leftPlayerId, setLeftPlayerId] = useState<string>(players[0]?.steamId ?? "");
  const [rightPlayerId, setRightPlayerId] = useState<string>(players[1]?.steamId ?? players[0]?.steamId ?? "");

  const [notes, setNotes] = useState("");
  const [vodUrl, setVodUrl] = useState("");
  const [notesSaved, setNotesSaved] = useState<string | null>(null);
  const [vodSaved, setVodSaved] = useState<string | null>(null);
  const [scrubTimeS, setScrubTimeS] = useState<number>(0);
  const [mapOrientation, setMapOrientation] = useState<MapOrientation>("standard");
  const [mapLaneHighlight, setMapLaneHighlight] = useState<1 | 4 | 6 | "all" | null>("all");
  const [selectedLaneIndex, setSelectedLaneIndex] = useState<number>(0);
  const [hoveredLaneStat, setHoveredLaneStat] = useState<{
    rowLabel: string;
    side: "left" | "right";
    playerIndex: number;
  } | null>(null);

  useEffect(() => {
    setScrubTimeS(Math.max(0, Math.floor(durationS)));
  }, [durationS]);

  const notesKey = `deadlock:match:notes:${matchId}`;
  const vodKey = `deadlock:match:vod:${matchId}`;

  useEffect(() => {
    try {
      setNotes(window.localStorage.getItem(notesKey) ?? "");
      setVodUrl(window.localStorage.getItem(vodKey) ?? "");
    } catch {
      setNotes("");
      setVodUrl("");
    }
  }, [notesKey, vodKey]);

  const leftPlayer = useMemo(
    () => players.find((player) => player.steamId === leftPlayerId) ?? null,
    [players, leftPlayerId]
  );
  const rightPlayer = useMemo(
    () => players.find((player) => player.steamId === rightPlayerId) ?? null,
    [players, rightPlayerId]
  );

  const team0 = teamMetrics.find((team) => team.side === "0");
  const team1 = teamMetrics.find((team) => team.side === "1");

  const netWorthMax = Math.max(
    1,
    ...netWorthSeries.map((point) => Math.max(point.team0, point.team1))
  );

  const netWorthPolyline0 = netWorthSeries
    .map((point, index) => {
      const x = netWorthSeries.length <= 1 ? 0 : (index / (netWorthSeries.length - 1)) * 100;
      const y = 100 - (point.team0 / netWorthMax) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  const netWorthPolyline1 = netWorthSeries
    .map((point, index) => {
      const x = netWorthSeries.length <= 1 ? 0 : (index / (netWorthSeries.length - 1)) * 100;
      const y = 100 - (point.team1 / netWorthMax) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  const tabs: Array<{ key: TabKey; label: string; href: string }> = [
    { key: "overview", label: "Overview (main page)", href: basePath },
    { key: "timeline", label: "Timeline", href: `${basePath}/timeline` },
    { key: "lanes", label: "Lanes", href: `${basePath}/lanes` },
    { key: "charts", label: "Charts", href: `${basePath}/charts` },
    { key: "compare", label: "Compare", href: `${basePath}/compare` },
    { key: "notes", label: "Notes", href: `${basePath}/notes` },
    { key: "vod", label: "VOD", href: `${basePath}/vod` },
  ];

  const laneTeam0Souls = laneSummary.team0.reduce((sum, row) => sum + row.souls, 0);
  const laneTeam1Souls = laneSummary.team1.reduce((sum, row) => sum + row.souls, 0);

  const laneTeam0Kills = laneSummary.team0.reduce((sum, row) => sum + row.kills, 0);
  const laneTeam1Kills = laneSummary.team1.reduce((sum, row) => sum + row.kills, 0);

  const laneTeam0Deaths = laneSummary.team0.reduce((sum, row) => sum + row.deaths, 0);
  const laneTeam1Deaths = laneSummary.team1.reduce((sum, row) => sum + row.deaths, 0);

  const laneTeam0LeadText = laneTeam0Souls === laneTeam1Souls
    ? "Lane economy was even."
    : laneTeam0Souls > laneTeam1Souls
      ? `Hidden King led by ${fmtNumber(laneTeam0Souls - laneTeam1Souls)} souls.`
      : `Archmother led by ${fmtNumber(laneTeam1Souls - laneTeam0Souls)} souls.`;

  const lanePalette = (laneId: number | null | undefined) => {
    if (laneId === 1) {
      return {
        name: "York",
        selectedBorder: "border-yellow-500/80",
        selectedText: "text-yellow-300",
        selectedShadow: "shadow-[inset_0_0_0_1px_rgba(234,179,8,0.35),0_0_16px_rgba(234,179,8,0.15)]",
        panelTint: "bg-yellow-950/15",
      };
    }
    if (laneId === 4) {
      return {
        name: "Broadway",
        selectedBorder: "border-blue-500/80",
        selectedText: "text-blue-300",
        selectedShadow: "shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35),0_0_16px_rgba(59,130,246,0.15)]",
        panelTint: "bg-blue-950/15",
      };
    }
    if (laneId === 6) {
      return {
        name: "Grenich",
        selectedBorder: "border-emerald-500/80",
        selectedText: "text-emerald-300",
        selectedShadow: "shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35),0_0_16px_rgba(16,185,129,0.15)]",
        panelTint: "bg-emerald-950/15",
      };
    }
    return {
      name: `Lane ${laneId ?? "?"}`,
      selectedBorder: "border-zinc-500/80",
      selectedText: "text-zinc-300",
      selectedShadow: "shadow-[inset_0_0_0_1px_rgba(113,113,122,0.35),0_0_16px_rgba(113,113,122,0.15)]",
      panelTint: "bg-zinc-900/20",
    };
  };

  const laneGroups = useMemo(() => {
    const laneCutoffS = laneSummary.cutoffS;

    const earlyPosBySteamId = new Map<string, { x: number; y: number }>();
    for (const timeline of playerMapTimelines) {
      let bestPoint: MapSnapshotPoint | null = null;
      for (const snapshot of timeline.snapshots) {
        if (snapshot.timeS > laneCutoffS) break;
        bestPoint = snapshot;
      }
      if (bestPoint) {
        earlyPosBySteamId.set(timeline.steamId, { x: bestPoint.x, y: bestPoint.y });
      }
    }

    const leftWithPos = laneSummary.team0.map((player) => ({
      player,
      pos: earlyPosBySteamId.get(player.steamId) ?? null,
    }));
    const rightWithPos = laneSummary.team1.map((player) => ({
      player,
      pos: earlyPosBySteamId.get(player.steamId) ?? null,
    }));
    const toFixedLanesFromPosition = (
      entries: Array<{ player: LanePlayerSnapshot; pos: { x: number; y: number } | null }>
    ) => {
      const sorted = [...entries].sort((a, b) => {
        if (a.pos && b.pos) return a.pos.x - b.pos.x;
        if (a.pos) return -1;
        if (b.pos) return 1;
        return b.player.souls - a.player.souls;
      });

      const slots: Array<LanePlayerSnapshot | null> = Array.from({ length: 6 }, (_, index) => sorted[index]?.player ?? null);
      return [
        { laneId: 1, index: 0, players: [slots[0], slots[1]] as Array<LanePlayerSnapshot | null> },
        { laneId: 4, index: 1, players: [slots[2], slots[3]] as Array<LanePlayerSnapshot | null> },
        { laneId: 6, index: 2, players: [slots[4], slots[5]] as Array<LanePlayerSnapshot | null> },
      ];
    };

    const hasAssignedLaneData =
      laneSummary.team0.some((player) => player.assignedLane != null) ||
      laneSummary.team1.some((player) => player.assignedLane != null);

    let paired: Array<{ laneId: number; index: number; left: Array<LanePlayerSnapshot | null>; right: Array<LanePlayerSnapshot | null> }> = [];

    if (hasAssignedLaneData) {
      const laneIds = [...new Set([
        ...laneSummary.team0.map((player) => player.assignedLane).filter((lane): lane is number => lane != null),
        ...laneSummary.team1.map((player) => player.assignedLane).filter((lane): lane is number => lane != null),
      ])].sort((a, b) => a - b);

      const effectiveLaneIds = laneIds.length ? laneIds.slice(0, 3) : [1, 4, 6];

      const unassignedLeft = laneSummary.team0.filter((player) => player.assignedLane == null || !effectiveLaneIds.includes(player.assignedLane));
      const unassignedRight = laneSummary.team1.filter((player) => player.assignedLane == null || !effectiveLaneIds.includes(player.assignedLane));

      const fillTwo = (
        teamPlayers: LanePlayerSnapshot[],
        laneId: number,
        overflow: LanePlayerSnapshot[]
      ): Array<LanePlayerSnapshot | null> => {
        const direct = teamPlayers
          .filter((player) => player.assignedLane === laneId)
          .sort((a, b) => b.souls - a.souls);

        const picked: Array<LanePlayerSnapshot | null> = [];
        for (const player of direct) {
          if (picked.length < 2) picked.push(player);
          else overflow.push(player);
        }

        while (picked.length < 2 && overflow.length) {
          picked.push(overflow.shift() ?? null);
        }

        while (picked.length < 2) picked.push(null);
        return picked;
      };

      const leftOverflow = [...unassignedLeft].sort((a, b) => b.souls - a.souls);
      const rightOverflow = [...unassignedRight].sort((a, b) => b.souls - a.souls);

      paired = effectiveLaneIds.map((laneId, index) => ({
        laneId,
        index,
        left: fillTwo(laneSummary.team0, laneId, leftOverflow),
        right: fillTwo(laneSummary.team1, laneId, rightOverflow),
      }));
    } else {
      const leftLanes = toFixedLanesFromPosition(leftWithPos);
      const rightLanes = toFixedLanesFromPosition(rightWithPos);

      const laneCentroid = (players: Array<LanePlayerSnapshot | null>) => {
        const posPoints = players
          .map((player) => (player ? earlyPosBySteamId.get(player.steamId) ?? null : null))
          .filter((point): point is { x: number; y: number } => point != null);

        if (!posPoints.length) return null;
        return {
          x: posPoints.reduce((sum, point) => sum + point.x, 0) / posPoints.length,
          y: posPoints.reduce((sum, point) => sum + point.y, 0) / posPoints.length,
        };
      };

      const remainingRight = [...rightLanes];
      paired = leftLanes.map((leftLane) => {
        const leftCentroid = laneCentroid(leftLane.players);
        let chosenIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let index = 0; index < remainingRight.length; index += 1) {
          const rightLane = remainingRight[index];
          const rightCentroid = laneCentroid(rightLane.players);
          if (!leftCentroid || !rightCentroid) continue;
          const dx = leftCentroid.x - rightCentroid.x;
          const dy = leftCentroid.y - rightCentroid.y;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            chosenIndex = index;
          }
        }

        const [rightLane] = remainingRight.splice(chosenIndex, 1);
        return {
          laneId: leftLane.laneId,
          index: leftLane.index,
          left: leftLane.players,
          right: rightLane?.players ?? [null, null],
        };
      });
    }

    const groupScore = (group: { left: Array<LanePlayerSnapshot | null>; right: Array<LanePlayerSnapshot | null> }) => {
      const leftSouls = group.left.reduce((sum, player) => sum + (player?.souls ?? 0), 0);
      const rightSouls = group.right.reduce((sum, player) => sum + (player?.souls ?? 0), 0);
      return Math.abs(leftSouls - rightSouls);
    };

    const preferredLaneOrder = new Map<number, number>([
      [1, 0],
      [4, 1],
      [6, 2],
    ]);

    return paired
      .map((group) => {
        const leftSouls = group.left.reduce((sum, player) => sum + (player?.souls ?? 0), 0);
        const rightSouls = group.right.reduce((sum, player) => sum + (player?.souls ?? 0), 0);
        const leftLH = group.left.reduce((sum, player) => sum + (player?.lastHits ?? 0), 0);
        const rightLH = group.right.reduce((sum, player) => sum + (player?.lastHits ?? 0), 0);
        const leftDN = group.left.reduce((sum, player) => sum + (player?.denies ?? 0), 0);
        const rightDN = group.right.reduce((sum, player) => sum + (player?.denies ?? 0), 0);
        const leftPressure = group.left.reduce((sum, player) => sum + ((player?.kills ?? 0) + (player?.assists ?? 0) - (player?.deaths ?? 0)), 0);
        const rightPressure = group.right.reduce((sum, player) => sum + ((player?.kills ?? 0) + (player?.assists ?? 0) - (player?.deaths ?? 0)), 0);

        return {
          ...group,
          leftSouls,
          rightSouls,
          soulsDiff: leftSouls - rightSouls,
          lhDiff: leftLH - rightLH,
          deniesDiff: leftDN - rightDN,
          killPressureDiff: leftPressure - rightPressure,
        };
      })
      .sort((a, b) => {
        const aRank = preferredLaneOrder.get(a.laneId) ?? 99;
        const bRank = preferredLaneOrder.get(b.laneId) ?? 99;
        if (aRank !== bRank) return aRank - bRank;
        return a.laneId - b.laneId;
      });
  }, [laneSummary.cutoffS, laneSummary.team0, laneSummary.team1, playerMapTimelines]);

  useEffect(() => {
    if (!laneGroups.length) {
      setSelectedLaneIndex(0);
      return;
    }
    if (selectedLaneIndex > laneGroups.length - 1) {
      setSelectedLaneIndex(0);
    }
  }, [laneGroups, selectedLaneIndex]);

  const abilityTimeline = useMemo(
    () => timeline.filter((event) => event.type === "ability" || event.type === "ability_unlock" || event.type === "ability_imbue"),
    [timeline]
  );

  const primaryTimeline = useMemo(
    () => timeline.filter((event) => event.type !== "ability" && event.type !== "ability_unlock" && event.type !== "ability_imbue"),
    [timeline]
  );

  const scrubbedInventories = useMemo(() => {
    return playerInventories.map((playerInventory) => {
      const slots = resolveInventorySlotsAtTime(playerInventory.inventoryEvents, scrubTimeS, 12);

      return {
        ...playerInventory,
        slots,
      };
    });
  }, [playerInventories, scrubTimeS]);

  const scrubbedMapActors = useMemo(() => {
    const allPoints = playerMapTimelines.flatMap((playerMapTimeline) => playerMapTimeline.snapshots);
    const bounds = resolveMapBounds(allPoints);

    const actors = playerMapTimelines.map((playerMapTimeline) => {
      let latestPoint: MapSnapshotPoint | null = null;
      for (const snapshot of playerMapTimeline.snapshots) {
        if (snapshot.timeS > scrubTimeS) break;
        latestPoint = snapshot;
      }
      return {
        ...playerMapTimeline,
        point: latestPoint,
      };
    });

    return {
      actors,
      bounds,
    };
  }, [playerMapTimelines, scrubTimeS]);

  function saveNotes() {
    try {
      window.localStorage.setItem(notesKey, notes);
      setNotesSaved("Notes saved.");
      setTimeout(() => setNotesSaved(null), 2000);
    } catch {
      setNotesSaved("Could not save notes.");
    }
  }

  function saveVod() {
    try {
      window.localStorage.setItem(vodKey, vodUrl);
      setVodSaved("VOD link saved.");
      setTimeout(() => setVodSaved(null), 2000);
    } catch {
      setVodSaved("Could not save VOD link.");
    }
  }

  function updateScrubTime(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setScrubTimeS(parsed);
  }

  return (
    <section className="space-y-3">
      <nav className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-950/70 px-2 py-1.5">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`rounded px-2.5 py-1 text-[11px] transition ${
              activeTab === tab.key
                ? "border border-zinc-500/70 bg-zinc-800/80 text-zinc-100"
                : "border border-zinc-700/80 bg-zinc-900/70 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <section className="panel-premium rounded-xl p-4 md:p-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-3">
              <p className="text-xs text-zinc-400">Total Match Time</p>
              <p className="mt-2 text-2xl font-bold tracking-tight">{fmtTimeCompact(durationS)}</p>
              <p className="mt-2 text-[11px] text-zinc-500">{(durationS / 60).toFixed(2)} minutes</p>
            </article>

            <article className="rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-3">
              <p className="text-xs text-zinc-400">Score</p>
              <p className="mt-2 text-2xl font-bold tracking-tight">
                {score.team0} - {score.team1}
              </p>
              <p className="mt-2 text-[11px] text-zinc-500">Winner: {winnerLabel}</p>
            </article>

            <article className="rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-3">
              <p className="text-xs text-zinc-400">Hero Damage Dealt</p>
              <p className="mt-2 text-2xl font-bold tracking-tight">
                {fmtNumber(team0?.damage ?? 0)} - {fmtNumber(team1?.damage ?? 0)}
              </p>
              <p className="mt-2 text-[11px] text-zinc-500">{(team0?.label ?? "Team 0")} vs {(team1?.label ?? "Team 1")}</p>
            </article>

            <article className="rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-3">
              <p className="text-xs text-zinc-400">Team Healing Dealt</p>
              <p className="mt-2 text-2xl font-bold tracking-tight">
                {fmtNumber(team0?.healing ?? 0)} - {fmtNumber(team1?.healing ?? 0)}
              </p>
              <p className="mt-2 text-[11px] text-zinc-500">{(team0?.label ?? "Team 0")} vs {(team1?.label ?? "Team 1")}</p>
            </article>
          </div>

          <article className="rounded-xl border border-zinc-800/80 bg-zinc-900/20 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Analysis</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {phaseInsights.map((phase) => (
                <section key={phase.title} className="rounded-lg border border-zinc-800/80 bg-zinc-900/35 p-3">
                  <h3 className="text-sm font-semibold">{phase.title}</h3>
                  <p className="mt-1 text-xs text-zinc-300">{phase.summary}</p>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                    {phase.bullets.map((bullet, index) => (
                      <li key={`${phase.title}-${index}`}>• {bullet}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === "timeline" ? (
        <section className="panel-premium rounded-xl p-4 md:p-5">
          <h2 className="text-base font-semibold">Complete Timeline</h2>
          <p className="mt-1 text-xs text-zinc-500">General and ability timelines are shown side-by-side.</p>

          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
              <h3 className="text-sm font-semibold">General Timeline</h3>
              <p className="mt-1 text-xs text-zinc-500">{primaryTimeline.length} events from the match JSON.</p>

              <div className="mt-3 max-h-[75vh] overflow-auto rounded-lg border border-zinc-800/80 bg-zinc-900/25">
                <ul className="divide-y divide-zinc-800/80">
                  {primaryTimeline.map((event) => (
                    <li key={event.id} className="px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          {event.actorHeroId ? (
                            <HeroIcon
                              src={heroSmallIconPath(event.actorHeroId)}
                              alt="Hero"
                              width={24}
                              height={24}
                              className="mt-0.5 h-6 w-6 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="mt-0.5 h-6 w-6 shrink-0 rounded bg-zinc-800/80" />
                          )}

                          {event.type === "item" ? (
                            event.itemIconSrc ? (
                              <img
                                src={event.itemIconSrc}
                                alt="Item"
                                width={24}
                                height={24}
                                className="mt-0.5 h-6 w-6 shrink-0 rounded object-cover"
                              />
                            ) : (
                              <div className="mt-0.5 h-6 w-6 shrink-0 rounded bg-zinc-800/80" />
                            )
                          ) : null}

                          <div className="min-w-0">
                            <p className="font-medium text-zinc-200">{event.title}</p>
                            <p className="mt-0.5 text-xs text-zinc-400">{event.detail}</p>
                          </div>
                        </div>
                        <span className="font-mono text-xs text-zinc-500">{fmtTimeCompact(event.timeS)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-lg border border-indigo-800/60 bg-zinc-900/20 p-3">
              <h3 className="text-sm font-semibold">Ability Events</h3>
              <p className="mt-1 text-xs text-zinc-500">{abilityTimeline.length} unlock/upgrade/imbue events.</p>

              {abilityTimeline.length ? (
                <div className="mt-3 max-h-[75vh] overflow-auto rounded-lg border border-indigo-800/60 bg-zinc-900/20">
                  <ul className="divide-y divide-zinc-800/80">
                    {abilityTimeline.map((event) => (
                      <li key={event.id} className="px-3 py-2 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2">
                            {event.actorHeroId ? (
                              <HeroIcon
                                src={heroSmallIconPath(event.actorHeroId)}
                                alt="Hero"
                                width={24}
                                height={24}
                                className="mt-0.5 h-6 w-6 shrink-0 rounded object-cover"
                              />
                            ) : (
                              <div className="mt-0.5 h-6 w-6 shrink-0 rounded bg-zinc-800/80" />
                            )}

                            {event.abilityIconSrc ? (
                              <img
                                src={event.abilityIconSrc}
                                alt={event.abilityName ?? "Ability"}
                                width={24}
                                height={24}
                                className="mt-0.5 h-6 w-6 shrink-0 rounded object-cover"
                              />
                            ) : (
                              <div className="mt-0.5 h-6 w-6 shrink-0 rounded bg-zinc-800/80" />
                            )}

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-zinc-200">{event.title}</p>
                                {event.abilityEventKind === "unlock" ? (
                                  <span className="rounded border border-emerald-600/70 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                                    Unlock
                                  </span>
                                ) : event.abilityEventKind === "imbue" ? (
                                  <span className="rounded border border-violet-600/70 bg-violet-950/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-violet-300">
                                    Imbue
                                  </span>
                                ) : event.abilityEventKind === "upgrade" ? (
                                  <span className="rounded border border-sky-600/70 bg-sky-950/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                                    Upgrade
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-0.5 text-xs text-zinc-400">{event.detail}</p>
                            </div>
                          </div>
                          <span className="font-mono text-xs text-zinc-500">{fmtTimeCompact(event.timeS)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">No ability unlock/upgrade/imbue events were found in this match payload.</p>
              )}
            </section>
          </div>

          <section className="mt-4 rounded-lg border border-zinc-800/80 bg-zinc-900/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Timeline Scrubber</h3>
              <span className="font-mono text-xs text-zinc-400">
                {fmtTimeCompact(scrubTimeS)} / {fmtTimeCompact(durationS)}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(0, Math.floor(durationS))}
              step={1}
              value={scrubTimeS}
              onInput={(event) => updateScrubTime((event.target as HTMLInputElement).value)}
              onChange={(event) => updateScrubTime(event.target.value)}
              className="mt-3 h-2 w-full cursor-pointer accent-zinc-200"
              aria-label="Timeline scrubber"
            />

            <p className="mt-2 text-xs text-zinc-500">As you scrub, inventory and map positions update in sync.</p>

            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Realtime Map</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1 rounded border border-zinc-700/80 bg-zinc-900/70 p-1 text-[11px]">
                      {([
                        ["standard", "HK POV"],
                        ["flipXY", "AM POV"],
                        ["flipX", "Flip X"],
                        ["flipY", "Flip Y"],
                      ] as Array<[MapOrientation, string]>).map(([orientation, label]) => (
                        <button
                          key={`map-orientation-${orientation}`}
                          type="button"
                          onClick={() => setMapOrientation(orientation)}
                          className={`rounded px-1.5 py-0.5 transition ${
                            mapOrientation === orientation
                              ? "bg-zinc-200 text-zinc-900"
                              : "bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="inline-flex items-center gap-1 rounded border border-zinc-700/80 bg-zinc-900/70 p-1 text-[11px]">
                      {([
                        [null, "Off"],
                        ["all", "All"],
                        [1, "York"],
                        [4, "Broadway"],
                        [6, "Grenich"],
                      ] as Array<[1 | 4 | 6 | "all" | null, string]>).map(([laneId, label]) => (
                        <button
                          key={`lane-highlight-${String(laneId)}`}
                          type="button"
                          onClick={() => setMapLaneHighlight(laneId)}
                          className={`rounded px-1.5 py-0.5 transition ${
                            mapLaneHighlight === laneId
                              ? "bg-zinc-200 text-zinc-900"
                              : "bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mx-auto mt-2 w-full max-w-160">
                  <div className="relative overflow-hidden rounded border border-zinc-800/80 bg-zinc-950/40 aspect-square max-h-[78vh]">
                    <img
                      src="/assets/map/minimap_mid.webp"
                      alt="Deadlock minimap"
                      className="absolute inset-0 h-full w-full object-cover opacity-90"
                    />

                    {mapLaneHighlight !== null ? (
                      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                        <g transform={`translate(${MAP_RENDER_INSET_PCT} ${MAP_RENDER_INSET_PCT}) scale(${MAP_RENDER_SCALE / 100})`}>
                        <g transform={laneOverlayTransform(mapOrientation)}>
                          {MAP_LANE_OVERLAYS.map((lane) => {
                            const active = mapLaneHighlight === "all" || mapLaneHighlight === lane.laneId;
                            return (
                              <g key={`lane-overlay-${lane.laneId}`} className={`transition ${active ? "opacity-100" : "opacity-30"}`}>
                                <path
                                  d={lane.pathD}
                                  className={`fill-none ${lane.glowClass}`}
                                  strokeWidth={2.1}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d={lane.pathD}
                                  className={`fill-none ${lane.strokeClass}`}
                                  strokeWidth={0.95}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />

                                {lane.nodes.map((node, nodeIndex) => (
                                  <rect
                                    key={`lane-node-${lane.laneId}-${nodeIndex}`}
                                    x={node.x - 1.15}
                                    y={node.y - 1.15}
                                    width={2.3}
                                    height={2.3}
                                    transform={`rotate(45 ${node.x} ${node.y})`}
                                    className={`${lane.strokeClass} fill-zinc-950/90`}
                                    strokeWidth={0.7}
                                  />
                                ))}
                              </g>
                            );
                          })}

                        </g>
                        </g>
                      </svg>
                    ) : null}

                    {scrubbedMapActors.actors.map((actor) => {
                      if (!actor.point) return null;
                      const normalized = normalizeMapPoint(actor.point, scrubbedMapActors.bounds);
                      const mapped = toMapRenderPoint(normalized, mapOrientation);
                      const xPct = Math.max(2, Math.min(98, mapped.x));
                      const yPct = Math.max(2, Math.min(98, mapped.y));
                      const ringClass =
                        actor.team === "0"
                          ? "ring-yellow-400"
                          : actor.team === "1"
                            ? "ring-blue-400"
                            : "ring-zinc-400";

                      return (
                        <div
                          key={`map-hero-${actor.steamId}`}
                          className="absolute -translate-x-1/2 -translate-y-1/2"
                          style={{ left: `${xPct}%`, top: `${yPct}%` }}
                          title={`${actor.heroName} (${actor.label})`}
                        >
                          {actor.heroId ? (
                            <HeroIcon
                              src={heroSmallIconPath(actor.heroId)}
                              alt={actor.heroName}
                              width={20}
                              height={20}
                              className={`h-5 w-5 rounded-full object-cover ring-2 ${ringClass}`}
                            />
                          ) : (
                            <span className={`block h-3.5 w-3.5 rounded-full ring-2 ${ringClass} bg-zinc-800`} />
                          )}
                        </div>
                      );
                    })}

                    <img
                      src="/assets/map/minimap_frame.webp"
                      alt="Minimap frame"
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-400" />Hidden King</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />Archmother</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-300/80" />Lane 1 · York</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-300/80" />Lane 4 · Broadway</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-300/80" />Lane 6 · Grenich</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-400" />Unknown</span>
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  Position feed in this match is sparse (event-based), so markers represent last known positions at the scrubbed time.
                </p>
              </section>

              <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/30">
                <ul className="divide-y divide-zinc-800/80">
                  {scrubbedInventories.map((playerInventory) => (
                    <li key={playerInventory.steamId} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex min-w-52 items-center gap-2">
                          {playerInventory.heroId ? (
                            <HeroIcon
                              src={heroSmallIconPath(playerInventory.heroId)}
                              alt={playerInventory.heroName}
                              width={24}
                              height={24}
                              className="h-6 w-6 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="h-6 w-6 shrink-0 rounded bg-zinc-800/80" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-200">{playerInventory.heroName}</p>
                            <p className="truncate text-xs text-zinc-500">{playerInventory.label}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {playerInventory.slots.map((slotItem, index) =>
                            slotItem?.itemIconSrc ? (
                              <img
                                key={`${playerInventory.steamId}-slot-${index}-${slotItem.itemId}`}
                                src={slotItem.itemIconSrc}
                                alt={slotItem.itemName}
                                width={24}
                                height={24}
                                title={slotItem.itemName}
                                className="h-6 w-6 rounded object-cover"
                              />
                            ) : (
                              <div
                                key={`${playerInventory.steamId}-slot-${index}-empty`}
                                className="h-6 w-6 rounded border border-zinc-700/80 bg-zinc-900/60"
                              />
                            )
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "lanes" ? (
        <section className="panel-premium rounded-xl p-4 md:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Lanes</h2>
            <p className="text-xs text-zinc-500">Snapshot at {fmtTimeCompact(laneSummary.cutoffS)}</p>
          </div>

          <div className="grid gap-2 rounded border border-zinc-800/90 bg-zinc-950/80 p-2 md:grid-cols-3">
            {laneGroups.map((laneGroup, index) => {
              const leftNames = laneGroup.left.map((p) => p?.heroName ?? "Unknown").join(" + ");
              const rightNames = laneGroup.right.map((p) => p?.heroName ?? "Unknown").join(" + ");
              const selected = selectedLaneIndex === index;
              const palette = lanePalette(laneGroup.laneId);

              return (
                <button
                  key={`lane-chip-${index}`}
                  type="button"
                  onClick={() => setSelectedLaneIndex(index)}
                  className={`rounded border px-3 py-2.5 text-left transition ${
                    selected
                      ? `${palette.selectedBorder} bg-zinc-900 text-zinc-100 ${palette.selectedShadow}`
                      : "border-zinc-800/90 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700/90 hover:bg-zinc-900/80"
                  }`}
                >
                  <p className={`text-xs font-semibold uppercase tracking-wide ${selected ? palette.selectedText : "text-zinc-400"}`}>
                    Lane {laneGroup.laneId ?? index + 1} · {palette.name}
                  </p>

                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      {laneGroup.left.map((player, playerIndex) => {
                        const heroSrc = player?.heroId ? heroSmallIconPath(player.heroId) : null;
                        return heroSrc ? (
                          <HeroIcon
                            key={`lane-chip-left-${index}-${player?.steamId ?? playerIndex}`}
                            src={heroSrc}
                            alt={player?.heroName ?? "Hero"}
                            width={28}
                            height={28}
                            className="h-7 w-7 rounded-full object-cover ring-2 ring-yellow-400/70"
                          />
                        ) : (
                          <span
                            key={`lane-chip-left-empty-${index}-${playerIndex}`}
                            className="block h-7 w-7 rounded-full bg-zinc-800/80 ring-2 ring-yellow-400/50"
                          />
                        );
                      })}
                    </div>

                    <span className="text-sm font-semibold text-zinc-300">VS</span>

                    <div className="flex items-center justify-end gap-1.5">
                      {laneGroup.right.map((player, playerIndex) => {
                        const heroSrc = player?.heroId ? heroSmallIconPath(player.heroId) : null;
                        return heroSrc ? (
                          <HeroIcon
                            key={`lane-chip-right-${index}-${player?.steamId ?? playerIndex}`}
                            src={heroSrc}
                            alt={player?.heroName ?? "Hero"}
                            width={28}
                            height={28}
                            className="h-7 w-7 rounded-full object-cover ring-2 ring-blue-400/70"
                          />
                        ) : (
                          <span
                            key={`lane-chip-right-empty-${index}-${playerIndex}`}
                            className="block h-7 w-7 rounded-full bg-zinc-800/80 ring-2 ring-blue-400/50"
                          />
                        );
                      })}
                    </div>
                  </div>

                  <p className="mt-2 truncate text-xs text-yellow-300/95">{leftNames}</p>
                  <p className="truncate text-xs text-blue-300/95">{rightNames}</p>
                </button>
              );
            })}
          </div>

          {laneGroups[selectedLaneIndex] ? (
            (() => {
              const lane = laneGroups[selectedLaneIndex];
              const leftTeam = lane.left;
              const rightTeam = lane.right;

              const leftSouls = leftTeam.reduce((sum, player) => sum + (player?.souls ?? 0), 0);
              const rightSouls = rightTeam.reduce((sum, player) => sum + (player?.souls ?? 0), 0);
              const leftKills = leftTeam.reduce((sum, player) => sum + (player?.kills ?? 0), 0);
              const rightKills = rightTeam.reduce((sum, player) => sum + (player?.kills ?? 0), 0);
              const leftLH = leftTeam.reduce((sum, player) => sum + (player?.lastHits ?? 0), 0);
              const rightLH = rightTeam.reduce((sum, player) => sum + (player?.lastHits ?? 0), 0);
              const leftDN = leftTeam.reduce((sum, player) => sum + (player?.denies ?? 0), 0);
              const rightDN = rightTeam.reduce((sum, player) => sum + (player?.denies ?? 0), 0);
              const leftDamage = leftTeam.reduce((sum, player) => sum + (player?.heroDamage ?? 0), 0);
              const rightDamage = rightTeam.reduce((sum, player) => sum + (player?.heroDamage ?? 0), 0);
              const leftHealing = leftTeam.reduce((sum, player) => sum + (player?.healing ?? 0), 0);
              const rightHealing = rightTeam.reduce((sum, player) => sum + (player?.healing ?? 0), 0);

              const metricRows = [
                {
                  label: "Net Worth",
                  valueLabel: "NET WORTH",
                  getValue: (player: LanePlayerSnapshot | null | undefined) => player?.souls ?? 0,
                  format: fmtNumber,
                },
                {
                  label: "Kills",
                  valueLabel: "KILLS",
                  getValue: (player: LanePlayerSnapshot | null | undefined) => player?.kills ?? 0,
                  format: (value: number) => String(value),
                },
                {
                  label: "Creeps Killed",
                  valueLabel: "CREEPS KILLED",
                  getValue: (player: LanePlayerSnapshot | null | undefined) => player?.lastHits ?? 0,
                  format: (value: number) => String(value),
                },
                {
                  label: "Denies",
                  valueLabel: "DENIES",
                  getValue: (player: LanePlayerSnapshot | null | undefined) => player?.denies ?? 0,
                  format: (value: number) => String(value),
                },
                {
                  label: "Damage Dealt",
                  valueLabel: "DAMAGE DEALT",
                  getValue: (player: LanePlayerSnapshot | null | undefined) => player?.heroDamage ?? 0,
                  format: fmtNumber,
                },
                {
                  label: "Healing",
                  valueLabel: "HEALING",
                  getValue: (player: LanePlayerSnapshot | null | undefined) => player?.healing ?? 0,
                  format: fmtNumber,
                },
              ];

              const selectedLanePalette = lanePalette(lane.laneId);

              const laneWinner =
                leftSouls === rightSouls
                  ? "Even"
                  : leftSouls > rightSouls
                    ? `Hidden King ${fmtDelta(leftSouls - rightSouls)}`
                    : `Archmother ${fmtDelta(rightSouls - leftSouls)}`;

              const renderHeroCard = (
                entry: LanePlayerSnapshot | null | undefined,
                side: "left" | "right",
                slotKey: string
              ) => {
                const accentLabel = side === "left" ? "text-yellow-200" : "text-blue-200";
                const heroImageSrc = entry?.heroId
                  ? heroCardIconPath(entry.heroId) ?? heroSmallIconPath(entry.heroId)
                  : null;

                return (
                  <article key={slotKey} className="rounded border border-zinc-800/80 bg-zinc-900/60 p-2.5">
                    <div className={`mb-1 flex items-center gap-1.5 ${side === "right" ? "justify-end" : ""}`}>
                      {side === "left" ? (
                        <>
                          {heroImageSrc ? (
                            <HeroIcon
                              src={heroImageSrc}
                              alt={entry?.heroName ?? "Hero"}
                              width={36}
                              height={36}
                              className="h-9 w-9 rounded object-cover"
                            />
                          ) : (
                            <span className="h-9 w-9 rounded bg-zinc-800/80" />
                          )}
                          <div className="min-w-0">
                            <p className={`truncate text-sm font-semibold ${accentLabel}`}>{entry?.heroName ?? "Unknown"}</p>
                            <p className="truncate text-[11px] text-zinc-500">{entry?.label ?? "No player"}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0 text-right">
                            <p className={`truncate text-sm font-semibold ${accentLabel}`}>{entry?.heroName ?? "Unknown"}</p>
                            <p className="truncate text-[11px] text-zinc-500">{entry?.label ?? "No player"}</p>
                          </div>
                          {heroImageSrc ? (
                            <HeroIcon
                              src={heroImageSrc}
                              alt={entry?.heroName ?? "Hero"}
                              width={36}
                              height={36}
                              className="h-9 w-9 rounded object-cover"
                            />
                          ) : (
                            <span className="h-9 w-9 rounded bg-zinc-800/80" />
                          )}
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        ["Net Worth", fmtNumber(entry?.souls ?? 0)],
                        ["Kills", String(entry?.kills ?? 0)],
                        ["Deaths", String(entry?.deaths ?? 0)],
                        ["Assists", String(entry?.assists ?? 0)],
                        ["Creeps", String(entry?.lastHits ?? 0)],
                        ["Denies", String(entry?.denies ?? 0)],
                        ["Damage", fmtNumber(entry?.heroDamage ?? 0)],
                        ["Healing", fmtNumber(entry?.healing ?? 0)],
                      ].map(([label, value]) => (
                        <div key={`${slotKey}-${label}`} className="rounded border border-zinc-800/80 bg-zinc-950/50 px-2 py-1.5 text-center">
                          <p className="font-mono text-xs leading-tight text-zinc-200">{value}</p>
                          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              };

              return (
                <div className="space-y-2">
                  <section className="rounded border border-zinc-800/80 bg-zinc-900/35 px-2 py-1.5">
                    <div className="grid items-center gap-2 md:grid-cols-[1fr_auto_1fr]">
                      <p className="truncate text-sm font-semibold text-yellow-300">
                        {leftTeam.map((p) => p?.heroName ?? "Unknown").join(" + ")}
                      </p>
                      <span className="text-xs font-semibold tracking-wide text-zinc-300">VS</span>
                      <p className="truncate text-right text-sm font-semibold text-blue-300">
                        {rightTeam.map((p) => p?.heroName ?? "Unknown").join(" + ")}
                      </p>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-xs text-zinc-400 md:grid-cols-4">
                      <span className="rounded border border-zinc-800/80 bg-zinc-950/50 px-1.5 py-0.5 text-center">NW {fmtNumber(leftSouls)} - {fmtNumber(rightSouls)}</span>
                      <span className="rounded border border-zinc-800/80 bg-zinc-950/50 px-1.5 py-0.5 text-center">K {leftKills} - {rightKills}</span>
                      <span className="rounded border border-zinc-800/80 bg-zinc-950/50 px-1.5 py-0.5 text-center">LH {leftLH} - {rightLH}</span>
                      <span className="rounded border border-zinc-800/80 bg-zinc-950/50 px-1.5 py-0.5 text-center">DN {leftDN} - {rightDN}</span>
                    </div>
                    <p className="mt-1.5 text-center text-xs font-semibold uppercase tracking-wide text-zinc-400">Lane Winner: {laneWinner}</p>
                  </section>

                  <section className={`rounded border border-zinc-800/90 bg-zinc-950/75 p-2.5 ${selectedLanePalette.panelTint}`}>
                    <div className="grid gap-2 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
                      <section className="rounded border border-zinc-800/80 bg-zinc-900/55 p-2">
                        <p className="mb-2 text-center text-sm font-extrabold uppercase tracking-[0.16em] text-yellow-300">Hidden King</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {leftTeam.map((entry, idx) => {
                            const heroImageSrc = entry?.heroId
                              ? heroCardIconPath(entry.heroId) ?? heroSmallIconPath(entry.heroId)
                              : null;
                            return (
                              <article key={entry ? `lane-left-card-${entry.steamId}` : `lane-left-card-empty-${idx}`} className="rounded border border-zinc-800/80 bg-zinc-950/75 p-1.5">
                                <div className="mb-1.5 text-center">
                                  {heroImageSrc ? (
                                    <HeroIcon
                                      src={heroImageSrc}
                                      alt={entry?.heroName ?? "Hero"}
                                      width={72}
                                      height={72}
                                      className="mx-auto h-17 w-17 rounded object-cover"
                                    />
                                  ) : (
                                    <span className="mx-auto block h-17 w-17 rounded bg-zinc-800/80" />
                                  )}
                                  <p className="mt-1 truncate text-sm font-semibold text-yellow-200">{entry?.label ?? "No player"}</p>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>

                      <section className="rounded border border-zinc-800/80 bg-zinc-900/55 px-2.5 py-2">
                        <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Lane Stats Comparison</p>
                        <div className={`mt-2 rounded border bg-zinc-900/75 px-2 py-2 text-center ${selectedLanePalette.selectedBorder}`}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lane Winner</p>
                          <p className={`mt-0.5 text-base font-extrabold uppercase tracking-wide ${selectedLanePalette.selectedText}`}>{laneWinner}</p>
                        </div>
                      </section>

                      <section className="rounded border border-zinc-800/80 bg-zinc-900/55 p-2">
                        <p className="mb-2 text-center text-sm font-extrabold uppercase tracking-[0.16em] text-blue-300">Archmother</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {rightTeam.map((entry, idx) => {
                            const heroImageSrc = entry?.heroId
                              ? heroCardIconPath(entry.heroId) ?? heroSmallIconPath(entry.heroId)
                              : null;
                            return (
                              <article key={entry ? `lane-right-card-${entry.steamId}` : `lane-right-card-empty-${idx}`} className="rounded border border-zinc-800/80 bg-zinc-950/75 p-1.5">
                                <div className="mb-1.5 text-center">
                                  {heroImageSrc ? (
                                    <HeroIcon
                                      src={heroImageSrc}
                                      alt={entry?.heroName ?? "Hero"}
                                      width={72}
                                      height={72}
                                      className="mx-auto h-17 w-17 rounded object-cover"
                                    />
                                  ) : (
                                    <span className="mx-auto block h-17 w-17 rounded bg-zinc-800/80" />
                                  )}
                                  <p className="mt-1 truncate text-sm font-semibold text-blue-200">{entry?.label ?? "No player"}</p>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      {metricRows.map((row) => {
                        const leftTotal = leftTeam.reduce((sum, player) => sum + row.getValue(player), 0);
                        const rightTotal = rightTeam.reduce((sum, player) => sum + row.getValue(player), 0);
                        const leftValues = leftTeam.map((player) => row.getValue(player));
                        const rightValues = rightTeam.map((player) => row.getValue(player));
                        const max = Math.max(1, leftTotal, rightTotal);
                        const leftPct = (leftTotal / max) * 100;
                        const rightPct = (rightTotal / max) * 100;

                        const hoveredLeftIndex =
                          hoveredLaneStat?.rowLabel === row.label && hoveredLaneStat.side === "left"
                            ? hoveredLaneStat.playerIndex
                            : -1;
                        const hoveredRightIndex =
                          hoveredLaneStat?.rowLabel === row.label && hoveredLaneStat.side === "right"
                            ? hoveredLaneStat.playerIndex
                            : -1;

                        const leftHoveredValue = hoveredLeftIndex >= 0 ? leftValues[hoveredLeftIndex] ?? 0 : 0;
                        const rightHoveredValue = hoveredRightIndex >= 0 ? rightValues[hoveredRightIndex] ?? 0 : 0;
                        const leftHoveredPrefix = hoveredLeftIndex > 0
                          ? leftValues.slice(0, hoveredLeftIndex).reduce((sum, value) => sum + value, 0)
                          : 0;
                        const rightHoveredPrefix = hoveredRightIndex > 0
                          ? rightValues.slice(0, hoveredRightIndex).reduce((sum, value) => sum + value, 0)
                          : 0;

                        const leftHoverStartPct = leftTotal > 0 ? (leftHoveredPrefix / leftTotal) * leftPct : 0;
                        const leftHoverWidthPct = leftTotal > 0 ? (leftHoveredValue / leftTotal) * leftPct : 0;
                        const rightHoverOffsetPct = rightTotal > 0 ? (rightHoveredPrefix / rightTotal) * rightPct : 0;
                        const rightHoverWidthPct = rightTotal > 0 ? (rightHoveredValue / rightTotal) * rightPct : 0;

                        return (
                          <div key={`lane-metric-row-${row.label}`} className="grid gap-2 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
                            <div className="grid grid-cols-2 gap-1.5">
                              {leftTeam.map((entry, idx) => (
                                <div
                                  key={`lane-left-row-${row.label}-${entry?.steamId ?? idx}`}
                                  onMouseEnter={() => setHoveredLaneStat({ rowLabel: row.label, side: "left", playerIndex: idx })}
                                  onMouseLeave={() => setHoveredLaneStat(null)}
                                  className={`rounded border bg-zinc-900/65 px-2.5 py-2 text-center transition ${
                                    hoveredLeftIndex === idx
                                      ? "border-yellow-400/80 shadow-[0_0_0_1px_rgba(250,204,21,0.45),0_0_16px_rgba(250,204,21,0.2)]"
                                      : "border-zinc-800/80"
                                  }`}
                                >
                                  <p className="font-mono text-sm leading-tight text-zinc-100">{row.format(row.getValue(entry))}</p>
                                  <p className="text-xs uppercase tracking-wide text-zinc-500">{row.valueLabel}</p>
                                </div>
                              ))}
                            </div>

                            <div className="rounded border border-zinc-800/80 bg-zinc-900/60 px-2 py-1.5">
                              <div className="mb-0.5 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-sm">
                                <span className="font-mono font-semibold text-zinc-200">{fmtNumber(leftTotal)}</span>
                                <span className={`truncate text-center text-xs font-semibold uppercase tracking-[0.14em] ${selectedLanePalette.selectedText}`}>{row.label}</span>
                                <span className="text-right font-mono font-semibold text-zinc-200">{fmtNumber(rightTotal)}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                <div className="relative h-2.5 overflow-hidden rounded bg-zinc-950/85">
                                  <div className="h-2.5 rounded bg-amber-300/70" style={{ width: `${leftPct}%` }} />
                                  {hoveredLeftIndex >= 0 && leftHoverWidthPct > 0 ? (
                                    <div
                                      className="absolute inset-y-0 rounded bg-yellow-200/95 shadow-[0_0_12px_rgba(254,240,138,0.65)]"
                                      style={{ left: `${leftHoverStartPct}%`, width: `${leftHoverWidthPct}%` }}
                                    />
                                  ) : null}
                                </div>
                                <div className="relative h-2.5 overflow-hidden rounded bg-zinc-950/85">
                                  <div className="ml-auto h-2.5 rounded bg-indigo-300/70" style={{ width: `${rightPct}%` }} />
                                  {hoveredRightIndex >= 0 && rightHoverWidthPct > 0 ? (
                                    <div
                                      className="absolute inset-y-0 rounded bg-blue-200/95 shadow-[0_0_12px_rgba(191,219,254,0.65)]"
                                      style={{ right: `${rightHoverOffsetPct}%`, width: `${rightHoverWidthPct}%` }}
                                    />
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                              {rightTeam.map((entry, idx) => (
                                <div
                                  key={`lane-right-row-${row.label}-${entry?.steamId ?? idx}`}
                                  onMouseEnter={() => setHoveredLaneStat({ rowLabel: row.label, side: "right", playerIndex: idx })}
                                  onMouseLeave={() => setHoveredLaneStat(null)}
                                  className={`rounded border bg-zinc-900/65 px-2.5 py-2 text-center transition ${
                                    hoveredRightIndex === idx
                                      ? "border-blue-400/80 shadow-[0_0_0_1px_rgba(96,165,250,0.45),0_0_16px_rgba(96,165,250,0.2)]"
                                      : "border-zinc-800/80"
                                  }`}
                                >
                                  <p className="font-mono text-sm leading-tight text-zinc-100">{row.format(row.getValue(entry))}</p>
                                  <p className="text-xs uppercase tracking-wide text-zinc-500">{row.valueLabel}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              );
            })()
          ) : null}
        </section>
      ) : null}

      {activeTab === "charts" ? (
        <section className="panel-premium rounded-xl p-4 md:p-5 space-y-4">
          <h2 className="text-base font-semibold">Charts</h2>

          <div className="grid gap-3 md:grid-cols-2">
            <article className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Team Totals</p>
              <div className="mt-3 space-y-2 text-sm">
                {["kills", "souls", "damage", "healing"].map((metric) => {
                  const left = Number((team0 as any)?.[metric] ?? 0);
                  const right = Number((team1 as any)?.[metric] ?? 0);
                  const max = Math.max(1, left, right);
                  return (
                    <div key={metric} className="space-y-1">
                      <p className="text-xs text-zinc-400 capitalize">{metric}</p>
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <div className="h-2 rounded bg-cyan-500/25 overflow-hidden">
                          <div className="h-full bg-cyan-400" style={{ width: `${(left / max) * 100}%` }} />
                        </div>
                        <span className="font-mono text-xs text-zinc-500">{fmtNumber(left)} / {fmtNumber(right)}</span>
                        <div className="h-2 rounded bg-rose-500/25 overflow-hidden">
                          <div className="ml-auto h-full bg-rose-400" style={{ width: `${(right / max) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Net Worth Over Time</p>
              <div className="mt-3 rounded border border-zinc-800/80 bg-zinc-950/35 p-2">
                <svg viewBox="0 0 100 100" className="h-44 w-full">
                  <polyline points={netWorthPolyline0} fill="none" stroke="rgb(34 211 238)" strokeWidth="1.6" />
                  <polyline points={netWorthPolyline1} fill="none" stroke="rgb(244 63 94)" strokeWidth="1.6" />
                </svg>
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-zinc-400">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-400" />{team0?.label ?? "Team 0"}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" />{team1?.label ?? "Team 1"}</span>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "compare" ? (
        <section className="panel-premium rounded-xl p-4 md:p-5 space-y-3">
          <h2 className="text-base font-semibold">Player Comparison</h2>

          <div className="grid gap-2 md:grid-cols-2">
            <select
              value={leftPlayerId}
              onChange={(event) => setLeftPlayerId(event.target.value)}
              className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
            >
              {players.map((player) => (
                <option key={`left-${player.steamId}`} value={player.steamId}>{player.label}</option>
              ))}
            </select>
            <select
              value={rightPlayerId}
              onChange={(event) => setRightPlayerId(event.target.value)}
              className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
            >
              {players.map((player) => (
                <option key={`right-${player.steamId}`} value={player.steamId}>{player.label}</option>
              ))}
            </select>
          </div>

          {leftPlayer && rightPlayer ? (
            <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-900/25">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Metric</th>
                    <th className="px-3 py-2 text-right">{leftPlayer.label}</th>
                    <th className="px-3 py-2 text-right">{rightPlayer.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Hero", leftPlayer.heroName, rightPlayer.heroName],
                    ["Kills", leftPlayer.kills, rightPlayer.kills],
                    ["Deaths", leftPlayer.deaths, rightPlayer.deaths],
                    ["Assists", leftPlayer.assists, rightPlayer.assists],
                    ["KDA", kda(leftPlayer.kills, leftPlayer.deaths, leftPlayer.assists).toFixed(2), kda(rightPlayer.kills, rightPlayer.deaths, rightPlayer.assists).toFixed(2)],
                    ["Souls", leftPlayer.netWorth, rightPlayer.netWorth],
                    ["S/min", leftPlayer.soulsPerMin.toFixed(2), rightPlayer.soulsPerMin.toFixed(2)],
                    ["Last Hits", leftPlayer.lastHits, rightPlayer.lastHits],
                    ["Denies", leftPlayer.denies, rightPlayer.denies],
                    ["Level", leftPlayer.level, rightPlayer.level],
                  ].map(([metric, left, right]) => (
                    <tr key={String(metric)} className="border-t border-zinc-800/80">
                      <td className="px-3 py-2 text-zinc-400">{metric}</td>
                      <td className="px-3 py-2 text-right">{String(left)}</td>
                      <td className="px-3 py-2 text-right">{String(right)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "notes" ? (
        <section className="panel-premium rounded-xl p-4 md:p-5 space-y-3">
          <h2 className="text-base font-semibold">Notes</h2>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Write match notes here..."
            className="min-h-44 w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveNotes}
              className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
            >
              Save notes
            </button>
            {notesSaved ? <span className="text-xs text-zinc-400">{notesSaved}</span> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "vod" ? (
        <section className="panel-premium rounded-xl p-4 md:p-5 space-y-3">
          <h2 className="text-base font-semibold">VOD</h2>
          <input
            value={vodUrl}
            onChange={(event) => setVodUrl(event.target.value)}
            placeholder="Paste video URL (YouTube, Twitch, etc.)"
            className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveVod}
              className="rounded border border-indigo-500/40 bg-indigo-700/90 px-4 py-2 text-sm font-medium hover:bg-indigo-600"
            >
              Save link
            </button>
            {vodSaved ? <span className="text-xs text-zinc-400">{vodSaved}</span> : null}
          </div>
          {vodUrl ? (
            <a href={vodUrl} target="_blank" rel="noreferrer" className="text-sm text-cyan-300 hover:underline">
              Open VOD link
            </a>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
