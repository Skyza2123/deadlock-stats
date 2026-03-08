import { and, eq, isNull } from "drizzle-orm";

import BackButton from "../../../../../components/BackButton";
import HeightMatchedScroll from "../../../../../components/HeightMatchedScroll";
import HeroIcon from "../../../../../components/HeroIcon";
import MapHeatmap from "../../../../../components/MapHeatmap";
import PlayerGraphs from "../../../../../components/PlayerGraphs";
import { db } from "../../../../../db";
import { matchPlayerItems, matchPlayers, matches, players } from "../../../../../db/schema";
import { fmtTime, hasItem, heroName, itemName } from "../../../../../lib/deadlockData";
import { getAbilityMeta } from "../../../../../lib/abilityCatalog";
import { heroBackgroundPath, heroRenderPath, heroSmallIconPath } from "../../../../../lib/heroIcons";
import { resolveLiveInventoryEvents } from "../../../../../lib/inventoryTimeline";
import { itemIconPath } from "../../../../../lib/itemIcons";
import { buildHeatmapSeriesFromManyPlayerRaw } from "../../../../../lib/mapHeatmap";

type ItemRow = {
  steamId: string;
  gameTimeS: number;
  itemId: number;
  soldTimeS: number | null;
  upgradeId: number | null;
  imbuedAbilityId: number | null;
};

type AbilityProgressRow = {
  key: string;
  abilityId: number | null;
  abilityName: string;
  abilityIconSrc: string | null;
  unlockCount: number;
  upgradeCount: number;
  imbueCount: number;
  maxLevel: number;
  firstSeenAtS: number;
};

type PlayerMatchRow = {
  steamId: string;
  displayName: string | null;
  heroId: string | null;
  side: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  netWorth: number | null;
  lastHits: number | null;
  denies: number | null;
  level: number | null;
  rawJson: unknown;
};

type TeamCompareRow = {
  netWorth: number | null;
  rawJson: unknown;
  kills: number | null;
  assists: number | null;
};

type PowerUpBuffRow = {
  type?: string;
  value?: number | null;
  is_permanent?: boolean | null;
};

type TimelineEvent = {
  timeS: number;
  category: "item" | "combat" | "progress" | "snapshot";
  title: string;
  details: string;
};

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function fmt1(n: number) {
  return Number.isFinite(n) ? n.toFixed(1) : "-";
}

function fmtPct(n: number) {
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "-";
}

