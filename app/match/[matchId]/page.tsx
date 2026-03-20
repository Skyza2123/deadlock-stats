// app/match/[matchId]/page.tsx
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../../db";
import { matches, matchPlayers, players, matchPlayerItems } from "../../../db/schema";
import { eq, sql } from "drizzle-orm";
import { heroName, itemName, fmtTime, hasItem } from "../../../lib/deadlockData";
import { getAbilityMeta } from "../../../lib/abilityCatalog";
import { heroSmallIconPath, heroBackgroundPath } from "../../../lib/heroIcons";
import { itemIconPath } from "../../../lib/itemIcons";
import BackButton from "../../../components/BackButton";
import HeroIcon from "../../../components/HeroIcon";
import MatchTabsNav from "../../../components/MatchTabsNav";
import TeamWordmark from "../../../components/TeamWordmark";

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

const DEMO_MATCH_ID = "68623064";

type PlayerRow = {
  steamId: string;
  displayName: string | null;
  side: string | null; // "0" | "1"
  heroId: string | null;
  rawJson: unknown;

  kills: number | null;
  deaths: number | null;
  assists: number | null;

  netWorth: number | null; // souls
  lastHits: number | null;
  denies: number | null;
  level: number | null;
};

type ItemRow = {
  steamId: string;
  gameTimeS: number;
  itemId: number;
  soldTimeS: number | null;
  upgradeId: number | null;
  imbuedAbilityId: number | null;
};

type AbilitySummaryRow = {
  key: string;
  name: string;
  iconSrc: string | null;
  level: number;
  unlocks: number;
  upgrades: number;
  imbues: number;
};

function clampAbilityLevel(level: number) {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(3, Math.floor(level)));
}

type DraftEventView = {
  heroId: string;
  side: string | null;
  order: number;
  type: "pick" | "ban";
};

function teamLabel(side: string | null) {
  if (side == null) return "-";
  return TEAM_NAMES[side] ?? side;
}

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function kda(k: number, d: number, a: number) {
  const denom = Math.max(1, d);
  return (k + a) / denom;
}

function fmt1(n: number) {
  return Number.isFinite(n) ? n.toFixed(1) : "-";
}

function winnerText(raw: any) {
  const side = raw?.match_info?.winning_team;
  if (side == null) return "Winner: Unknown";
  const key = String(side);
  return `Winner: ${TEAM_NAMES[key] ?? key}`;
}

function extractBanCount(raw: any) {
  const separateCount = Number(raw?.separateBans?.count ?? 0);
  if (Number.isFinite(separateCount) && separateCount > 0) {
    return separateCount;
  }

  const matchInfoBans = Array.isArray(raw?.match_info?.bans) ? raw.match_info.bans.length : 0;
  if (matchInfoBans > 0) return matchInfoBans;

  const fallback = [
    raw?.match_info?.hero_bans,
    raw?.hero_bans,
    raw?.bans,
    raw?.pick_bans,
    raw?.draft?.bans,
  ];

  for (const candidate of fallback) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate.length;
  }

  return 0;
}

function extractDraftEvents(raw: any): DraftEventView[] {
  const source = Array.isArray(raw?.separateDraft?.rows)
    ? raw.separateDraft.rows
    : Array.isArray(raw?.draft?.events)
      ? raw.draft.events
      : Array.isArray(raw?.timeline)
        ? raw.timeline
        : [];

  const events: DraftEventView[] = source
    .map((entry: any, index: number) => {
      const typeRaw = String(entry?.type ?? entry?.event_type ?? "").toLowerCase();
      const type = typeRaw === "pick" || typeRaw === "ban" ? (typeRaw as "pick" | "ban") : null;
      if (!type) return null;

      const heroIdRaw = entry?.heroId ?? entry?.hero_id ?? entry?.character_id ?? null;
      if (heroIdRaw == null) return null;

      const orderRaw = Number(entry?.order ?? entry?.id ?? index + 1);
      return {
        heroId: String(heroIdRaw),
        side: normalizeDraftSide(entry?.side ?? entry?.team ?? entry?.team_id ?? entry?.teamId ?? null),
        order: Number.isFinite(orderRaw) ? orderRaw : index + 1,
        type,
      } satisfies DraftEventView;
    })
    .filter((event: DraftEventView | null): event is DraftEventView => Boolean(event));

  return events.sort((a, b) => a.order - b.order);
}

function normalizeDraftSide(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "0" || raw === "team1" || raw === "t1" || raw === "hidden king") return "0";
  if (raw === "1" || raw === "team2" || raw === "t2" || raw === "archmother") return "1";
  return String(value);
}

