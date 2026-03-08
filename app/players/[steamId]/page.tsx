import { and, desc, eq, inArray } from "drizzle-orm";
import BackButton from "../../../components/BackButton";
import HeroIcon from "../../../components/HeroIcon";
import MapHeatmap from "../../../components/MapHeatmap";
import PlayerGraphs from "../../../components/PlayerGraphs";
import { db } from "../../../db";
import { matchPlayerItems, matchPlayers, matches, players } from "../../../db/schema";
import { fmtTime, hasItem, heroName, itemName } from "../../../lib/deadlockData";
import { heroBackgroundPath, heroRenderPath, heroSmallIconPath } from "../../../lib/heroIcons";
import { itemIconPath } from "../../../lib/itemIcons";
import { buildHeatmapSeriesFromManyPlayerRaw } from "../../../lib/mapHeatmap";

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
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

function prettifyBuffType(type: string | null | undefined) {
  if (!type) return "Unknown";
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractMetric(raw: any, keys: string[]): number | null {
  for (const key of keys) {
    const parts = key.split(".");
    let value: any = raw;

    for (const part of parts) {
      value = value?.[part];
    }

    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
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

function extractPlayerSlot(raw: any): number | null {
  const slot = Number(raw?.player_slot ?? raw?.playerSlot ?? raw?.slot ?? NaN);
  return Number.isFinite(slot) ? slot : null;
}

function playerHeroThumbPath(heroId: string | null | undefined) {
  return heroRenderPath(heroId) ?? heroSmallIconPath(heroId);
}

type PlayerAllMatchRow = {
  matchId: string;
  heroId: string | null;
  side: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  netWorth: number | null;
  lastHits: number | null;
  denies: number | null;
  level: number | null;
  playerRawJson: unknown;
  matchRawJson: unknown;
  scrimDate: Date | null;
  ingestedAt: Date | null;
};

function matchNumberFromId(matchId: string | null | undefined): number {
  const raw = String(matchId ?? "").trim();
  if (!raw) return Number.NEGATIVE_INFINITY;

  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;

  const digitsOnly = raw.replace(/\D/g, "");
  const parsed = Number(digitsOnly);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
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

export default async function PlayerAllMatchesPage({
  params,
}: {
  params: Promise<{ steamId: string }>;
}) {
  const { steamId } = await params;

  const playerRow = await db
    .select({
      steamId: players.steamId,
      displayName: players.displayName,
    })
    .from(players)
    .where(eq(players.steamId, steamId))
    .limit(1);

  const scrimDateColumnCheck = await db.execute(
    `select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
  );
  const hasScrimDateColumn = scrimDateColumnCheck.rows.length > 0;

  const rows: PlayerAllMatchRow[] = hasScrimDateColumn
    ? (
        await db
          .select({
            matchId: matchPlayers.matchId,
            heroId: matchPlayers.heroId,
            side: matchPlayers.side,
            kills: matchPlayers.kills,
            deaths: matchPlayers.deaths,
            assists: matchPlayers.assists,
            netWorth: matchPlayers.netWorth,
            lastHits: matchPlayers.lastHits,
            denies: matchPlayers.denies,
            level: matchPlayers.level,
            playerRawJson: matchPlayers.rawJson,
            matchRawJson: matches.rawJson,
            scrimDate: matches.scrimDate,
            ingestedAt: matches.ingestedAt,
          })
          .from(matchPlayers)
          .innerJoin(matches, eq(matches.matchId, matchPlayers.matchId))
          .where(eq(matchPlayers.steamId, steamId))
          .orderBy(desc(matches.ingestedAt))
      ).sort(compareByDateThenMatchNumber)
    : (
        await db
          .select({
            matchId: matchPlayers.matchId,
            heroId: matchPlayers.heroId,
            side: matchPlayers.side,
            kills: matchPlayers.kills,
            deaths: matchPlayers.deaths,
            assists: matchPlayers.assists,
            netWorth: matchPlayers.netWorth,
            lastHits: matchPlayers.lastHits,
            denies: matchPlayers.denies,
            level: matchPlayers.level,
            playerRawJson: matchPlayers.rawJson,
            matchRawJson: matches.rawJson,
            ingestedAt: matches.ingestedAt,
          })
          .from(matchPlayers)
          .innerJoin(matches, eq(matches.matchId, matchPlayers.matchId))
          .where(eq(matchPlayers.steamId, steamId))
          .orderBy(desc(matches.ingestedAt))
      )
        .map((row) => ({ ...row, scrimDate: null as Date | null }))
        .sort(compareByDateThenMatchNumber);

  if (!rows.length) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <BackButton />
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
          <h1 className="text-2xl font-bold">Player not found</h1>
          <p className="mt-2 text-zinc-400">No matches found for Steam ID {steamId}.</p>
        </section>
      </main>
    );
  }

  const overallHeatmapRawRows = rows.flatMap((row) => {
    const fromPlayer = normalizeRawJson(row.playerRawJson);
    const slot = extractPlayerSlot(fromPlayer);
    const matchRaw = normalizeRawJson(row.matchRawJson);
    const fromMatchWithTarget = slot != null
      ? {
          __heatmapRaw: matchRaw,
          __heatmapTargetSlot: slot,
          __heatmapMatchId: row.matchId,
          __heatmapStrictPlayer: true,
        }
      : null;
    return [fromMatchWithTarget ?? { __heatmapRaw: fromPlayer, __heatmapStrictPlayer: true }].filter((value) => value != null);
  });

  const overallHeatmap = buildHeatmapSeriesFromManyPlayerRaw(overallHeatmapRawRows);

  let wins = 0;
  let losses = 0;
  let unknown = 0;
  let totalKills = 0;
  let totalDeaths = 0;
  let totalAssists = 0;
  let totalSouls = 0;
  let totalDurationS = 0;
  let totalDamage = 0;
  let totalDamageTaken = 0;
  let totalHealing = 0;
  let totalCreepDamage = 0;
  let totalNeutralDamage = 0;
  let totalBossDamage = 0;
  let totalShotsHit = 0;
  let totalShotsMissed = 0;
  let totalLastHits = 0;
  let totalDenies = 0;
  let totalTeamKills = 0;
  let totalPlayerContrib = 0;
  let totalPlayerGold = 0;
  let totalLaneGold = 0;
  let totalNeutralGold = 0;
  let totalBossGold = 0;

  let maxPeakSouls = 0;
  let maxPeakDamage = 0;

  let sumMaxHealth = 0;
  let countMaxHealth = 0;
  let sumWeaponPower = 0;
  let countWeaponPower = 0;
  let sumTechPower = 0;
  let countTechPower = 0;
  let sumSelfHealing = 0;
  let countSelfHealing = 0;
  let sumDamageAbsorbed = 0;
  let countDamageAbsorbed = 0;

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
      damage: number;
    }
  >();

  const groupedPowerUpBuffs = new Map<
    string,
    {
      type: string;
      totalValue: number;
      count: number;
      permanentCount: number;
    }
  >();

  let totalPowerUpBuffs = 0;
  let totalPermanentBuffs = 0;
  let totalTemporaryBuffs = 0;
  let totalPermanentBuffValue = 0;
  let totalTemporaryBuffValue = 0;

  const matchIds = [...new Set(rows.map((row) => row.matchId))];
  const teamKillRows = matchIds.length
    ? await db
        .select({
          matchId: matchPlayers.matchId,
          side: matchPlayers.side,
          kills: matchPlayers.kills,
        })
        .from(matchPlayers)
        .where(inArray(matchPlayers.matchId, matchIds))
    : [];

  const playerItemRows = matchIds.length
    ? await db
        .select({
          matchId: matchPlayerItems.matchId,
          itemId: matchPlayerItems.itemId,
          gameTimeS: matchPlayerItems.gameTimeS,
        })
        .from(matchPlayerItems)
        .where(
          and(
            inArray(matchPlayerItems.matchId, matchIds),
            eq(matchPlayerItems.steamId, steamId),
          )
        )
    : [];

  const teamKillsByMatchSide = new Map<string, number>();
  for (const row of teamKillRows) {
    const key = `${row.matchId}:${row.side ?? "unknown"}`;
    teamKillsByMatchSide.set(key, (teamKillsByMatchSide.get(key) ?? 0) + safeNum(row.kills));
  }

  const rowsWithResult = rows.map((row) => {
    totalKills += safeNum(row.kills);
    totalDeaths += safeNum(row.deaths);
    totalAssists += safeNum(row.assists);
    totalSouls += safeNum(row.netWorth);
    totalLastHits += safeNum(row.lastHits);
    totalDenies += safeNum(row.denies);

    const matchRaw: any = row.matchRawJson;
    const playerRaw: any = row.playerRawJson;

    const winner = matchRaw?.match_info?.winning_team != null ? String(matchRaw.match_info.winning_team) : null;
    const result = winner != null && row.side != null
      ? (winner === row.side ? "Win" : "Loss")
      : "Unknown";

    if (result === "Win") wins += 1;
    else if (result === "Loss") losses += 1;
    else unknown += 1;

    if (row.heroId) {
      const stat = heroStats.get(row.heroId) ?? {
        heroId: row.heroId,
        picks: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        souls: 0,
        damage: 0,
      };
      stat.picks += 1;
      if (result === "Win") stat.wins += 1;
      if (result === "Loss") stat.losses += 1;
      stat.kills += safeNum(row.kills);
      stat.deaths += safeNum(row.deaths);
      stat.assists += safeNum(row.assists);
      stat.souls += safeNum(row.netWorth);
      heroStats.set(row.heroId, stat);
    }

    const durationS = Number(matchRaw?.match_info?.duration_s ?? matchRaw?.match_info?.duration ?? matchRaw?.duration_s ?? NaN);
    const safeDurationS = Number.isFinite(durationS) && durationS > 0 ? durationS : 1;
    totalDurationS += safeDurationS;

    const damageTotal = extractDamageTotal(playerRaw);
    const damageTaken = extractMetricAny(playerRaw, ["player_damage_taken", "damage_taken", "stats.damage_taken"]);
    const healing = extractMetricAny(playerRaw, ["player_healing", "healing_done", "healing"]);
    const creepDamage = extractMetricAny(playerRaw, ["creep_damage", "stats.creep_damage"]);
    const neutralDamage = extractMetricAny(playerRaw, ["neutral_damage", "stats.neutral_damage"]);
    const bossDamage = extractMetricAny(playerRaw, ["boss_damage", "stats.boss_damage"]);
    const shotsHit = extractMetricAny(playerRaw, ["shots_hit"]);
    const shotsMissed = extractMetricAny(playerRaw, ["shots_missed"]);

    totalDamage += safeNum(damageTotal);
    totalDamageTaken += safeNum(damageTaken);
    totalHealing += safeNum(healing);
    totalCreepDamage += safeNum(creepDamage);
    totalNeutralDamage += safeNum(neutralDamage);
    totalBossDamage += safeNum(bossDamage);
    totalShotsHit += safeNum(shotsHit);
    totalShotsMissed += safeNum(shotsMissed);

    if (row.heroId) {
      const stat = heroStats.get(row.heroId);
      if (stat) {
        stat.damage += safeNum(damageTotal);
        heroStats.set(row.heroId, stat);
      }
    }

    const teamKillsKey = `${row.matchId}:${row.side ?? "unknown"}`;
    const teamKills = teamKillsByMatchSide.get(teamKillsKey) ?? 0;
    const playerContrib = safeNum(row.kills) + safeNum(row.assists);
    totalTeamKills += teamKills;
    totalPlayerContrib += playerContrib;

    const killParticipation = teamKills > 0 ? (playerContrib / teamKills) * 100 : null;

    const snapshots: any[] = Array.isArray(playerRaw?.stats) ? playerRaw.stats : [];
    const finalSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
    const firstSnapshot = snapshots.length ? snapshots[0] : null;

    const peakSouls = snapshots.length ? Math.max(...snapshots.map((snapshot) => safeNum(snapshot?.net_worth))) : safeNum(row.netWorth);
    const peakDamage = snapshots.length ? Math.max(...snapshots.map((snapshot) => safeNum(snapshot?.player_damage))) : safeNum(damageTotal);
    const damageGrowth =
      firstSnapshot && finalSnapshot
        ? safeNum(finalSnapshot.player_damage) - safeNum(firstSnapshot.player_damage)
        : null;

    if (peakSouls > maxPeakSouls) maxPeakSouls = peakSouls;
    if (peakDamage > maxPeakDamage) maxPeakDamage = peakDamage;

    const goldSources: Array<{ source?: number; gold?: number | null }> = Array.isArray(finalSnapshot?.gold_sources)
      ? finalSnapshot.gold_sources
      : [];
    const sourceGold = (id: number) =>
      goldSources.find((entry) => Number(entry?.source) === id)?.gold ?? null;

    const playerGold = sourceGold(1);
    const laneGold = sourceGold(2);
    const neutralGold = sourceGold(3);
    const bossGold = sourceGold(4);

    totalPlayerGold += safeNum(playerGold);
    totalLaneGold += safeNum(laneGold);
    totalNeutralGold += safeNum(neutralGold);
    totalBossGold += safeNum(bossGold);

    const maxHealth = extractMetricAny(playerRaw, ["max_health", "stats.max_health"]);
    const weaponPower = extractMetricAny(playerRaw, ["weapon_power", "stats.weapon_power"]);
    const techPower = extractMetricAny(playerRaw, ["tech_power", "stats.tech_power"]);
    const selfHealing = extractMetricAny(playerRaw, ["self_healing", "stats.self_healing"]);
    const damageAbsorbed = extractMetricAny(playerRaw, ["damage_absorbed", "stats.damage_absorbed"]);

    if (maxHealth != null) {
      sumMaxHealth += maxHealth;
      countMaxHealth += 1;
    }
    if (weaponPower != null) {
      sumWeaponPower += weaponPower;
      countWeaponPower += 1;
    }
    if (techPower != null) {
      sumTechPower += techPower;
      countTechPower += 1;
    }
    if (selfHealing != null) {
      sumSelfHealing += selfHealing;
      countSelfHealing += 1;
    }
    if (damageAbsorbed != null) {
      sumDamageAbsorbed += damageAbsorbed;
      countDamageAbsorbed += 1;
    }

    const powerUpBuffs: Array<{ type?: string; value?: number | null; is_permanent?: boolean | null }> =
      Array.isArray(playerRaw?.power_up_buffs)
        ? playerRaw.power_up_buffs
        : [];

    totalPowerUpBuffs += powerUpBuffs.length;

    for (const buff of powerUpBuffs) {
      const type = buff?.type ?? "unknown";
      const existing = groupedPowerUpBuffs.get(type) ?? {
        type,
        totalValue: 0,
        count: 0,
        permanentCount: 0,
      };

      existing.totalValue += safeNum(buff?.value);
      existing.count += 1;
      if (buff?.is_permanent) {
        existing.permanentCount += 1;
        totalPermanentBuffs += 1;
        totalPermanentBuffValue += safeNum(buff?.value);
      } else {
        totalTemporaryBuffs += 1;
        totalTemporaryBuffValue += safeNum(buff?.value);
      }

      groupedPowerUpBuffs.set(type, existing);
    }

    const spm = safeNum(row.netWorth) / (safeDurationS / 60);
    const dpm = damageTotal != null ? damageTotal / (safeDurationS / 60) : null;

    const totalShots = safeNum(shotsHit) + safeNum(shotsMissed);
    const accuracy = totalShots > 0 ? (safeNum(shotsHit) / totalShots) * 100 : null;

    return {
      ...row,
      result,
      durationText: Number.isFinite(durationS) && durationS > 0 ? fmtTime(durationS) : "-",
      durationS: safeDurationS,
      damageTotal,
      damageTaken,
      healing,
      creepDamage,
      neutralDamage,
      bossDamage,
      shotsHit,
      shotsMissed,
      accuracy,
      killParticipation,
      peakSouls,
      peakDamage,
      damageGrowth,
      playerGold,
      laneGold,
      neutralGold,
      bossGold,
      maxHealth,
      weaponPower,
      techPower,
      selfHealing,
      damageAbsorbed,
      spm,
      dpm,
    };
  });

  const matchesPlayed = rows.length;
  const kda = (totalKills + totalAssists) / Math.max(1, totalDeaths);
  const avgKills = matchesPlayed > 0 ? totalKills / matchesPlayed : 0;
  const avgDeaths = matchesPlayed > 0 ? totalDeaths / matchesPlayed : 0;
  const avgAssists = matchesPlayed > 0 ? totalAssists / matchesPlayed : 0;
  const avgSouls = matchesPlayed > 0 ? totalSouls / matchesPlayed : 0;
  const overallSpm = totalSouls / Math.max(1 / 60, totalDurationS / 60);
  const overallDpm = totalDamage / Math.max(1 / 60, totalDurationS / 60);
  const winRateBase = wins + losses;
  const winRate = winRateBase > 0 ? (wins / winRateBase) * 100 : 0;
  const totalShots = totalShotsHit + totalShotsMissed;
  const overallAccuracy = totalShots > 0 ? (totalShotsHit / totalShots) * 100 : null;
  const overallKillParticipation = totalTeamKills > 0 ? (totalPlayerContrib / totalTeamKills) * 100 : null;
  const avgLhPerMin = totalLastHits / Math.max(1 / 60, totalDurationS / 60);

  const avgMaxHealth = countMaxHealth > 0 ? sumMaxHealth / countMaxHealth : null;
  const avgWeaponPower = countWeaponPower > 0 ? sumWeaponPower / countWeaponPower : null;
  const avgTechPower = countTechPower > 0 ? sumTechPower / countTechPower : null;
  const avgSelfHealing = countSelfHealing > 0 ? sumSelfHealing / countSelfHealing : null;
  const avgDamageAbsorbed = countDamageAbsorbed > 0 ? sumDamageAbsorbed / countDamageAbsorbed : null;

  const topHeroes = [...heroStats.values()]
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 6)
    .map((entry) => {
      const heroWinRateBase = entry.wins + entry.losses;
      const heroWinRate = heroWinRateBase > 0 ? (entry.wins / heroWinRateBase) * 100 : 0;
      const heroKda = (entry.kills + entry.assists) / Math.max(1, entry.deaths);
      const heroAvgSouls = entry.picks > 0 ? entry.souls / entry.picks : 0;
      return {
        ...entry,
        heroWinRate,
        heroKda,
        heroAvgSouls,
      };
    });

  const displayName = playerRow[0]?.displayName ?? "(unknown)";
  const mostPlayedHeroId = topHeroes[0]?.heroId ?? null;
  const mostPlayedHeroBackground = heroBackgroundPath(mostPlayedHeroId);
  const mostPlayedHeroRender = heroRenderPath(mostPlayedHeroId);

  const groupedBuffRows = [...groupedPowerUpBuffs.values()].sort((a, b) => {
    if (b.permanentCount !== a.permanentCount) return b.permanentCount - a.permanentCount;
    if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue;
    return a.type.localeCompare(b.type);
  });

  const careerSnapshots = [...rowsWithResult]
    .sort((a, b) => {
      const aTs = a.ingestedAt ? new Date(a.ingestedAt).getTime() : 0;
      const bTs = b.ingestedAt ? new Date(b.ingestedAt).getTime() : 0;
      if (aTs !== bTs) return aTs - bTs;
      return String(a.matchId).localeCompare(String(b.matchId));
    })
    .map((row, index) => ({
      timeS: (index + 1) * 60,
      souls: safeNum(row.netWorth),
      damage: safeNum(row.damageTotal),
      taken: safeNum(row.damageTaken),
    }));

  const careerPointLabels = [...rowsWithResult]
    .sort((a, b) => {
      const aTs = a.ingestedAt ? new Date(a.ingestedAt).getTime() : 0;
      const bTs = b.ingestedAt ? new Date(b.ingestedAt).getTime() : 0;
      if (aTs !== bTs) return aTs - bTs;
      return String(a.matchId).localeCompare(String(b.matchId));
    })
    .map((row, index) => `#${index + 1} • ${row.matchId}`);

  const barStats = [
    { label: "Damage", value: Math.round(matchesPlayed > 0 ? totalDamage / matchesPlayed : 0) },
    { label: "Taken", value: Math.round(matchesPlayed > 0 ? totalDamageTaken / matchesPlayed : 0) },
    { label: "Healing", value: Math.round(matchesPlayed > 0 ? totalHealing / matchesPlayed : 0) },
    { label: "Creep", value: Math.round(matchesPlayed > 0 ? totalCreepDamage / matchesPlayed : 0) },
    { label: "Neutral", value: Math.round(matchesPlayed > 0 ? totalNeutralDamage / matchesPlayed : 0) },
    { label: "Boss", value: Math.round(matchesPlayed > 0 ? totalBossDamage / matchesPlayed : 0) },
  ];

  const resultByMatch = new Map(rowsWithResult.map((row) => [row.matchId, row.result] as const));

  const itemStatsMap = new Map<
    number,
    {
      itemId: number;
      buys: number;
      totalBuyTimeS: number;
      matchIds: Set<string>;
      winMatchIds: Set<string>;
      lossMatchIds: Set<string>;
    }
  >();

  for (const row of playerItemRows) {
    const itemIdNum = Number(row.itemId);
    if (!Number.isFinite(itemIdNum) || !hasItem(itemIdNum)) continue;

    const stat = itemStatsMap.get(itemIdNum) ?? {
      itemId: itemIdNum,
      buys: 0,
      totalBuyTimeS: 0,
      matchIds: new Set<string>(),
      winMatchIds: new Set<string>(),
      lossMatchIds: new Set<string>(),
    };

    stat.buys += 1;
    stat.totalBuyTimeS += safeNum(row.gameTimeS);
    stat.matchIds.add(row.matchId);

    const result = resultByMatch.get(row.matchId);
    if (result === "Win") stat.winMatchIds.add(row.matchId);
    if (result === "Loss") stat.lossMatchIds.add(row.matchId);

    itemStatsMap.set(itemIdNum, stat);
  }

  const totalItemBuys = [...itemStatsMap.values()].reduce((sum, stat) => sum + stat.buys, 0);

  const playerItemStats = [...itemStatsMap.values()]
    .map((stat) => {
      const matchCount = stat.matchIds.size;
      const winCount = stat.winMatchIds.size;
      const lossCount = stat.lossMatchIds.size;
      const pickRate = matchesPlayed > 0 ? (matchCount / matchesPlayed) * 100 : 0;
      const winRateWhenPicked = winCount + lossCount > 0 ? (winCount / (winCount + lossCount)) * 100 : 0;
      const avgBuyTimeS = stat.buys > 0 ? stat.totalBuyTimeS / stat.buys : 0;
      const weightPct = totalItemBuys > 0 ? (stat.buys / totalItemBuys) * 100 : 0;

      return {
        itemId: stat.itemId,
        buys: stat.buys,
        matchCount,
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

  const topPlayerItems = playerItemStats.slice(0, 16);
  const corePlayerItems = topPlayerItems.filter((entry) => entry.pickRate >= 50);
  const situationalPlayerItems = topPlayerItems.filter((entry) => entry.pickRate < 50);

  return (
    <main className="relative isolate w-full overflow-hidden p-5 md:p-6">
      {mostPlayedHeroBackground ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-bottom-right bg-no-repeat opacity-55 dark:opacity-35"
          style={{ backgroundImage: `url(${mostPlayedHeroBackground})` }}
        />
      ) : null}
      {mostPlayedHeroRender ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-bottom-right bg-no-repeat opacity-75 dark:opacity-45"
          style={{ backgroundImage: `url(${mostPlayedHeroRender})`, backgroundSize: "auto 100%" }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 z-0 bg-white/0 dark:bg-zinc-950/45" />

      <div className="relative z-10 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <BackButton />
          <a href="/teams" className="text-sm text-zinc-300 hover:underline">
            Back to teams
          </a>
        </div>

        <header className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4">
          <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Steam {steamId} • Compiled across all saved matches
            {mostPlayedHeroId ? ` • Most played: ${heroName(mostPlayedHeroId)}` : ""}
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="space-y-6">
            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4 md:p-5">
              <h2 className="text-lg font-semibold mb-3">Hero snapshot</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/60 p-3">
                  <p className="text-xs uppercase opacity-70">Most played hero</p>
                  <p className="mt-1 font-semibold flex items-center gap-2">
                    {mostPlayedHeroId && playerHeroThumbPath(mostPlayedHeroId) ? (
                      <HeroIcon
                        src={playerHeroThumbPath(mostPlayedHeroId)}
                        alt={heroName(mostPlayedHeroId)}
                        width={20}
                        height={20}
                        className="h-5 w-5 rounded object-cover border border-zinc-700"
                      />
                    ) : null}
                    <span>{heroName(mostPlayedHeroId)}</span>
                  </p>
                </div>
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/60 p-3">
                  <p className="text-xs uppercase opacity-70">Matches</p>
                  <p className="mt-1 font-semibold">{matchesPlayed}</p>
                </div>
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/60 p-3">
                  <p className="text-xs uppercase opacity-70">Souls/min</p>
                  <p className="mt-1 font-semibold">{fmt1(overallSpm)}</p>
                </div>
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/60 p-3">
                  <p className="text-xs uppercase opacity-70">Damage/min</p>
                  <p className="mt-1 font-semibold">{fmt1(overallDpm)}</p>
                </div>
              </div>

              <h2 className="text-lg font-semibold mb-3">Core stats</h2>

              <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/55 p-3">
                <p className="text-sm font-semibold mb-2">Totals</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 text-sm">
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Record</p><p className="mt-1 font-mono text-base">{wins} / {losses} / {unknown}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Total K / D / A</p><p className="mt-1 font-mono text-base">{totalKills} / {totalDeaths} / {totalAssists}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Souls</p><p className="mt-1 font-mono text-base">{totalSouls}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Damage</p><p className="mt-1 font-mono text-base">{totalDamage}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Damage taken</p><p className="mt-1 font-mono text-base">{totalDamageTaken}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Healing</p><p className="mt-1 font-mono text-base">{totalHealing}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Creep / Neutral / Boss</p><p className="mt-1 font-mono text-base">{totalCreepDamage} / {totalNeutralDamage} / {totalBossDamage}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">LH / Dn</p><p className="mt-1 font-mono text-base">{totalLastHits} / {totalDenies}</p></div>
                </div>
              </div>

              <div className="mt-3 rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/55 p-3">
                <p className="text-sm font-semibold mb-2">Per-match averages</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 text-sm">
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Avg K / D / A</p><p className="mt-1 font-mono text-base">{avgKills.toFixed(2)} / {avgDeaths.toFixed(2)} / {avgAssists.toFixed(2)}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Avg souls / match</p><p className="mt-1 font-mono text-base">{avgSouls.toFixed(0)}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">KDA ratio</p><p className="mt-1 font-mono text-base">{fmt1(kda)}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Win rate</p><p className="mt-1 font-mono text-base">{winRate.toFixed(1)}%</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Souls/min</p><p className="mt-1 font-mono text-base">{fmt1(overallSpm)}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Damage/min</p><p className="mt-1 font-mono text-base">{fmt1(overallDpm)}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Accuracy</p><p className="mt-1 font-mono text-base">{overallAccuracy != null ? fmtPct(overallAccuracy) : "-"}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Kill participation</p><p className="mt-1 font-mono text-base">{overallKillParticipation != null ? fmtPct(overallKillParticipation) : "-"}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Pace</p><p className="mt-1 font-mono text-base">LH/m {fmt1(avgLhPerMin)}</p></div>
                  <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 p-3"><p className="text-[11px] uppercase opacity-70">Peaks</p><p className="mt-1 font-mono text-base">Souls {maxPeakSouls}</p><p className="font-mono text-xs opacity-80">Damage {maxPeakDamage}</p></div>
                </div>
              </div>
            </section>

            <PlayerGraphs snapshots={careerSnapshots} bars={barStats} xLabels={careerPointLabels} />

            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4 md:p-5">
              <h2 className="text-lg font-semibold mb-3">Hero performance</h2>
              {topHeroes.length ? (
                <div className="overflow-x-auto rounded border border-zinc-300/50 dark:border-zinc-700/90">
                  <table className="w-full text-sm">
                    <thead className="bg-transparent dark:bg-zinc-950/70">
                      <tr>
                        <th className="px-3 py-2 text-left">Hero</th>
                        <th className="px-3 py-2 text-right">Picks</th>
                        <th className="px-3 py-2 text-right">Record</th>
                        <th className="px-3 py-2 text-right">Win %</th>
                        <th className="px-3 py-2 text-right">KDA</th>
                        <th className="px-3 py-2 text-right">Avg souls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topHeroes.map((entry) => (
                        <tr key={entry.heroId} className="border-t border-zinc-300/50 odd:bg-transparent dark:border-zinc-700/90 dark:odd:bg-zinc-950/30">
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-2">
                              {playerHeroThumbPath(entry.heroId) ? (
                                <HeroIcon
                                  src={playerHeroThumbPath(entry.heroId)}
                                  alt={heroName(entry.heroId)}
                                  width={20}
                                  height={20}
                                  className="h-5 w-5 rounded object-cover border border-zinc-700"
                                />
                              ) : null}
                              <span>{heroName(entry.heroId)}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{entry.picks}</td>
                          <td className="px-3 py-2 text-right font-mono">{entry.wins}-{entry.losses}</td>
                          <td className="px-3 py-2 text-right font-mono">{entry.heroWinRate.toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt1(entry.heroKda)}</td>
                          <td className="px-3 py-2 text-right font-mono">{entry.heroAvgSouls.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm opacity-70">No hero data yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4 md:p-5">
              <h2 className="text-lg font-semibold mb-2">Match history</h2>
              <p className="mb-2 text-sm text-zinc-400">Detailed compiled performance across all saved matches for this player.</p>
              <div className="overflow-x-auto rounded border border-zinc-300/50 dark:border-zinc-700/90">
                <table className="w-full text-sm">
                  <thead className="bg-transparent dark:bg-zinc-950/70">
                    <tr>
                      <th className="px-3 py-2 text-left">Match</th>
                      <th className="px-3 py-2 text-left">Result</th>
                      <th className="px-3 py-2 text-left">Hero</th>
                      <th className="px-3 py-2 text-right">K / D / A</th>
                      <th className="px-3 py-2 text-right">Souls</th>
                      <th className="px-3 py-2 text-right">S/min</th>
                      <th className="px-3 py-2 text-right">Damage</th>
                      <th className="px-3 py-2 text-right">D/min</th>
                      <th className="px-3 py-2 text-right">Accuracy</th>
                      <th className="px-3 py-2 text-right">KP</th>
                      <th className="px-3 py-2 text-left">Duration</th>
                      <th className="px-3 py-2 text-left">Side</th>
                      <th className="px-3 py-2 text-left">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithResult.map((row) => (
                      <tr key={row.matchId} className="border-t border-zinc-300/50 odd:bg-transparent hover:bg-zinc-900/35 dark:border-zinc-700/90 dark:odd:bg-zinc-950/30">
                        <td className="p-0 font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{row.matchId}</a></td>
                        <td className="p-0">
                          <a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>
                            <span
                              className={
                                row.result === "Win"
                                  ? "text-emerald-300"
                                  : row.result === "Loss"
                                    ? "text-rose-300"
                                    : "text-zinc-400"
                              }
                            >
                              {row.result}
                            </span>
                          </a>
                        </td>
                        <td className="p-0">
                          <a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>
                            <span className="inline-flex items-center gap-2">
                              {row.heroId && playerHeroThumbPath(row.heroId) ? (
                                <HeroIcon
                                  src={playerHeroThumbPath(row.heroId)}
                                  alt={heroName(row.heroId)}
                                  width={20}
                                  height={20}
                                  className="h-5 w-5 rounded object-cover border border-zinc-700"
                                />
                              ) : null}
                              <span>{heroName(row.heroId)}</span>
                            </span>
                          </a>
                        </td>
                        <td className="p-0 text-right font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{safeNum(row.kills)} / {safeNum(row.deaths)} / {safeNum(row.assists)}</a></td>
                        <td className="p-0 text-right font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{safeNum(row.netWorth)}</a></td>
                        <td className="p-0 text-right font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{fmt1(row.spm)}</a></td>
                        <td className="p-0 text-right font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{safeNum(row.damageTotal)}</a></td>
                        <td className="p-0 text-right font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{row.dpm != null ? fmt1(row.dpm) : "-"}</a></td>
                        <td className="p-0 text-right font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{row.accuracy != null ? fmtPct(row.accuracy) : "-"}</a></td>
                        <td className="p-0 text-right font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{row.killParticipation != null ? fmtPct(row.killParticipation) : "-"}</a></td>
                        <td className="p-0 font-mono"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{row.durationText}</a></td>
                        <td className="p-0"><a className="block px-3 py-2" href={`/match/${row.matchId}/player/${steamId}`}>{row.side != null ? TEAM_NAMES[row.side] ?? row.side : "Unknown"}</a></td>
                        <td className="p-0">
                          <a className="block px-3 py-2 text-emerald-300 hover:text-emerald-200 hover:underline" href={`/match/${row.matchId}/player/${steamId}`}>
                            View →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-4 h-fit">
            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4">
              <h3 className="text-sm font-semibold mb-2">Quick insights</h3>
              <div className="space-y-2 text-sm">
                <p>Matches: <span className="font-mono">{matchesPlayed}</span></p>
                <p>Total duration: <span className="font-mono">{fmtTime(totalDurationS)}</span></p>
                <p>Total team kills (same side): <span className="font-mono">{totalTeamKills}</span></p>
                <p>Kill participation: <span className="font-mono">{overallKillParticipation != null ? fmtPct(overallKillParticipation) : "-"}</span></p>
                <p>Graph points: <span className="font-mono">{careerSnapshots.length}</span></p>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4">
              <h3 className="text-sm font-semibold mb-2">Economy source split</h3>
              <div className="space-y-2 text-sm">
                <p>Player gold: <span className="font-mono">{totalPlayerGold}</span></p>
                <p>Lane gold: <span className="font-mono">{totalLaneGold}</span></p>
                <p>Neutral gold: <span className="font-mono">{totalNeutralGold}</span></p>
                <p>Boss gold: <span className="font-mono">{totalBossGold}</span></p>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4">
              <h3 className="text-sm font-semibold mb-2">Power-up buffs</h3>
              <div className="grid gap-2 sm:grid-cols-3 text-xs mb-3">
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 px-2 py-1">
                  <p className="uppercase opacity-70">Total</p>
                  <p className="font-mono text-sm">{totalPowerUpBuffs}</p>
                </div>
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 px-2 py-1">
                  <p className="uppercase opacity-70">Permanent</p>
                  <p className="font-mono text-sm">{totalPermanentBuffs} <span className="opacity-70">(v {totalPermanentBuffValue})</span></p>
                </div>
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/65 px-2 py-1">
                  <p className="uppercase opacity-70">Temporary</p>
                  <p className="font-mono text-sm">{totalTemporaryBuffs} <span className="opacity-70">(v {totalTemporaryBuffValue})</span></p>
                </div>
              </div>

              {groupedBuffRows.length ? (
                <div className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/60 overflow-hidden">
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
                      {groupedBuffRows.map((buff) => (
                        <tr key={buff.type} className="border-t border-zinc-300/50 odd:bg-transparent dark:border-zinc-700/90 dark:odd:bg-zinc-950/30">
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

            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4">
              <h3 className="text-sm font-semibold mb-2">Combat utility</h3>
              <div className="space-y-2 text-sm">
                <p>Avg max health: <span className="font-mono">{avgMaxHealth != null ? avgMaxHealth.toFixed(0) : "-"}</span></p>
                <p>Avg weapon power: <span className="font-mono">{avgWeaponPower != null ? avgWeaponPower.toFixed(0) : "-"}</span></p>
                <p>Avg tech power: <span className="font-mono">{avgTechPower != null ? avgTechPower.toFixed(0) : "-"}</span></p>
                <p>Avg self healing: <span className="font-mono">{avgSelfHealing != null ? avgSelfHealing.toFixed(0) : "-"}</span></p>
                <p>Avg damage absorbed: <span className="font-mono">{avgDamageAbsorbed != null ? avgDamageAbsorbed.toFixed(0) : "-"}</span></p>
              </div>
            </section>

            <MapHeatmap
              title="Map heatmap"
              description="Kill and death density across all tracked matches for this player. Hover a dot to see who killed whom and when."
              kills={overallHeatmap.kills}
              deaths={overallHeatmap.deaths}
            />

            <section className="rounded-xl border border-zinc-300/50 bg-transparent backdrop-blur-[1px] dark:border-zinc-700/90 dark:bg-zinc-950/70 p-4">
              <h3 className="text-sm font-semibold mb-2">Item picks</h3>
              <p className="mb-2 text-xs text-zinc-400">Weighted item usage across all matches for this player.</p>
              {topPlayerItems.length ? (
                <div className="space-y-3">
                  {[{ title: "Core items", rows: corePlayerItems }, { title: "Situational items", rows: situationalPlayerItems }].map((group) => (
                    <section key={group.title} className="rounded border border-zinc-300/50 bg-transparent dark:border-zinc-700/90 dark:bg-zinc-950/55 p-2.5">
                      <h4 className="text-xs font-semibold mb-2">{group.title}</h4>
                      {group.rows.length ? (
                        <div className="overflow-x-auto rounded border border-zinc-300/50 dark:border-zinc-700/90">
                          <table className="w-full text-xs">
                            <thead className="bg-transparent dark:bg-zinc-950/70">
                              <tr>
                                <th className="px-2 py-1 text-left">Item</th>
                                <th className="px-2 py-1 text-right">Buys</th>
                                <th className="px-2 py-1 text-right">Wt%</th>
                                <th className="px-2 py-1 text-right">Pick%</th>
                                <th className="px-2 py-1 text-right">WR</th>
                                <th className="px-2 py-1 text-right">Avg</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((entry) => (
                                <tr key={`${group.title}-${entry.itemId}`} className="border-t border-zinc-300/50 odd:bg-transparent dark:border-zinc-700/90 dark:odd:bg-zinc-950/30">
                                  <td className="px-2 py-1">
                                    <span className="inline-flex items-center gap-1.5">
                                      {itemIconPath(entry.itemId) ? (
                                        <HeroIcon
                                          src={itemIconPath(entry.itemId)}
                                          alt={itemName(entry.itemId)}
                                          width={14}
                                          height={14}
                                          className="h-3.5 w-3.5 rounded object-contain border border-zinc-700"
                                        />
                                      ) : null}
                                      <span>{itemName(entry.itemId)}</span>
                                    </span>
                                  </td>
                                  <td className="px-2 py-1 text-right font-mono">{entry.buys}</td>
                                  <td className="px-2 py-1 text-right font-mono">{entry.weightPct.toFixed(1)}</td>
                                  <td className="px-2 py-1 text-right font-mono">{entry.pickRate.toFixed(1)}</td>
                                  <td className="px-2 py-1 text-right font-mono">{entry.winRateWhenPicked.toFixed(1)}</td>
                                  <td className="px-2 py-1 text-right font-mono">{fmtTime(entry.avgBuyTimeS)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs opacity-70">No items in this group.</p>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <p className="text-sm opacity-70">No item data yet.</p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