function fmtSigned(n: number) {
  if (!Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

function pickSnapshotAtOrBefore(snapshots: any[], targetSeconds: number) {
  if (!snapshots.length) return null;

  let best: any = null;
  for (const snapshot of snapshots) {
    const timeS = safeNum(snapshot?.time_stamp_s);
    if (timeS <= targetSeconds) {
      best = snapshot;
      continue;
    }
    break;
  }

  return best ?? snapshots[Math.min(1, snapshots.length - 1)] ?? snapshots[0];
}

function buildLaningWindow(raw: any, targetSeconds = 600) {
  const snapshots: any[] = Array.isArray(raw?.stats) ? raw.stats : [];
  if (!snapshots.length) return null;

  const start = snapshots[0] ?? {};
  const end = pickSnapshotAtOrBefore(snapshots, targetSeconds) ?? snapshots[snapshots.length - 1] ?? {};

  return {
    atSeconds: safeNum(end?.time_stamp_s),
    souls: safeNum(end?.net_worth),
    lh: safeNum(end?.creep_kills),
    denies: safeNum(end?.denies),
    kills: safeNum(end?.kills),
    deaths: safeNum(end?.deaths),
    assists: safeNum(end?.assists),
    soulsGain: safeNum(end?.net_worth) - safeNum(start?.net_worth),
  };
}

function laneOutcome(score: number | null) {
  if (score == null) return { label: "N/A", className: "text-zinc-300" };
  if (score >= 8) return { label: "Dominant", className: "text-emerald-300" };
  if (score >= 3) return { label: "Winning", className: "text-emerald-400" };
  if (score <= -8) return { label: "Hard lane", className: "text-rose-300" };
  if (score <= -3) return { label: "Losing", className: "text-rose-400" };
  return { label: "Even", className: "text-zinc-300" };
}

function prettifyBuffType(type: string | null | undefined) {
  if (!type) return "Unknown";
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractMetric(raw: any, keys: string[]): number | null {
  for (const key of keys) {
    const parts = key.split(".");
    let value: any = raw;

    for (const part of parts) {
      value = value?.[part];
    }

    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  return null;
}

function extractMetricFromStatsSnapshots(raw: any, keys: string[]): number | null {
  if (!Array.isArray(raw?.stats)) return null;

  for (let index = raw.stats.length - 1; index >= 0; index -= 1) {
    const snapshot = raw.stats[index];
    const value = extractMetric(snapshot, keys);
    if (value != null) return value;
  }

  return null;
}

function extractMetricAny(raw: any, keys: string[]): number | null {
  return extractMetric(raw, keys) ?? extractMetricFromStatsSnapshots(raw, keys);
}

function extractDamageTotal(raw: any): number | null {
  return extractMetricAny(raw, [
    "player_damage",
    "hero_damage",
    "damage",
    "damage_done",
    "total_damage",
    "total_damage_to_heroes",
    "hero_damage_done",
    "combat.hero_damage",
    "combat.damage",
    "stats.hero_damage",
    "stats.damage",
  ]);
}

function firstNumeric(obj: any, keys: string[]) {
  for (const key of keys) {
    const value = Number(obj?.[key]);
    if (Number.isFinite(value)) return value;
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
  const kindText = String(
    event?.event_type ??
      event?.eventType ??
      event?.kind ??
      event?.action ??
      event?.type ??
      ""
  )
    .toLowerCase()
    .trim();

  if (firstNumeric(event, ["imbued_ability_id", "imbuedAbilityId"]) != null || kindText.includes("imbue")) {
    return "imbue";
  }

  if (
    kindText.includes("unlock") ||
    kindText.includes("learn") ||
    kindText.includes("acquire") ||
    kindText.includes("first")
  ) {
    return "unlock";
  }

  return "upgrade";
}

function playerHeroThumbPath(heroId: string | null | undefined) {
  return heroRenderPath(heroId) ?? heroSmallIconPath(heroId);
}

function buildAbilityProgressRows(raw: any, itemRows: ItemRow[]): AbilityProgressRow[] {
  const arrays: any[][] = [
    raw?.ability_events,
    raw?.abilityEvents,
    raw?.ability_casts,
    raw?.abilityCasts,
    raw?.cast_events,
    raw?.casts,
    raw?.abilities,
  ].filter(Array.isArray);

  const progress = new Map<string, AbilityProgressRow>();
  const seenAbilityKeys = new Set<string>();

  const touch = (
    abilityId: number | null,
    directName: string | null,
    directIconSrc: string | null,
    timeS: number,
    kind: "unlock" | "upgrade" | "imbue",
    explicitLevel: number | null,
  ) => {
    if (abilityId != null && abilityId <= 0) return;

    const meta = abilityId != null ? getAbilityMeta(abilityId) : null;
    const abilityName = meta?.name ?? directName ?? (abilityId != null ? `Ability ${abilityId}` : "Unknown ability");
    if (abilityName === "Ability 0") return;
    const abilityIconSrc = meta?.iconSrc ?? directIconSrc ?? null;
    const key = abilityId != null ? `id:${abilityId}` : `name:${abilityName.toLowerCase()}`;

    const row = progress.get(key) ?? {
      key,
      abilityId,
      abilityName,
      abilityIconSrc,
      unlockCount: 0,
      upgradeCount: 0,
      imbueCount: 0,
      maxLevel: 0,
      firstSeenAtS: timeS,
    };

    if (timeS < row.firstSeenAtS) row.firstSeenAtS = timeS;
    if (abilityId != null) row.abilityId = abilityId;
    if (!row.abilityIconSrc && abilityIconSrc) row.abilityIconSrc = abilityIconSrc;
    if (!row.abilityName || row.abilityName.startsWith("Ability ")) row.abilityName = abilityName;

    if (kind === "unlock") {
      row.unlockCount += 1;
      row.maxLevel = Math.min(3, Math.max(row.maxLevel, 1));
    } else if (kind === "upgrade") {
      row.upgradeCount += 1;
      row.maxLevel = Math.min(3, Math.max(row.maxLevel, explicitLevel ?? row.unlockCount + row.upgradeCount));
    } else {
      row.imbueCount += 1;
    }

    progress.set(key, row);
  };

  for (const eventArray of arrays) {
    for (const event of eventArray) {
      const timeS = Math.max(
        0,
        firstNumeric(event, ["game_time_s", "time_stamp_s", "time_s", "cast_time_s", "event_time_s", "timestamp_s"]) ?? 0
      );

      const detectedKind = detectAbilityEventKind(event);
      const baseAbilityId = firstNumeric(event, ["ability_id", "abilityId", "caster_ability_id", "killer_ability_id"]);
      const imbuedAbilityId = firstNumeric(event, ["imbued_ability_id", "imbuedAbilityId"]);
      const effectiveAbilityId = detectedKind === "imbue" ? (imbuedAbilityId ?? baseAbilityId) : baseAbilityId;

      const abilityName = firstText(event, ["ability_name", "abilityName", "killer_ability_name", "cast_name", "name"]);
      const abilityIcon = firstText(event, ["ability_icon", "abilityIcon", "image", "image_webp", "icon"]);
      const level = firstNumeric(event, ["upgrade_id", "upgradeId", "ability_level", "abilityLevel", "new_level", "level"]);

      if (effectiveAbilityId != null && Number(effectiveAbilityId) <= 0) continue;
      if (effectiveAbilityId == null && !abilityName) continue;

      const abilityKey =
        effectiveAbilityId != null
          ? `id:${Number(effectiveAbilityId)}`
          : abilityName
            ? `name:${abilityName.toLowerCase()}`
            : null;

      const kind =
        detectedKind === "imbue"
          ? "imbue"
          : abilityKey && seenAbilityKeys.has(abilityKey)
            ? "upgrade"
            : "unlock";

      if (abilityKey) seenAbilityKeys.add(abilityKey);

      touch(effectiveAbilityId != null ? Number(effectiveAbilityId) : null, abilityName, abilityIcon, timeS, kind, level != null ? Number(level) : null);
    }
  }

  for (const itemEvent of itemRows) {
    const timeS = Math.max(0, safeNum(itemEvent.gameTimeS));
    if (!Number.isFinite(Number(itemEvent.itemId)) || Number(itemEvent.itemId) <= 0) continue;
    const itemAbilityMeta = !hasItem(Number(itemEvent.itemId)) ? getAbilityMeta(Number(itemEvent.itemId)) : null;

    if (itemAbilityMeta) {
      const abilityId = Number(itemEvent.itemId);
      const abilityKey = `id:${abilityId}`;
      const kind: "unlock" | "upgrade" = seenAbilityKeys.has(abilityKey) ? "upgrade" : "unlock";
      seenAbilityKeys.add(abilityKey);
      touch(
        abilityId,
        itemAbilityMeta.name,
        itemAbilityMeta.iconSrc,
        timeS,
        kind,
        itemEvent.upgradeId != null ? Number(itemEvent.upgradeId) : null
      );
    }

    if (itemEvent.imbuedAbilityId != null && Number.isFinite(Number(itemEvent.imbuedAbilityId))) {
      const imbuedId = Number(itemEvent.imbuedAbilityId);
      if (imbuedId > 0) {
        touch(imbuedId, null, null, timeS, "imbue", null);
      }
    }
  }

  return [...progress.values()].sort((a, b) => {
    if (b.maxLevel !== a.maxLevel) return b.maxLevel - a.maxLevel;
    const aEvents = a.unlockCount + a.upgradeCount + a.imbueCount;
    const bEvents = b.unlockCount + b.upgradeCount + b.imbueCount;
    if (bEvents !== aEvents) return bEvents - aEvents;
    if (a.firstSeenAtS !== b.firstSeenAtS) return a.firstSeenAtS - b.firstSeenAtS;
    return a.abilityName.localeCompare(b.abilityName);
  });
}

function buildSuperTimeline(params: {
  itemRows: ItemRow[];
  snapshots: any[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const item of params.itemRows) {
    const boughtName = itemName(Number(item.itemId));
    events.push({
      timeS: safeNum(item.gameTimeS),
      category: "item",
      title: "Item bought",
      details: boughtName,
    });

    if (item.soldTimeS && item.soldTimeS > 0) {
      events.push({
        timeS: safeNum(item.soldTimeS),
        category: "item",
        title: "Item sold",
        details: boughtName,
      });
    }
  }

  const snapshots = params.snapshots;
  for (let index = 0; index < snapshots.length; index += 1) {
    const current = snapshots[index] ?? {};
    const previous = index > 0 ? snapshots[index - 1] ?? {} : null;

    const timeS = safeNum(current?.time_stamp_s);
    const kills = safeNum(current?.kills);
    const deaths = safeNum(current?.deaths);
    const assists = safeNum(current?.assists);
    const level = safeNum(current?.level);
    const souls = safeNum(current?.net_worth);
    const damage = safeNum(current?.player_damage);
    const taken = safeNum(current?.player_damage_taken);
    const lh = safeNum(current?.creep_kills);

    events.push({
      timeS,
      category: "snapshot",
      title: "Snapshot",
      details: `K/D/A ${kills}/${deaths}/${assists} • Lvl ${level || "-"} • Souls ${souls} • Dmg ${damage} • Taken ${taken} • LH ${lh}`,
    });

    if (!previous) continue;

    const killDelta = kills - safeNum(previous?.kills);
    const deathDelta = deaths - safeNum(previous?.deaths);
    const assistDelta = assists - safeNum(previous?.assists);
    const levelDelta = level - safeNum(previous?.level);
    const soulsDelta = souls - safeNum(previous?.net_worth);
    const damageDelta = damage - safeNum(previous?.player_damage);
    const takenDelta = taken - safeNum(previous?.player_damage_taken);
    const lhDelta = lh - safeNum(previous?.creep_kills);

    if (killDelta > 0) {
      events.push({
        timeS,
        category: "combat",
        title: killDelta > 1 ? `${killDelta} kills` : "Kill",
        details: `Kills now ${kills}`,
      });
    }
    if (deathDelta > 0) {
      events.push({
        timeS,
        category: "combat",
        title: deathDelta > 1 ? `${deathDelta} deaths` : "Death",
        details: `Deaths now ${deaths}`,
      });
    }
    if (assistDelta > 0) {
      events.push({
        timeS,
        category: "combat",
        title: assistDelta > 1 ? `${assistDelta} assists` : "Assist",
        details: `Assists now ${assists}`,
      });
    }
    if (levelDelta > 0) {
      events.push({
        timeS,
        category: "progress",
        title: levelDelta > 1 ? `+${levelDelta} levels` : "Level up",
        details: `Reached level ${level}`,
      });
    }
    if (soulsDelta >= 500) {
      events.push({
        timeS,
        category: "progress",
        title: "Soul spike",
        details: `+${soulsDelta} souls (now ${souls})`,
      });
    }
    if (damageDelta >= 500) {
      events.push({
        timeS,
        category: "combat",
        title: "Damage spike",
        details: `+${damageDelta} damage dealt`,
      });
    }
    if (takenDelta >= 500) {
      events.push({
        timeS,
        category: "combat",
        title: "Damage taken spike",
        details: `+${takenDelta} damage taken`,
      });
    }
    if (lhDelta >= 5) {
      events.push({
        timeS,
        category: "progress",
        title: "Farm spike",
        details: `+${lhDelta} last hits (now ${lh})`,
      });
    }
  }

  const categoryRank: Record<TimelineEvent["category"], number> = {
    combat: 0,
    item: 1,
    progress: 2,
    snapshot: 3,
  };

  return events
    .sort((a, b) => {
      if (a.timeS !== b.timeS) return a.timeS - b.timeS;
      return categoryRank[a.category] - categoryRank[b.category];
    });
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string; steamId: string }>;
  searchParams?: Promise<{ compare?: string; enemy?: string }>;
}) {
  const { matchId, steamId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const compareSteamId = resolvedSearchParams?.compare ?? undefined;
  const enemySteamId = resolvedSearchParams?.enemy ?? undefined;

  const matchRow = await db
    .select({ rawJson: matches.rawJson })
    .from(matches)
    .where(eq(matches.matchId, matchId))
    .limit(1);

  const playerRows: PlayerMatchRow[] = await db
    .select({
      steamId: matchPlayers.steamId,
      displayName: players.displayName,
      heroId: matchPlayers.heroId,
      side: matchPlayers.side,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      netWorth: matchPlayers.netWorth,
      lastHits: matchPlayers.lastHits,
      denies: matchPlayers.denies,
      level: matchPlayers.level,
      rawJson: matchPlayers.rawJson,
    })
    .from(matchPlayers)
    .leftJoin(players, eq(players.steamId, matchPlayers.steamId))
    .where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.steamId, steamId)))
    .limit(1);

  const allPlayerRows: PlayerMatchRow[] = await db
    .select({
      steamId: matchPlayers.steamId,
      displayName: players.displayName,
      heroId: matchPlayers.heroId,
      side: matchPlayers.side,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      netWorth: matchPlayers.netWorth,
      lastHits: matchPlayers.lastHits,
      denies: matchPlayers.denies,
      level: matchPlayers.level,
      rawJson: matchPlayers.rawJson,
    })
    .from(matchPlayers)
    .leftJoin(players, eq(players.steamId, matchPlayers.steamId))
    .where(eq(matchPlayers.matchId, matchId));

  if (playerRows.length === 0) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4">
        <BackButton />
        <section className="panel-premium rounded-xl p-5 shadow-sm">
          <h1 className="text-2xl font-bold">Player not found</h1>
          <p className="mt-2 opacity-80">No stats for Steam ID {steamId} in match {matchId}.</p>
        </section>
      </main>
    );
  }

  const player = playerRows[0];
  const raw: any = player.rawJson;
  const matchRaw: any = matchRow[0]?.rawJson;

  const durationRaw = Number(
    matchRaw?.match_info?.duration_s ?? matchRaw?.match_info?.duration ?? matchRaw?.duration_s ?? NaN
  );

  const itemRows: ItemRow[] = await db
    .select({
      steamId: matchPlayerItems.steamId,
      gameTimeS: matchPlayerItems.gameTimeS,
      itemId: matchPlayerItems.itemId,
      soldTimeS: matchPlayerItems.soldTimeS,
      upgradeId: matchPlayerItems.upgradeId,
      imbuedAbilityId: matchPlayerItems.imbuedAbilityId,
    })
    .from(matchPlayerItems)
    .where(and(eq(matchPlayerItems.matchId, matchId), eq(matchPlayerItems.steamId, steamId)));

  itemRows.sort((a, b) => a.gameTimeS - b.gameTimeS);

  const maxItemTime = itemRows.length ? Math.max(...itemRows.map((x) => safeNum(x.gameTimeS))) : 0;
  const durationS = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : Math.max(1, maxItemTime);

  const souls = safeNum(player.netWorth);
  const spm = souls / (durationS / 60);

  const damageTotal = extractDamageTotal(raw);
  const dpm = damageTotal != null ? damageTotal / (durationS / 60) : null;

  const damageTaken = extractMetricAny(raw, ["player_damage_taken", "damage_taken", "stats.damage_taken"]);
  const healing = extractMetricAny(raw, ["player_healing", "healing_done", "healing"]);
  const creepDamage = extractMetricAny(raw, ["creep_damage", "stats.creep_damage"]);
  const neutralDamage = extractMetricAny(raw, ["neutral_damage", "stats.neutral_damage"]);
  const bossDamage = extractMetricAny(raw, ["boss_damage", "stats.boss_damage"]);
  const shotsHit = extractMetricAny(raw, ["shots_hit"]);
  const shotsMissed = extractMetricAny(raw, ["shots_missed"]);
  const totalShots = (shotsHit ?? 0) + (shotsMissed ?? 0);
  const accuracy = totalShots > 0 ? ((shotsHit ?? 0) / totalShots) * 100 : null;

  const teamRows: TeamCompareRow[] = await db
    .select({
      netWorth: matchPlayers.netWorth,
      rawJson: matchPlayers.rawJson,
      kills: matchPlayers.kills,
      assists: matchPlayers.assists,
    })
    .from(matchPlayers)
    .where(
      and(
        eq(matchPlayers.matchId, matchId),
        player.side == null ? isNull(matchPlayers.side) : eq(matchPlayers.side, player.side)
      )
    );

  const comparePlayer =
    compareSteamId && compareSteamId !== steamId
      ? allPlayerRows.find((row) => row.steamId === compareSteamId)
      : undefined;

  const compareOptions = allPlayerRows.filter((row) => row.steamId !== steamId);
  const enemyRows = allPlayerRows.filter((row) => row.steamId !== steamId && row.side !== player.side);
  const selectedEnemy =
    enemySteamId && enemySteamId !== steamId
      ? enemyRows.find((row) => row.steamId === enemySteamId)
      : undefined;
  const trackedEnemy =
    selectedEnemy ??
    (comparePlayer && comparePlayer.side !== player.side
      ? comparePlayer
      : [...enemyRows].sort((a, b) => safeNum(b.netWorth) - safeNum(a.netWorth))[0]);

  const trackedEnemyDamage = trackedEnemy ? extractDamageTotal(trackedEnemy.rawJson as any) : null;
  const trackedEnemySpm = trackedEnemy ? safeNum(trackedEnemy.netWorth) / (durationS / 60) : null;

  const playerLaning = buildLaningWindow(raw, 600);
  const enemyLaning = trackedEnemy ? buildLaningWindow(trackedEnemy.rawJson as any, 600) : null;

  const laneSoulsDelta =
    playerLaning && enemyLaning ? playerLaning.souls - enemyLaning.souls : null;
  const laneCsDelta =
    playerLaning && enemyLaning
      ? (playerLaning.lh + playerLaning.denies) - (enemyLaning.lh + enemyLaning.denies)
      : null;
  const laneKdaDelta =
    playerLaning && enemyLaning
      ? (playerLaning.kills + playerLaning.assists - playerLaning.deaths) -
        (enemyLaning.kills + enemyLaning.assists - enemyLaning.deaths)
      : null;

  const laningScore =
    laneSoulsDelta != null && laneCsDelta != null && laneKdaDelta != null
      ? laneSoulsDelta / 250 + laneCsDelta * 0.3 + laneKdaDelta * 1.5
      : null;

  const laningState = laneOutcome(laningScore);

  const compareDamageTotal = comparePlayer ? extractDamageTotal(comparePlayer.rawJson as any) : null;
  const compareSpm = comparePlayer ? safeNum(comparePlayer.netWorth) / (durationS / 60) : null;
  const compareDpm = comparePlayer && compareDamageTotal != null ? compareDamageTotal / (durationS / 60) : null;
  const compareShotsHit = comparePlayer ? extractMetricAny(comparePlayer.rawJson as any, ["shots_hit"]) : null;
  const compareShotsMissed = comparePlayer ? extractMetricAny(comparePlayer.rawJson as any, ["shots_missed"]) : null;
  const compareTotalShots = (compareShotsHit ?? 0) + (compareShotsMissed ?? 0);
  const compareAccuracy = compareTotalShots > 0 ? ((compareShotsHit ?? 0) / compareTotalShots) * 100 : null;
  const compareTeamKills = comparePlayer
    ? allPlayerRows
        .filter((row) => row.side === comparePlayer.side)
        .reduce((sum, row) => sum + safeNum(row.kills), 0)
    : null;
  const compareContrib = comparePlayer ? safeNum(comparePlayer.kills) + safeNum(comparePlayer.assists) : null;
  const compareKillParticipation =
    compareTeamKills != null && compareContrib != null && compareTeamKills > 0
      ? (compareContrib / compareTeamKills) * 100
      : null;
  const playerKda = (safeNum(player.kills) + safeNum(player.assists)) / Math.max(1, safeNum(player.deaths));
  const compareKda = comparePlayer
    ? (safeNum(comparePlayer.kills) + safeNum(comparePlayer.assists)) /
      Math.max(1, safeNum(comparePlayer.deaths))
    : null;

  const teamAvgSpm =
    teamRows.length > 0
      ? teamRows.reduce((sum, r) => sum + safeNum(r.netWorth) / (durationS / 60), 0) / teamRows.length
      : null;

  const teamAvgDpm =
    teamRows.length > 0
      ? teamRows.reduce((sum, r) => {
          const dmg = extractDamageTotal(r.rawJson as any);
          return sum + (dmg != null ? dmg / (durationS / 60) : 0);
        }, 0) / teamRows.length
      : null;

  const spmDelta = teamAvgSpm != null ? spm - teamAvgSpm : null;
  const dpmDelta = teamAvgDpm != null && dpm != null ? dpm - teamAvgDpm : null;

  const teamTotalKills = teamRows.reduce((sum, row) => sum + safeNum(row.kills), 0);
  const playerContrib = safeNum(player.kills) + safeNum(player.assists);
  const killParticipation = teamTotalKills > 0 ? (playerContrib / teamTotalKills) * 100 : null;

  const finalItems = resolveLiveInventoryEvents(itemRows, durationS).filter((it) => hasItem(Number(it.itemId)));
  const timeline = itemRows.filter((it) => hasItem(Number(it.itemId)));
  const abilityProgressRows = buildAbilityProgressRows(raw, itemRows);

  const snapshots: any[] = Array.isArray(raw?.stats) ? raw.stats : [];
  const superTimeline = buildSuperTimeline({ itemRows: timeline, snapshots });
  const playerSlot = Number(raw?.player_slot ?? raw?.playerSlot ?? NaN);
  const heatmapSources = Number.isFinite(playerSlot) && matchRaw != null
    ? [{ __heatmapRaw: matchRaw, __heatmapTargetSlot: playerSlot, __heatmapMatchId: matchId, __heatmapStrictPlayer: true }]
    : [{ __heatmapRaw: raw, __heatmapMatchId: matchId, __heatmapStrictPlayer: true }];
  const matchHeatmap = buildHeatmapSeriesFromManyPlayerRaw(heatmapSources as unknown[]);

  const finalSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const firstSnapshot = snapshots.length ? snapshots[0] : null;

  const peakSouls = snapshots.length ? Math.max(...snapshots.map((s) => safeNum(s?.net_worth))) : null;
  const peakDamage = snapshots.length ? Math.max(...snapshots.map((s) => safeNum(s?.player_damage))) : null;
  const damageGrowth =
    firstSnapshot && finalSnapshot
      ? safeNum(finalSnapshot.player_damage) - safeNum(firstSnapshot.player_damage)
      : null;

  const goldSources: Array<{ source?: number; gold?: number | null }> = Array.isArray(finalSnapshot?.gold_sources)
    ? finalSnapshot.gold_sources
    : [];
  const sourceGold = (id: number) =>
    goldSources.find((entry) => Number(entry?.source) === id)?.gold ?? null;

  const laneGold = sourceGold(2);
  const playerGold = sourceGold(1);
  const neutralGold = sourceGold(3);
  const bossGold = sourceGold(4);

  const lhPerMin = durationS > 0 ? safeNum(player.lastHits) / (durationS / 60) : null;
  const deathsPer10 = durationS > 0 ? (safeNum(player.deaths) / durationS) * 600 : null;
  const assistsPer10 = durationS > 0 ? (safeNum(player.assists) / durationS) * 600 : null;
  const damagePerDeath = safeNum(player.deaths) > 0 && damageTotal != null ? damageTotal / safeNum(player.deaths) : null;

  const maxHealth = extractMetricAny(raw, ["max_health", "stats.max_health"]);
  const weaponPower = extractMetricAny(raw, ["weapon_power", "stats.weapon_power"]);
  const techPower = extractMetricAny(raw, ["tech_power", "stats.tech_power"]);
  const selfHealing = extractMetricAny(raw, ["self_healing", "stats.self_healing"]);
  const damageAbsorbed = extractMetricAny(raw, ["damage_absorbed", "stats.damage_absorbed"]);
  const powerUpBuffs: PowerUpBuffRow[] = Array.isArray(raw?.power_up_buffs) ? raw.power_up_buffs : [];
  const permanentBuffs = powerUpBuffs.filter((buff) => Boolean(buff?.is_permanent));
  const temporaryBuffs = powerUpBuffs.filter((buff) => !buff?.is_permanent);
  const permanentBuffValue = permanentBuffs.reduce((sum, buff) => sum + safeNum(buff?.value), 0);
  const temporaryBuffValue = temporaryBuffs.reduce((sum, buff) => sum + safeNum(buff?.value), 0);

  const groupedPowerUpBuffs = [...powerUpBuffs
    .reduce((map, buff) => {
      const type = buff?.type ?? "unknown";
      const existing = map.get(type) ?? {
        type,
        totalValue: 0,
        count: 0,
        permanentCount: 0,
      };

      existing.totalValue += safeNum(buff?.value);
      existing.count += 1;
      if (buff?.is_permanent) existing.permanentCount += 1;

      map.set(type, existing);
      return map;
    }, new Map<string, { type: string; totalValue: number; count: number; permanentCount: number }>())
    .values()]
    .sort((a, b) => {
      if (b.permanentCount !== a.permanentCount) return b.permanentCount - a.permanentCount;
      if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue;
      return a.type.localeCompare(b.type);
    });

  const chartSnapshots = snapshots.map((s) => ({
    timeS: safeNum(s?.time_stamp_s),
    souls: safeNum(s?.net_worth),
    damage: safeNum(s?.player_damage),
    taken: safeNum(s?.player_damage_taken),
  }));

  const compareSnapshotsRaw: any[] = Array.isArray((comparePlayer?.rawJson as any)?.stats)
    ? (comparePlayer?.rawJson as any).stats
    : [];

  const compareChartSnapshots = compareSnapshotsRaw.map((s) => ({
    timeS: safeNum(s?.time_stamp_s),
    souls: safeNum(s?.net_worth),
    damage: safeNum(s?.player_damage),
    taken: safeNum(s?.player_damage_taken),
  }));

  const barStats = [
    { label: "Damage", value: safeNum(damageTotal) },
    { label: "Taken", value: safeNum(damageTaken) },
    { label: "Healing", value: safeNum(healing) },
    { label: "Creep", value: safeNum(creepDamage) },
    { label: "Neutral", value: safeNum(neutralDamage) },
    { label: "Boss", value: safeNum(bossDamage) },
  ];

  const compareBarStats = comparePlayer
    ? [
        {
          label: "Damage",
          value: safeNum(extractDamageTotal(comparePlayer.rawJson as any)),
        },
        {
          label: "Taken",
          value: safeNum(extractMetricAny(comparePlayer.rawJson as any, ["player_damage_taken", "damage_taken", "stats.damage_taken"])),
        },
        {
          label: "Healing",
          value: safeNum(extractMetricAny(comparePlayer.rawJson as any, ["player_healing", "healing_done", "healing"])),
        },
        {
          label: "Creep",
          value: safeNum(extractMetricAny(comparePlayer.rawJson as any, ["creep_damage", "stats.creep_damage"])),
        },
        {
          label: "Neutral",
          value: safeNum(extractMetricAny(comparePlayer.rawJson as any, ["neutral_damage", "stats.neutral_damage"])),
        },
        {
          label: "Boss",
          value: safeNum(extractMetricAny(comparePlayer.rawJson as any, ["boss_damage", "stats.boss_damage"])),
        },
      ]
    : [];

  const playerHeroIconPath = playerHeroThumbPath(player.heroId);
  const playerHeroBackgroundPath = heroBackgroundPath(player.heroId);
  const playerHeroRenderPath = heroRenderPath(player.heroId);
  const compareHeroIconPath = playerHeroThumbPath(comparePlayer?.heroId);

  return (
    <main className="relative isolate w-full overflow-hidden p-4 sm:p-6 lg:p-8">
      {playerHeroBackgroundPath ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-bottom-right bg-no-repeat opacity-55 dark:opacity-35"
          style={{ backgroundImage: `url(${playerHeroBackgroundPath})` }}
        />
      ) : null}
      {playerHeroRenderPath ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-bottom-right bg-no-repeat opacity-75 dark:opacity-45"
          style={{ backgroundImage: `url(${playerHeroRenderPath})`, backgroundSize: "auto 100%" }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 z-0 bg-white/0 dark:bg-zinc-950/45" />

      <div className="relative z-10 space-y-5 sm:space-y-6">

      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <a href={`/match/${matchId}`} className="text-sm text-zinc-300 hover:underline">
          Back to match
        </a>
      </div>

      <div className="panel-premium rounded-xl p-4 md:p-5">
        <h1 className="heading-luxe text-3xl font-bold">{player.displayName ?? "(unknown)"}</h1>
        <p className="text-sm text-zinc-400">
          Match {matchId} • Steam {steamId} • Hero {heroName(player.heroId)} • Duration {fmtTime(durationS)}
        </p>
        {comparePlayer ? (
          <p className="text-sm text-zinc-300 mt-1 flex items-center gap-2">
            {compareHeroIconPath ? (
              <HeroIcon
                src={compareHeroIconPath}
                alt={heroName(comparePlayer.heroId)}
                width={16}
                height={16}
                className="h-4 w-4 rounded object-cover border border-zinc-700"
              />
            ) : null}
            <span>Comparing vs {comparePlayer.displayName ?? "(unknown)"} • Hero {heroName(comparePlayer.heroId)}</span>
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="space-y-6">
          <section className="panel-premium rounded-xl p-4 md:p-5">
            <h2 className="text-lg font-semibold mb-3">Hero snapshot</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">Hero</p>
                <p className="mt-1 font-semibold flex items-center gap-2">
                  {playerHeroIconPath ? (
                    <HeroIcon
                      src={playerHeroIconPath}
                      alt={heroName(player.heroId)}
                      width={20}
                      height={20}
                      className="h-5 w-5 rounded object-cover border border-zinc-700"
                    />
                  ) : null}
                  <span>{heroName(player.heroId)}</span>
                </p>
              </div>
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">K / D / A</p>
                <p className="mt-1 font-semibold">{player.kills ?? "-"} / {player.deaths ?? "-"} / {player.assists ?? "-"}</p>
              </div>
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">Souls/min</p>
                <p className="mt-1 font-semibold">{fmt1(spm)}</p>
              </div>
              <div className="panel-premium-soft rounded p-3">
                <p className="text-xs uppercase opacity-70">Damage/min</p>
                <p className="mt-1 font-semibold">{dpm != null ? fmt1(dpm) : "-"}</p>
              </div>
            </div>

            <h2 className="text-lg font-semibold mb-3">Core stats</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 text-sm">
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">K / D / A</p><p className="mt-1 font-mono text-base">{player.kills ?? "-"} / {player.deaths ?? "-"} / {player.assists ?? "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Souls</p><p className="mt-1 font-mono text-base">{player.netWorth ?? "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Souls/min</p><p className="mt-1 font-mono text-base">{player.netWorth != null ? fmt1(spm) : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Damage</p><p className="mt-1 font-mono text-base">{damageTotal != null ? damageTotal : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Damage/min</p><p className="mt-1 font-mono text-base">{dpm != null ? fmt1(dpm) : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Damage taken</p><p className="mt-1 font-mono text-base">{damageTaken != null ? damageTaken : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Healing</p><p className="mt-1 font-mono text-base">{healing != null ? healing : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Accuracy</p><p className="mt-1 font-mono text-base">{accuracy != null ? `${fmt1(accuracy)}%` : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Kill participation</p><p className="mt-1 font-mono text-base">{killParticipation != null ? fmtPct(killParticipation) : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Creep / Neutral / Boss</p><p className="mt-1 font-mono text-base">{creepDamage ?? "-"} / {neutralDamage ?? "-"} / {bossDamage ?? "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">LH / Dn / Lvl</p><p className="mt-1 font-mono text-base">{player.lastHits ?? "-"} / {player.denies ?? "-"} / {player.level ?? "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Pace</p><p className="mt-1 font-mono text-base">LH/m {lhPerMin != null ? fmt1(lhPerMin) : "-"}</p><p className="font-mono text-xs opacity-80">D/10 {deathsPer10 != null ? fmt1(deathsPer10) : "-"} • A/10 {assistsPer10 != null ? fmt1(assistsPer10) : "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Peaks</p><p className="mt-1 font-mono text-base">Souls {peakSouls ?? "-"}</p><p className="font-mono text-xs opacity-80">Dmg {peakDamage ?? "-"} • +{damageGrowth ?? "-"}</p></div>
              <div className="panel-premium-soft rounded p-3"><p className="text-[11px] uppercase opacity-70">Damage / Death</p><p className="mt-1 font-mono text-base">{damagePerDeath != null ? fmt1(damagePerDeath) : "-"}</p></div>
            </div>

            <div className="panel-premium-soft mt-4 rounded p-3 text-sm">
              <p className="font-medium mb-2">Compared to team average</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  Souls/min delta: {spmDelta != null ? (
                    <span className={`font-mono ${spmDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {spmDelta >= 0 ? "+" : ""}{fmt1(spmDelta)}
                    </span>
                  ) : <span className="font-mono">-</span>}
                </p>
                <p>
                  Damage/min delta: {dpmDelta != null ? (
                    <span className={`font-mono ${dpmDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {dpmDelta >= 0 ? "+" : ""}{fmt1(dpmDelta)}
                    </span>
                  ) : <span className="font-mono">-</span>}
                </p>
              </div>
            </div>
          </section>

          <section className="panel-premium rounded-xl p-4 md:p-5">
            <h2 className="text-lg font-semibold mb-3">Enemy tracking</h2>

            {trackedEnemy ? (
              <>
                {enemyRows.length ? (
                  <div className="mb-3">
                    <p className="mb-2 text-xs uppercase opacity-70">Choose enemy (opposing team only)</p>
                    <div className="flex flex-wrap gap-2">
                      {enemyRows.map((row) => {
                        const selected = trackedEnemy.steamId === row.steamId;
                        const enemyHref = `/match/${matchId}/player/${steamId}?${new URLSearchParams({
                          ...(compareSteamId ? { compare: compareSteamId } : {}),
                          enemy: row.steamId,
                        }).toString()}`;
                        return (
                          <a
                            key={`enemy-${row.steamId}`}
                            href={enemyHref}
                            className={`rounded px-2 py-1 text-xs border ${
                              selected
                                ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                                : "border-zinc-700/80 bg-zinc-900/60 hover:bg-zinc-900/80"
                            }`}
                          >
                            {row.displayName ?? "(unknown)"} ({heroName(row.heroId)})
                          </a>
                        );
                      })}
                      <a
                        href={`/match/${matchId}/player/${steamId}${compareSteamId ? `?${new URLSearchParams({ compare: compareSteamId }).toString()}` : ""}`}
                        className="rounded px-2 py-1 text-xs border border-zinc-700/80 bg-zinc-900/60 hover:bg-zinc-900/80"
                      >
                        Auto select
                      </a>
                    </div>
                  </div>
                ) : null}

                <p className="mb-3 text-sm text-zinc-300">
                  Tracking {trackedEnemy.displayName ?? "(unknown)"} • {heroName(trackedEnemy.heroId)}
                </p>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 text-sm">
                  <div className="panel-premium-soft rounded p-3">
                    <p className="text-[11px] uppercase opacity-70">Current souls Δ</p>
                    <p className={`mt-1 font-mono text-base ${safeNum(player.netWorth) - safeNum(trackedEnemy.netWorth) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmtSigned(safeNum(player.netWorth) - safeNum(trackedEnemy.netWorth))}
                    </p>
                  </div>
                  <div className="panel-premium-soft rounded p-3">
                    <p className="text-[11px] uppercase opacity-70">S/min Δ</p>
                    <p className={`mt-1 font-mono text-base ${trackedEnemySpm != null && spm - trackedEnemySpm >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {trackedEnemySpm != null ? fmtSigned(spm - trackedEnemySpm) : "-"}
                    </p>
                  </div>
                  <div className="panel-premium-soft rounded p-3">
                    <p className="text-[11px] uppercase opacity-70">Damage Δ</p>
                    <p className={`mt-1 font-mono text-base ${trackedEnemyDamage != null && damageTotal != null && damageTotal - trackedEnemyDamage >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {trackedEnemyDamage != null && damageTotal != null ? fmtSigned(damageTotal - trackedEnemyDamage) : "-"}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm opacity-70">No enemy player data available for enemy tracking in this match.</p>
            )}
          </section>

          <section className="panel-premium rounded-xl p-4 md:p-5">
            <h2 className="text-lg font-semibold mb-3">Laning performance</h2>

            {trackedEnemy ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 text-sm">
                  <div className="panel-premium-soft rounded p-3">
                    <p className="text-[11px] uppercase opacity-70">Laning outcome</p>
                    <p className={`mt-1 text-base font-semibold ${laningState.className}`}>{laningState.label}</p>
                    <p className="font-mono text-xs opacity-80">Score {laningScore != null ? fmt1(laningScore) : "-"}</p>
                  </div>
                  <div className="panel-premium-soft rounded p-3">
                    <p className="text-[11px] uppercase opacity-70">10m souls Δ</p>
                    <p className={`mt-1 font-mono text-base ${laneSoulsDelta != null && laneSoulsDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {laneSoulsDelta != null ? fmtSigned(laneSoulsDelta) : "-"}
                    </p>
                  </div>
                  <div className="panel-premium-soft rounded p-3">
                    <p className="text-[11px] uppercase opacity-70">10m CS+Dn Δ</p>
                    <p className={`mt-1 font-mono text-base ${laneCsDelta != null && laneCsDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {laneCsDelta != null ? fmtSigned(laneCsDelta) : "-"}
                    </p>
                  </div>
                  <div className="panel-premium-soft rounded p-3">
                    <p className="text-[11px] uppercase opacity-70">10m K+A-D Δ</p>
                    <p className={`mt-1 font-mono text-base ${laneKdaDelta != null && laneKdaDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {laneKdaDelta != null ? fmtSigned(laneKdaDelta) : "-"}
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-xs text-zinc-500">
                  Laning metrics use first available snapshot up to 10:00 for both players.
                </p>
              </>
            ) : (
              <p className="text-sm opacity-70">No enemy player data available for laning comparison in this match.</p>
            )}
          </section>

          <PlayerGraphs
            snapshots={chartSnapshots}
            bars={barStats}
            compareSnapshots={compareChartSnapshots}
            compareBars={compareBarStats}
            compareLabel={comparePlayer?.displayName ?? "Compare"}
          />

          <section className="panel-premium rounded-xl p-4 md:p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Items</h2>
        <p className="text-sm mb-2">Final build</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {finalItems.length ? finalItems.map((it) => (
            <span key={`${it.gameTimeS}-${it.itemId}`} className="px-2 py-1 rounded border border-zinc-700/80 bg-zinc-900/60 text-xs whitespace-nowrap inline-flex items-center gap-1">
              {itemIconPath(Number(it.itemId)) ? (
                <HeroIcon
                  src={itemIconPath(Number(it.itemId))}
                  alt={itemName(Number(it.itemId))}
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 rounded object-contain border border-zinc-700"
                />
              ) : null}
              {itemName(Number(it.itemId))}
            </span>
          )) : <span className="text-sm opacity-70">-</span>}
        </div>

        <p className="text-sm mb-2">Ability progression</p>
        {abilityProgressRows.length ? (
          <div className="flex flex-wrap gap-2">
            {abilityProgressRows.map((ability) => (
              <span
                key={ability.key}
                className="px-2 py-1 rounded border border-zinc-700/80 bg-zinc-900/60 text-xs whitespace-nowrap inline-flex items-center gap-1"
                title={`${ability.abilityName} • Lvl ${Math.max(ability.maxLevel, ability.unlockCount > 0 ? 1 : 0)} • Unlock ${ability.unlockCount} • Upgrade ${ability.upgradeCount} • Imbue ${ability.imbueCount}`}
              >
                {ability.abilityIconSrc ? (
                  <HeroIcon
                    src={ability.abilityIconSrc}
                    alt={ability.abilityName}
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 rounded object-contain border border-zinc-700"
                  />
                ) : null}
                <span className="font-medium">{ability.abilityName}</span>
                <span className="font-mono opacity-85">L{Math.max(ability.maxLevel, ability.unlockCount > 0 ? 1 : 0)}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm opacity-70">No ability upgrade data found.</span>
        )}
          </section>

          <section id="compare-players-block" className="panel-premium rounded-xl p-4 md:p-5">
            <h2 className="text-lg font-semibold mb-3">Compare players</h2>
            {compareOptions.length ? (
              <div className="panel-premium-soft rounded p-3 mb-4">
                <p className="text-xs uppercase opacity-70 mb-2">Choose opponent</p>
                <div className="flex flex-wrap gap-2">
                  {compareOptions.map((row) => {
                    const selected = comparePlayer?.steamId === row.steamId;
                    return (
                      <a
                        key={row.steamId}
                        href={`/match/${matchId}/player/${steamId}?compare=${encodeURIComponent(row.steamId)}`}
                        className={`px-2 py-1 rounded text-xs border ${
                          selected
                            ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                            : "border-zinc-700/80 bg-zinc-900/60 hover:bg-zinc-900/80"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {playerHeroThumbPath(row.heroId) ? (
                            <HeroIcon
                              src={playerHeroThumbPath(row.heroId)}
                              alt={heroName(row.heroId)}
                              width={14}
                              height={14}
                              className="h-3.5 w-3.5 rounded object-cover border border-zinc-700"
                            />
                          ) : null}
                          <span>{row.displayName ?? "(unknown)"} ({heroName(row.heroId)})</span>
                        </span>
                      </a>
                    );
                  })}
                  {comparePlayer ? (
                    <a
                      href={`/match/${matchId}/player/${steamId}`}
                      className="px-2 py-1 rounded text-xs border border-zinc-700/80 bg-zinc-900/60 hover:bg-zinc-900/80"
                    >
                      Clear compare
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm opacity-70 mb-4">No other players to compare in this match.</p>
            )}

            {comparePlayer ? (
              <div className="panel-premium-soft rounded mb-4 overflow-x-auto">
                <div className="flex items-center justify-between gap-2 border-b border-zinc-700/80 px-3 py-2 text-xs">
                  <p className="opacity-80">Positive Δ favors you</p>
                  <p className="font-mono opacity-70">
                    You: {player.displayName ?? "(unknown)"} • Them: {comparePlayer.displayName ?? "(unknown)"}
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-transparent dark:bg-zinc-950/70">
                    <tr>
                      <th className="px-3 py-2 text-left">Metric</th>
                      <th className="px-3 py-2 text-right">You</th>
                      <th className="px-3 py-2 text-right">Them</th>
                      <th className="px-3 py-2 text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-zinc-700/80 odd:bg-zinc-900/20">
                      <td className="px-3 py-2">KDA</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt1(playerKda)}</td>
                      <td className="px-3 py-2 text-right font-mono">{compareKda != null ? fmt1(compareKda) : "-"}</td>
                      <td className={`px-3 py-2 text-right font-mono ${compareKda != null && playerKda - compareKda >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {compareKda != null ? fmtSigned(playerKda - compareKda) : "-"}
                      </td>
                    </tr>
                    <tr className="border-t border-zinc-700/80 even:bg-zinc-900/20">
                      <td className="px-3 py-2">Souls/min</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt1(spm)}</td>
                      <td className="px-3 py-2 text-right font-mono">{compareSpm != null ? fmt1(compareSpm) : "-"}</td>
                      <td className={`px-3 py-2 text-right font-mono ${compareSpm != null && spm - compareSpm >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {compareSpm != null ? fmtSigned(spm - compareSpm) : "-"}
                      </td>
                    </tr>
                    <tr className="border-t border-zinc-700/80 odd:bg-zinc-900/20">
                      <td className="px-3 py-2">Damage/min</td>
                      <td className="px-3 py-2 text-right font-mono">{dpm != null ? fmt1(dpm) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{compareDpm != null ? fmt1(compareDpm) : "-"}</td>
                      <td className={`px-3 py-2 text-right font-mono ${dpm != null && compareDpm != null && dpm - compareDpm >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {dpm != null && compareDpm != null ? fmtSigned(dpm - compareDpm) : "-"}
                      </td>
                    </tr>
                    <tr className="border-t border-zinc-700/80 even:bg-zinc-900/20">
                      <td className="px-3 py-2">Kill participation</td>
                      <td className="px-3 py-2 text-right font-mono">{killParticipation != null ? fmtPct(killParticipation) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{compareKillParticipation != null ? fmtPct(compareKillParticipation) : "-"}</td>
                      <td className={`px-3 py-2 text-right font-mono ${killParticipation != null && compareKillParticipation != null && killParticipation - compareKillParticipation >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {killParticipation != null && compareKillParticipation != null ? `${fmtSigned(killParticipation - compareKillParticipation)}%` : "-"}
                      </td>
                    </tr>
                    <tr className="border-t border-zinc-700/80 odd:bg-zinc-900/20">
                      <td className="px-3 py-2">Accuracy</td>
                      <td className="px-3 py-2 text-right font-mono">{accuracy != null ? `${fmt1(accuracy)}%` : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{compareAccuracy != null ? `${fmt1(compareAccuracy)}%` : "-"}</td>
                      <td className={`px-3 py-2 text-right font-mono ${accuracy != null && compareAccuracy != null && accuracy - compareAccuracy >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {accuracy != null && compareAccuracy != null ? `${fmtSigned(accuracy - compareAccuracy)}%` : "-"}
                      </td>
                    </tr>
                    <tr className="border-t border-zinc-700/80 even:bg-zinc-900/20">
                      <td className="px-3 py-2">Souls</td>
                      <td className="px-3 py-2 text-right font-mono">{player.netWorth ?? "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{comparePlayer.netWorth ?? "-"}</td>
                      <td className={`px-3 py-2 text-right font-mono ${safeNum(player.netWorth) - safeNum(comparePlayer.netWorth) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {fmtSigned(safeNum(player.netWorth) - safeNum(comparePlayer.netWorth))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm opacity-70 mb-4">Select a player above to compare side-by-side.</p>
            )}

            <h2 className="text-lg font-semibold mb-3">Progression snapshots</h2>
            {snapshots.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900/60">
                    <tr>
                      <th className="p-2 text-left">Time</th>
                      <th className="p-2 text-right">Souls</th>
                      <th className="p-2 text-right">Player dmg</th>
                      <th className="p-2 text-right">Taken</th>
                      <th className="p-2 text-right">LH</th>
                      <th className="p-2 text-right">Kills</th>
                      <th className="p-2 text-right">Deaths</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s, idx) => (
                      <tr key={idx} className="border-t border-zinc-900">
                        <td className="p-2 font-mono">{fmtTime(Number(s?.time_stamp_s ?? 0))}</td>
                        <td className="p-2 text-right">{s?.net_worth ?? "-"}</td>
                        <td className="p-2 text-right">{s?.player_damage ?? "-"}</td>
                        <td className="p-2 text-right">{s?.player_damage_taken ?? "-"}</td>
                        <td className="p-2 text-right">{s?.creep_kills ?? "-"}</td>
                        <td className="p-2 text-right">{s?.kills ?? "-"}</td>
                        <td className="p-2 text-right">{s?.deaths ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm opacity-70">No progression snapshots available.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 h-fit">
          <section className="panel-premium rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-2">Quick insights</h3>
            <div className="space-y-2 text-sm">
              <p>Team size: <span className="font-mono">{teamRows.length}</span></p>
              <p>Team kills: <span className="font-mono">{teamTotalKills}</span></p>
              <p>Kill participation: <span className="font-mono">{killParticipation != null ? fmtPct(killParticipation) : "-"}</span></p>
              <p>Snapshot points: <span className="font-mono">{snapshots.length}</span></p>
              <p>Final timeline items: <span className="font-mono">{timeline.length}</span></p>
            </div>
          </section>

          <section className="panel-premium rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-2">Economy source split</h3>
            <div className="space-y-2 text-sm">
              <p>Player gold: <span className="font-mono">{playerGold ?? "-"}</span></p>
              <p>Lane gold: <span className="font-mono">{laneGold ?? "-"}</span></p>
              <p>Neutral gold: <span className="font-mono">{neutralGold ?? "-"}</span></p>
              <p>Boss gold: <span className="font-mono">{bossGold ?? "-"}</span></p>
            </div>
          </section>

          <section className="panel-premium rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-2">Power-up buffs</h3>
            <div className="grid gap-2 sm:grid-cols-3 text-xs mb-3">
              <div className="panel-premium-soft rounded px-2 py-1">
                <p className="uppercase opacity-70">Total</p>
                <p className="font-mono text-sm">{powerUpBuffs.length}</p>
              </div>
              <div className="panel-premium-soft rounded px-2 py-1">
                <p className="uppercase opacity-70">Permanent</p>
                <p className="font-mono text-sm">{permanentBuffs.length} <span className="opacity-70">(v {permanentBuffValue})</span></p>
              </div>
              <div className="panel-premium-soft rounded px-2 py-1">
                <p className="uppercase opacity-70">Temporary</p>
                <p className="font-mono text-sm">{temporaryBuffs.length} <span className="opacity-70">(v {temporaryBuffValue})</span></p>
              </div>
            </div>

            {powerUpBuffs.length ? (
              <div className="panel-premium-soft rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-transparent dark:bg-zinc-950/70">
                    <tr>
                      <th className="px-2 py-1 text-left">Buff</th>
                      <th className="px-2 py-1 text-right">Count</th>
                      <th className="px-2 py-1 text-right">Perm</th>
                      <th className="px-2 py-1 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedPowerUpBuffs.map((buff) => (
                      <tr key={buff.type} className="border-t border-zinc-700/80 odd:bg-zinc-900/20">
                        <td className="px-2 py-1 font-medium">{prettifyBuffType(buff.type)}</td>
                        <td className="px-2 py-1 text-right font-mono">{buff.count}</td>
                        <td className="px-2 py-1 text-right font-mono">{buff.permanentCount}</td>
                        <td className="px-2 py-1 text-right font-mono">{buff.totalValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm opacity-70">No power-up buff data available.</p>
            )}
          </section>

          <section className="panel-premium rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-2">Combat utility</h3>
            <div className="space-y-2 text-sm">
              <p>Max health: <span className="font-mono">{maxHealth ?? "-"}</span></p>
              <p>Weapon power: <span className="font-mono">{weaponPower ?? "-"}</span></p>
              <p>Tech power: <span className="font-mono">{techPower ?? "-"}</span></p>
              <p>Self healing: <span className="font-mono">{selfHealing ?? "-"}</span></p>
              <p>Damage absorbed: <span className="font-mono">{damageAbsorbed ?? "-"}</span></p>
            </div>
          </section>

          <MapHeatmap
            title="Map heatmap"
            description="Kill and death density from this match player timeline. Hover a dot to see who killed whom and when."
            kills={matchHeatmap.kills}
            deaths={matchHeatmap.deaths}
          />

          <section className="panel-premium rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Super timeline</h3>
              <p className="text-xs opacity-70">{superTimeline.length} events</p>
            </div>
            {superTimeline.length ? (
              <HeightMatchedScroll
                targetId="compare-players-block"
                minHeight={280}
                className="rounded border border-zinc-700/80"
              >
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900/60">
                    <tr>
                      <th className="p-2 text-left">Time</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">Event</th>
                      <th className="p-2 text-left">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {superTimeline.map((event, index) => (
                      <tr key={`${event.timeS}-${event.category}-${event.title}-${index}`} className="border-t border-zinc-900 align-top">
                        <td className="p-2 font-mono whitespace-nowrap">{fmtTime(event.timeS)}</td>
                        <td className="p-2 uppercase opacity-80">{event.category}</td>
                        <td className="p-2 font-medium">{event.title}</td>
                        <td className="p-2 opacity-90">{event.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HeightMatchedScroll>
            ) : (
              <p className="text-sm opacity-70">No timeline events available.</p>
            )}
          </section>
        </aside>
      </div>
      </div>
    </main>
  );
}