function draftSideLabel(side: string | null) {
  const normalized = normalizeDraftSide(side);
  if (!normalized) return "Unknown";
  if (normalized === "0") return TEAM_NAMES["0"];
  if (normalized === "1") return TEAM_NAMES["1"];
  return normalized;
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
  if (rawKind.includes("unlock") || rawKind.includes("learn") || rawKind.includes("acquire") || rawKind.includes("first")) {
    return "unlock";
  }
  return "upgrade";
}

function buildAbilitySummaryForPlayer(playerRaw: any, items: ItemRow[]): AbilitySummaryRow[] {
  const summary = new Map<string, AbilitySummaryRow>();
  const seenAbilityKeys = new Set<string>();

  const touch = (
    abilityId: number | null,
    directName: string | null,
    directIcon: string | null,
    kind: "unlock" | "upgrade" | "imbue",
    levelHint: number | null,
  ) => {
    if (abilityId != null && abilityId <= 0) return;

    const meta = abilityId != null ? getAbilityMeta(abilityId) : null;
    const name = meta?.name ?? directName ?? (abilityId != null ? `Ability ${abilityId}` : "Unknown ability");
    if (name === "Ability 0") return;
    const iconSrc = meta?.iconSrc ?? directIcon ?? null;
    const key = abilityId != null ? `id:${abilityId}` : `name:${name.toLowerCase()}`;

    const row = summary.get(key) ?? {
      key,
      name,
      iconSrc,
      level: 0,
      unlocks: 0,
      upgrades: 0,
      imbues: 0,
    };

    if (!row.iconSrc && iconSrc) row.iconSrc = iconSrc;

    if (kind === "unlock") {
      row.unlocks += 1;
      row.level = clampAbilityLevel(Math.max(row.level, 1));
    } else if (kind === "upgrade") {
      row.upgrades += 1;
      row.level = clampAbilityLevel(Math.max(row.level, levelHint ?? row.unlocks + row.upgrades));
    } else {
      row.imbues += 1;
    }

    summary.set(key, row);
  };

  const abilityArrays: any[][] = [
    playerRaw?.ability_events,
    playerRaw?.abilityEvents,
    playerRaw?.ability_casts,
    playerRaw?.abilityCasts,
    playerRaw?.cast_events,
    playerRaw?.casts,
    playerRaw?.abilities,
  ].filter(Array.isArray);

  for (const array of abilityArrays) {
    for (const event of array) {
      const detectedKind = detectAbilityEventKind(event);
      const baseAbilityId = firstNumeric(event, ["ability_id", "abilityId", "caster_ability_id", "killer_ability_id"]);
      const imbuedAbilityId = firstNumeric(event, ["imbued_ability_id", "imbuedAbilityId"]);
      const abilityId = detectedKind === "imbue" ? (imbuedAbilityId ?? baseAbilityId) : baseAbilityId;
      const name = firstText(event, ["ability_name", "abilityName", "killer_ability_name", "cast_name", "name"]);
      const icon = firstText(event, ["ability_icon", "abilityIcon", "image", "image_webp", "icon"]);
      const levelHint = firstNumeric(event, ["upgrade_id", "upgradeId", "ability_level", "abilityLevel", "new_level", "level"]);

      if (abilityId != null && Number(abilityId) <= 0) continue;
      if (abilityId == null && !name) continue;

      const abilityKey =
        abilityId != null
          ? `id:${Number(abilityId)}`
          : name
            ? `name:${name.toLowerCase()}`
            : null;

      const kind =
        detectedKind === "imbue"
          ? "imbue"
          : abilityKey && seenAbilityKeys.has(abilityKey)
            ? "upgrade"
            : "unlock";

      if (abilityKey) seenAbilityKeys.add(abilityKey);

      touch(abilityId != null ? Number(abilityId) : null, name, icon, kind, levelHint != null ? Number(levelHint) : null);
    }
  }

  for (const item of items) {
    const itemId = Number(item.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    if (!hasItem(itemId)) {
      const meta = getAbilityMeta(itemId);
      if (meta) {
        const abilityKey = `id:${itemId}`;
        const kind: "unlock" | "upgrade" = seenAbilityKeys.has(abilityKey) ? "upgrade" : "unlock";
        seenAbilityKeys.add(abilityKey);
        touch(itemId, meta.name, meta.iconSrc, kind, item.upgradeId != null ? Number(item.upgradeId) : null);
      }
    }

    if (item.imbuedAbilityId != null && Number.isFinite(Number(item.imbuedAbilityId))) {
      const imbuedId = Number(item.imbuedAbilityId);
      if (imbuedId > 0) {
        touch(imbuedId, null, null, "imbue", null);
      }
    }
  }

  return [...summary.values()].sort((a, b) => {
    if (clampAbilityLevel(b.level) !== clampAbilityLevel(a.level)) return clampAbilityLevel(b.level) - clampAbilityLevel(a.level);
    const aEvents = a.unlocks + a.upgrades + a.imbues;
    const bEvents = b.unlocks + b.upgrades + b.imbues;
    if (bEvents !== aEvents) return bEvents - aEvents;
    return a.name.localeCompare(b.name);
  });
}

function extractRawParticipants(raw: any): any[] {
  const candidates = [
    raw?.players,
    raw?.match_info?.players,
    raw?.match_info?.participants,
    raw?.participants,
    raw?.game_mode?.players,
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

function fmtMetric(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatUtcScrimDate(value: Date | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(value);
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

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams?: Promise<{ selectedSteamId?: string }>;
}) {
  const { matchId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedSteamId = resolvedSearchParams?.selectedSteamId ?? undefined;

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

  let usingStaticDemo = false;

  if (matchRow.length === 0 && matchId === DEMO_MATCH_ID) {
    const demoRawJson = await loadStaticDemoMatchData();
    if (demoRawJson) {
      matchRow = [{ matchId, rawJson: demoRawJson, scrimDate: null as Date | null }];
      usingStaticDemo = true;
    }
  }

  if (matchRow.length === 0) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4">
        <BackButton />
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5 shadow-sm">
          <h1 className="text-3xl font-bold">Match {matchId}</h1>
          <p className="mt-2 text-zinc-300">Not found in DB. Re-ingest from the homepage.</p>
        </section>
      </main>
    );
  }

  const staticRaw: any = matchRow[0].rawJson;
  const staticParticipants = usingStaticDemo && Array.isArray(staticRaw?.match_info?.players)
    ? staticRaw.match_info.players
    : [];
  const staticNameBySteam = usingStaticDemo
    ? await fetchSteamPersonaNames(staticParticipants.map((p: any) => String(p?.account_id ?? "")))
    : new Map<string, string>();

  const rows: PlayerRow[] = usingStaticDemo
    ? staticParticipants
        .map((p: any) => ({
          steamId: String(p?.account_id ?? "").trim(),
          displayName:
            (String(p?.name ?? p?.display_name ?? "").trim() ||
              staticNameBySteam.get(String(p?.account_id ?? "").trim()) ||
              null) as string | null,
          side: p?.team != null ? String(p.team) : null,
          heroId: p?.hero_id != null ? String(p.hero_id) : null,
          rawJson: p,
          kills: Number.isFinite(Number(p?.kills)) ? Number(p.kills) : null,
          deaths: Number.isFinite(Number(p?.deaths)) ? Number(p.deaths) : null,
          assists: Number.isFinite(Number(p?.assists)) ? Number(p.assists) : null,
          netWorth: Number.isFinite(Number(p?.net_worth)) ? Number(p.net_worth) : null,
          lastHits: Number.isFinite(Number(p?.last_hits)) ? Number(p.last_hits) : null,
          denies: Number.isFinite(Number(p?.denies)) ? Number(p.denies) : null,
          level: Number.isFinite(Number(p?.level)) ? Number(p.level) : null,
        }))
        .filter((player: PlayerRow) => player.steamId.length > 0)
    : await db
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

  const itemRows: ItemRow[] = usingStaticDemo
    ? staticParticipants.flatMap((p: any) => {
        const steamId = String(p?.account_id ?? "").trim();
        const items = Array.isArray(p?.items) ? p.items : [];

        return items
          .map((it: any) => {
            const gameTimeS = Number(it?.game_time_s);
            const itemId = Number(it?.item_id);
            if (!steamId || !Number.isFinite(gameTimeS) || !Number.isFinite(itemId)) return null;

            return {
              steamId,
              gameTimeS,
              itemId,
              soldTimeS: Number.isFinite(Number(it?.sold_time_s)) ? Number(it.sold_time_s) : null,
              upgradeId: Number.isFinite(Number(it?.upgrade_id)) ? Number(it.upgrade_id) : null,
              imbuedAbilityId: Number.isFinite(Number(it?.imbued_ability_id)) ? Number(it.imbued_ability_id) : null,
            } as ItemRow;
          })
          .filter((it: ItemRow | null): it is ItemRow => it != null);
      })
    : await db
        .select({
          steamId: matchPlayerItems.steamId,
          gameTimeS: matchPlayerItems.gameTimeS,
          itemId: matchPlayerItems.itemId,
          soldTimeS: matchPlayerItems.soldTimeS,
          upgradeId: matchPlayerItems.upgradeId,
          imbuedAbilityId: matchPlayerItems.imbuedAbilityId,
        })
        .from(matchPlayerItems)
        .where(eq(matchPlayerItems.matchId, matchId));

  // group items by player
  const itemsByPlayer = new Map<string, ItemRow[]>();
  for (const it of itemRows) {
    const list = itemsByPlayer.get(it.steamId) ?? [];
    list.push(it);
    itemsByPlayer.set(it.steamId, list);
  }

  // sort items by purchase time
  for (const [steamId, list] of itemsByPlayer.entries()) {
    list.sort((a, b) => a.gameTimeS - b.gameTimeS);
    itemsByPlayer.set(steamId, list);
  }

  // final build = not sold
  function finalBuild(list: ItemRow[]) {
    return list.filter((x) => !x.soldTimeS || x.soldTimeS === 0);
  }

  // --- derive match duration for Souls/min ---
  // Try to get duration from raw JSON if present, else fallback to max item time
  const raw: any = matchRow[0].rawJson;
  const draftEvents = extractDraftEvents(raw);
  const unknownSideDraftEvents = draftEvents.filter((event) => !["0", "1"].includes(String(event.side ?? "")));
  const rawDuration = Number(
    raw?.match_info?.duration_s ??
      raw?.match_info?.duration ??
      raw?.duration_s ??
      NaN
  );
  const observedGameTimes: number[] = [];
  const pushObservedTime = (value: unknown) => {
    const n = numberFromCandidate(value);
    if (n != null && Number.isFinite(n) && n >= 0) observedGameTimes.push(n);
  };

  for (const itemRow of itemRows) {
    pushObservedTime(itemRow.gameTimeS);
    pushObservedTime(itemRow.soldTimeS);
  }

  const participantsForDuration = extractRawParticipants(raw);
  for (const participant of participantsForDuration) {
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
  const durationS =
    observedDuration != null && observedDuration > 0
      ? observedDuration
      : Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : 1;

  // --- split rows by team ---
  const bySide = new Map<string, PlayerRow[]>();
  for (const r of rows) {
    const s = r.side ?? "unknown";
    const list = bySide.get(s) ?? [];
    list.push(r);
    bySide.set(s, list);
  }

  // Sort players inside each team by Souls desc
  for (const [side, list] of bySide.entries()) {
    list.sort((a, b) => safeNum(b.netWorth) - safeNum(a.netWorth));
    bySide.set(side, list);
  }

  // Team order: 0 then 1 then unknown
  const teamOrder = ["0", "1", "unknown"].filter((k) => bySide.has(k));

  const selectedPlayer = selectedSteamId
    ? rows.find((row) => row.steamId === selectedSteamId) ?? null
    : null;
  const selectedHeroBg = heroBackgroundPath(selectedPlayer?.heroId ?? null);

  function teamTotals(teamRows: PlayerRow[]) {
    const t = {
      souls: 0,
      k: 0,
      d: 0,
      a: 0,
      lh: 0,
      dn: 0,
    };

    for (const r of teamRows) {
      t.souls += safeNum(r.netWorth);
      t.k += safeNum(r.kills);
      t.d += safeNum(r.deaths);
      t.a += safeNum(r.assists);
      t.lh += safeNum(r.lastHits);
      t.dn += safeNum(r.denies);
    }

    return t;
  }

  const teamRows0 = bySide.get("0") ?? [];
  const teamRows1 = bySide.get("1") ?? [];

  const kills0 = teamRows0.reduce((sum, row) => sum + safeNum(row.kills), 0);
  const kills1 = teamRows1.reduce((sum, row) => sum + safeNum(row.kills), 0);

  const participants = extractRawParticipants(raw);
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
      firstNumeric(rowRaw, [
        "hero_damage_dealt",
        "hero_damage",
        "player_damage",
        "player_damage_dealt",
      ]) ?? 0;

    rowHealingBySide[side] +=
      firstNumeric(rowRaw, [
        "healing_dealt",
        "healing_done",
        "player_healing",
        "healing",
      ]) ?? 0;
  }

  const teamDamage: Record<"0" | "1", number> = hasParticipantCombatData
    ? participantDamageBySide
    : rowDamageBySide;

  const teamHealing: Record<"0" | "1", number> = hasParticipantCombatData
    ? participantHealingBySide
    : rowHealingBySide;

  const score0 = extractTeamScore(raw, "0") ?? kills0;
  const score1 = extractTeamScore(raw, "1") ?? kills1;

  const winnerSide = normalizeDraftSide(raw?.match_info?.winning_team ?? raw?.winning_team ?? null);
  const winnerLabel = winnerSide === "0" || winnerSide === "1" ? TEAM_NAMES[winnerSide] : "Unknown";

  const damageLeadSide = teamDamage["0"] === teamDamage["1"]
    ? null
    : teamDamage["0"] > teamDamage["1"]
      ? "0"
      : "1";

  const healingLeadSide = teamHealing["0"] === teamHealing["1"]
    ? null
    : teamHealing["0"] > teamHealing["1"]
      ? "0"
      : "1";

  const topSoulsPlayer = rows.length
    ? [...rows].sort((a, b) => safeNum(b.netWorth) - safeNum(a.netWorth))[0]
    : null;

  const topKdaPlayer = rows.length
    ? [...rows].sort(
        (a, b) =>
          kda(safeNum(b.kills), safeNum(b.deaths), safeNum(b.assists)) -
          kda(safeNum(a.kills), safeNum(a.deaths), safeNum(a.assists))
      )[0]
    : null;

  return (
    <main className="match-shell relative isolate w-full overflow-hidden p-4 sm:p-6 lg:p-8">
      {selectedHeroBg ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center opacity-30"
            style={{ backgroundImage: `url(${selectedHeroBg})` }}
          />
          <div className="pointer-events-none absolute inset-0 z-0 bg-zinc-950/65" />
        </>
      ) : null}

      <div className="relative z-10 space-y-5 sm:space-y-6">

      <div className="flex items-center justify-between gap-3">
        <BackButton />
      </div>

      {selectedPlayer ? (
        <section className="match-shell-panel relative overflow-hidden rounded-xl p-4">
          {selectedHeroBg ? (
            <div
              className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
              style={{ backgroundImage: `url(${selectedHeroBg})` }}
            />
          ) : null}
          <div className="relative z-10 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide opacity-70">Selected player</p>
              <p className="text-sm font-semibold">
                {selectedPlayer.displayName ?? "(unknown)"} • {heroName(selectedPlayer.heroId)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="match-shell-panel rounded-xl p-4 md:p-5">
        <h1 className="heading-luxe text-3xl font-bold tracking-tight">Match {matchId}</h1>
        <p className="text-sm text-zinc-400">
          Duration: {fmtTime(durationS)} • Players: {rows.length}
        </p>
      </div>

      <section className="relative z-10 -mt-1">
        <MatchTabsNav matchId={matchId} active="overview" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="match-shell-stat rounded-lg p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">Result</p>
          <p className="mt-1 text-sm font-medium">{winnerText(raw)}</p>
        </div>
        <div className="match-shell-stat rounded-lg p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">Duration</p>
          <p className="mt-1 text-sm font-medium">{fmtTime(durationS)}</p>
        </div>
        <div className="match-shell-stat rounded-lg p-3">
          <TeamWordmark side="0" className="h-5 w-36 max-w-full opacity-95" />
          <p className="mt-2 text-xs uppercase tracking-wide opacity-70">Souls</p>
          <p className="mt-1 text-sm font-medium">
            {(bySide.get("0") ?? []).reduce(
              (sum, r) => sum + safeNum(r.netWorth),
              0
            )}
          </p>
        </div>
        <div className="match-shell-stat rounded-lg p-3">
          <TeamWordmark side="1" className="h-5 w-36 max-w-full opacity-95" />
          <p className="mt-2 text-xs uppercase tracking-wide opacity-70">Souls</p>
          <p className="mt-1 text-sm font-medium">
            {(bySide.get("1") ?? []).reduce(
              (sum, r) => sum + safeNum(r.netWorth),
              0
            )}
          </p>
        </div>
        <div className="match-shell-stat rounded-lg p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">Scrim date</p>
          <p className="mt-1 text-sm font-medium">
            {formatUtcScrimDate(matchRow[0].scrimDate)}
          </p>
        </div>
      </section>

      <section className="match-shell-panel rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Draft order</h2>
          <p className="text-xs text-zinc-400">{draftEvents.length ? `${draftEvents.length} events` : "No draft uploaded"}</p>
        </div>

        {draftEvents.length ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {(["0", "1"] as const).map((sideKey) => {
                const sideEvents = draftEvents.filter((event) => normalizeDraftSide(event.side) === sideKey);
                const picks = sideEvents.filter((event) => event.type === "pick");
                const bans = sideEvents.filter((event) => event.type === "ban");

                return (
                    <div key={`draft-side-${sideKey}`} className="match-shell-stat rounded-lg p-3">
                    <h3 className="text-sm font-medium text-center">{draftSideLabel(sideKey)}</h3>

                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="mb-2 text-center text-xs uppercase tracking-wide text-zinc-400">Picks</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {picks.length ? picks.map((event) => {
                            const icon = heroSmallIconPath(event.heroId);
                            return (
                              <div key={`pick-${sideKey}-${event.order}-${event.heroId}`} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 w-24" title={`${event.order}. PICK • ${heroName(event.heroId)}`}>
                                <p className="text-[10px] opacity-80 text-center">#{event.order}</p>
                                <div className="mt-1 flex items-center justify-center">
                                  {icon ? (
                                    <HeroIcon src={icon} alt={heroName(event.heroId)} width={44} height={44} className="h-11 w-11 rounded object-cover" />
                                  ) : (
                                    <div className="h-11 w-11 rounded bg-zinc-800" />
                                  )}
                                </div>
                              </div>
                            );
                          }) : <p className="text-xs text-zinc-500">No picks</p>}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-center text-xs uppercase tracking-wide text-zinc-400">Bans</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {bans.length ? bans.map((event) => {
                            const icon = heroSmallIconPath(event.heroId);
                            return (
                              <div key={`ban-${sideKey}-${event.order}-${event.heroId}`} className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 w-24" title={`${event.order}. BAN • ${heroName(event.heroId)}`}>
                                <p className="text-[10px] opacity-80 text-center">#{event.order}</p>
                                <div className="mt-1 flex items-center justify-center">
                                  {icon ? (
                                    <HeroIcon src={icon} alt={heroName(event.heroId)} width={44} height={44} className="h-11 w-11 rounded object-cover" />
                                  ) : (
                                    <div className="h-11 w-11 rounded bg-zinc-800" />
                                  )}
                                </div>
                              </div>
                            );
                          }) : <p className="text-xs text-zinc-500">No bans</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {unknownSideDraftEvents.length ? (
              <div className="match-shell-stat rounded-lg p-3">
                <h3 className="text-sm font-medium text-center">Unknown side</h3>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {unknownSideDraftEvents.map((event) => {
                    const icon = heroSmallIconPath(event.heroId);
                    const typeClasses = event.type === "ban" ? "border-rose-500/40 bg-rose-500/10" : "border-emerald-500/40 bg-emerald-500/10";
                    return (
                      <div key={`unknown-${event.order}-${event.type}-${event.heroId}`} className={`rounded-lg border ${typeClasses} p-2 w-24`} title={`${event.order}. ${event.type.toUpperCase()} • ${heroName(event.heroId)}`}>
                        <p className="text-[10px] opacity-80 text-center">#{event.order}</p>
                        <div className="mt-1 flex items-center justify-center">
                          {icon ? (
                            <HeroIcon src={icon} alt={heroName(event.heroId)} width={44} height={44} className="h-11 w-11 rounded object-cover" />
                          ) : (
                            <div className="h-11 w-11 rounded bg-zinc-800" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No draft data is available for this match yet.</p>
        )}
      </section>

      <div className="space-y-6">
        {teamOrder.map((sideKey) => {
          const teamRows = bySide.get(sideKey) ?? [];
          const totals = teamTotals(teamRows);
          const soulsPerMin = totals.souls / (durationS / 60);
          const topSouls = [...teamRows].sort(
            (a, b) => safeNum(b.netWorth) - safeNum(a.netWorth)
          )[0];
          const topKda = [...teamRows].sort(
            (a, b) =>
              kda(
                safeNum(b.kills),
                safeNum(b.deaths),
                safeNum(b.assists)
              ) -
              kda(
                safeNum(a.kills),
                safeNum(a.deaths),
                safeNum(a.assists)
              )
          )[0];
          const topSpm = [...teamRows].sort(
            (a, b) =>
              safeNum(b.netWorth) / (durationS / 60) -
              safeNum(a.netWorth) / (durationS / 60)
          )[0];

          return (
            <section
              key={`team-${sideKey}`}
              className={`match-shell-team rounded-xl px-4 pt-5 pb-5 ${
                sideKey === "0"
                  ? "match-shell-team-amber"
                  : sideKey === "1"
                    ? "match-shell-team-sapphire"
                    : ""
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-lg font-semibold leading-tight">
                      {teamLabel(sideKey === "unknown" ? null : sideKey)}
                      <span className="ml-2 text-sm font-normal text-zinc-400">
                        ({teamRows.length} players)
                      </span>
                    </h2>
                    <TeamWordmark
                      side={sideKey === "unknown" ? null : sideKey}
                      className="mt-2 h-8 w-[18rem] max-w-full opacity-95"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {topSouls ? (
                    <span className="match-shell-pill rounded px-2 py-1 inline-flex items-center gap-1">
                      <span className="inline-block w-14">Top souls:</span>
                      {heroSmallIconPath(topSouls.heroId) ? (
                        <HeroIcon
                          src={heroSmallIconPath(topSouls.heroId)}
                          alt={heroName(topSouls.heroId)}
                          width={30}
                          height={30}
                          className="h-7.5 w-7.5 rounded object-cover"
                        />
                      ) : (
                        <span>-</span>
                      )}
                    </span>
                  ) : null}
                  {topKda ? (
                    <span className="match-shell-pill rounded px-2 py-1 inline-flex items-center gap-1">
                      <span className="inline-block w-14">Top KDA:</span>
                      {heroSmallIconPath(topKda.heroId) ? (
                        <HeroIcon
                          src={heroSmallIconPath(topKda.heroId)}
                          alt={heroName(topKda.heroId)}
                          width={30}
                          height={30}
                          className="h-7.5 w-7.5 rounded object-cover"
                        />
                      ) : (
                        <span>-</span>
                      )}
                    </span>
                  ) : null}
                  {topSpm ? (
                    <span className="match-shell-pill rounded px-2 py-1 inline-flex items-center gap-1">
                      <span className="inline-block w-14">Top S/min:</span>
                      {heroSmallIconPath(topSpm.heroId) ? (
                        <HeroIcon
                          src={heroSmallIconPath(topSpm.heroId)}
                          alt={heroName(topSpm.heroId)}
                          width={30}
                          height={30}
                          className="h-7.5 w-7.5 rounded object-cover"
                        />
                      ) : (
                        <span>-</span>
                      )}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="match-shell-table overflow-x-auto rounded-lg">
                {/* ✅ FIX: lock layout + explicit column widths */}
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    {[
                      "w-60",
                      "w-18",
                      "w-24",
                      "w-22",
                      "w-16",
                      "w-16",
                      "w-16",
                      "w-14",
                      "w-14",
                      "w-14",
                      "w-18",
                      "w-95",
                      "w-80",
                    ].map((widthClass, index) => (
                      <col key={`col-${index}`} className={widthClass} />
                    ))}
                  </colgroup>

                  <thead className="bg-zinc-900/95">
                    <tr>
                      <th className="p-3 text-left sticky top-0 bg-zinc-900/95 z-10">
                        Player
                      </th>
                      <th className="p-3 text-left sticky top-0 bg-zinc-900/95 z-10">
                        Hero
                      </th>

                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        Souls
                      </th>
                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        S/min
                      </th>
                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        Lvl
                      </th>
                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        LH
                      </th>
                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        Dn
                      </th>

                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        K
                      </th>
                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        D
                      </th>
                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        A
                      </th>
                      <th className="p-3 text-right sticky top-0 bg-zinc-900/95 z-10">
                        KDA
                      </th>

                      <th className="p-3 text-left sticky top-0 bg-zinc-900/95 z-10">
                        Final items
                      </th>
                      <th className="p-3 text-left sticky top-0 bg-zinc-900/95 z-10">
                        Abilities
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr className="bg-zinc-950/40 border-t border-zinc-900">
                      <td className="p-3 text-zinc-300" colSpan={2}>
                        Team totals
                      </td>

                      <td className="p-3 text-right font-semibold">
                        {totals.souls}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {fmt1(soulsPerMin)}
                      </td>
                      <td className="p-3 text-right">-</td>
                      <td className="p-3 text-right">{totals.lh}</td>
                      <td className="p-3 text-right">{totals.dn}</td>

                      <td className="p-3 text-right">{totals.k}</td>
                      <td className="p-3 text-right">{totals.d}</td>
                      <td className="p-3 text-right">{totals.a}</td>
                      <td className="p-3 text-right font-semibold">
                        {fmt1(kda(totals.k, totals.d, totals.a))}
                      </td>

                      <td className="p-3" colSpan={2} />
                    </tr>

                    {teamRows.map((r) => {
                      const list = itemsByPlayer.get(r.steamId) ?? [];
                      const final = finalBuild(list).filter((it) =>
                        hasItem(Number(it.itemId))
                      );
                      const abilitySummary = buildAbilitySummaryForPlayer(r.rawJson as any, list);
                      const heroIconPath = heroSmallIconPath(r.heroId);

                      const souls = safeNum(r.netWorth);
                      const spm = souls / (durationS / 60);

                      const K = safeNum(r.kills);
                      const D = safeNum(r.deaths);
                      const A = safeNum(r.assists);
                      const playerHref = `/match/${matchId}/player/${r.steamId}`;
                      const isSelected = r.steamId === selectedSteamId;

                      return (
                        <tr
                          key={`${sideKey}-${r.steamId}`}
                          className={`border-t border-zinc-900 align-top hover:bg-zinc-900/35 ${
                            isSelected ? "bg-zinc-900/45" : ""
                          }`}
                        >
                          <td className="p-0 overflow-hidden">
                            <Link
                              href={playerHref}
                              className="block px-3 py-3"
                              title={r.displayName ?? "(unknown)"}
                            >
                              <span className="font-medium hover:underline block truncate">
                                {r.displayName ?? "(unknown)"}
                              </span>
                              <div className="font-mono text-xs opacity-60 truncate">
                                {r.steamId}
                              </div>
                            </Link>
                          </td>

                          <td className="p-0">
                            <Link href={playerHref} className="block px-3 py-3">
                              {heroIconPath ? (
                                <HeroIcon
                                  src={heroIconPath}
                                  alt={heroName(r.heroId)}
                                  width={44}
                                  height={44}
                                  className="h-11 w-11 rounded object-cover"
                                />
                              ) : (
                                <span>-</span>
                              )}
                            </Link>
                          </td>

                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.netWorth ?? "-"}</Link></td>
                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.netWorth != null ? fmt1(spm) : "-"}</Link></td>
                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.level ?? "-"}</Link></td>
                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.lastHits ?? "-"}</Link></td>
                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.denies ?? "-"}</Link></td>

                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.kills ?? "-"}</Link></td>
                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.deaths ?? "-"}</Link></td>
                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{r.assists ?? "-"}</Link></td>
                          <td className="p-0 text-right"><Link href={playerHref} className="block px-3 py-3">{fmt1(kda(K, D, A))}</Link></td>

                          {/* ✅ FIX: keep wide icon content contained */}
                          <td className="p-3 overflow-hidden">
                            {final.length ? (
                              <div className="flex flex-wrap gap-2 max-w-full overflow-hidden">
                                {final.map((it) => (
                                  <span
                                    key={`${it.gameTimeS}-${it.itemId}`}
                                    className="px-2 py-1 rounded bg-zinc-800 text-xs whitespace-nowrap inline-flex items-center gap-1"
                                    title={itemName(Number(it.itemId))}
                                  >
                                    {itemIconPath(Number(it.itemId)) ? (
                                      <HeroIcon
                                        src={itemIconPath(Number(it.itemId))}
                                        alt={itemName(Number(it.itemId))}
                                        width={32}
                                        height={32}
                                        className="h-8 w-8 rounded object-contain border border-zinc-700"
                                      />
                                    ) : (
                                      <span>-</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="opacity-60">-</span>
                            )}
                          </td>

                          {/* Ability progression summary */}
                          <td className="p-3 max-w-[320px] overflow-hidden">
                            {abilitySummary.length ? (
                              <div className="flex flex-wrap gap-2 max-w-full overflow-hidden">
                                {abilitySummary.map((ability) => (
                                  <span
                                    key={ability.key}
                                    className="px-2 py-1 rounded bg-zinc-900 text-xs whitespace-nowrap inline-flex items-center gap-1"
                                    title={`${ability.name} • Lvl ${Math.max(ability.level, ability.unlocks > 0 ? 1 : 0)} • U${ability.unlocks}/Up${ability.upgrades}/Im${ability.imbues}`}
                                  >
                                    {ability.iconSrc ? (
                                      <HeroIcon
                                        src={ability.iconSrc}
                                        alt={ability.name}
                                        width={32}
                                        height={32}
                                        className="h-8 w-8 rounded object-contain border border-zinc-700"
                                      />
                                    ) : null}
                                    <span>{ability.name}</span>
                                    <span className="font-mono opacity-80">L{clampAbilityLevel(Math.max(ability.level, ability.unlocks > 0 ? 1 : 0))}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="opacity-60">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
      </div>
    </main>
  );
}

async function fetchSteamPersonaNames(steamIds: string[]) {
  const apiKey = process.env.DEADLOCK_API_KEY;
  const uniqueIds = [...new Set(steamIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const names = new Map<string, string>();

  if (!apiKey || uniqueIds.length === 0) return names;

  await Promise.all(
    uniqueIds.map(async (accountId) => {
      try {
        const url =
          "https://api.deadlock-api.com/v1/players/steam-search?search_query=" +
          encodeURIComponent(accountId);

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: "no-store",
        });

        if (!res.ok) return;

        const arr = (await res.json()) as any[];
        if (!Array.isArray(arr) || arr.length === 0) return;

        const exact = arr.find((x) => String(x?.account_id ?? "") === accountId) ?? arr[0];
        const personaname = String(exact?.personaname ?? "").trim();
        if (personaname) names.set(accountId, personaname);
      } catch {
        // Ignore lookup failures in demo mode; fallback name handling remains in place.
      }
    })
  );

  return names;
}