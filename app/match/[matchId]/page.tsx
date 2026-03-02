// app/match/[matchId]/page.tsx
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { db } from "../../../db";
import { matches, matchPlayers, players, matchPlayerItems } from "../../../db/schema";
import { eq, sql } from "drizzle-orm";
import { heroName, itemName, fmtTime, hasItem } from "../../../lib/deadlockData";
import { heroSmallIconPath, heroBackgroundPath } from "../../../lib/heroIcons";
import { itemIconPath } from "../../../lib/itemIcons";
import BackButton from "../../../components/BackButton";
import HeroIcon from "../../../components/HeroIcon";
import { authOptions } from "../../../lib/auth";
import UploadBansButton from "../../../components/UploadBansButton";

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

const TEAM_ACCENTS: Record<string, string> = {
  "0": "border-l-yellow-400",
  "1": "border-l-blue-500",
  unknown: "border-l-zinc-500",
};

type PlayerRow = {
  steamId: string;
  displayName: string | null;
  side: string | null; // "0" | "1"
  heroId: string | null;

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
};

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

function fmtDateInput(value: Date | null | undefined) {
  if (!value) return "";
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams?: Promise<{ selectedSteamId?: string; dateStatus?: string }>;
}) {
  const { matchId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedSteamId = resolvedSearchParams?.selectedSteamId ?? undefined;
  const dateStatus = resolvedSearchParams?.dateStatus ?? "";
  const session = await getServerSession(authOptions);

  const scrimDateColumnCheck = await db.execute(
    sql`select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
  );
  const hasScrimDateColumn = scrimDateColumnCheck.rows.length > 0;

  const matchRow = hasScrimDateColumn
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

  async function setScrimDateAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;

    const scrimDateColumnCheck = await db.execute(
      sql`select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
    );
    if (scrimDateColumnCheck.rows.length === 0) {
      await db.execute(sql`alter table "matches" add column if not exists "scrim_date" timestamp with time zone`);
    }

    const scrimDateRaw = String(formData.get("scrimDate") ?? "").trim();

    let scrimDate: Date | null = null;
    if (scrimDateRaw) {
      const parsed = new Date(`${scrimDateRaw}T00:00:00.000Z`);
      if (Number.isFinite(parsed.getTime())) {
        scrimDate = parsed;
      }
    }

    await db
      .update(matches)
      .set({ scrimDate })
      .where(eq(matches.matchId, matchId));

    revalidatePath(`/match/${matchId}`);
    revalidatePath(`/`);
    redirect(`/match/${matchId}?dateStatus=${scrimDate ? "saved" : "cleared"}`);
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

  const rows: PlayerRow[] = await db
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

  const itemRows: ItemRow[] = await db
    .select({
      steamId: matchPlayerItems.steamId,
      gameTimeS: matchPlayerItems.gameTimeS,
      itemId: matchPlayerItems.itemId,
      soldTimeS: matchPlayerItems.soldTimeS,
      upgradeId: matchPlayerItems.upgradeId,
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
  const banCount = extractBanCount(raw);
  const draftEvents = extractDraftEvents(raw);
  const unknownSideDraftEvents = draftEvents.filter((event) => !["0", "1"].includes(String(event.side ?? "")));
  const rawDuration = Number(
    raw?.match_info?.duration_s ??
      raw?.match_info?.duration ??
      raw?.duration_s ??
      NaN
  );

  const maxItemTime =
    itemRows.length > 0
      ? Math.max(...itemRows.map((x) => safeNum(x.gameTimeS)))
      : 0;

  const durationS =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : Math.max(1, maxItemTime);

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

  return (
    <main className="relative isolate w-full overflow-hidden p-4 sm:p-6 lg:p-8">
      {selectedHeroBg ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center opacity-30"
            style={{ backgroundImage: `url(${selectedHeroBg})` }}
          />
          <div className="pointer-events-none absolute inset-0 z-0 bg-zinc-950/65" />
        </>
      ) : null}

      <div className="relative z-10 space-y-4">

      <div className="flex items-center justify-between gap-3">
        <BackButton />
      </div>

      {selectedPlayer ? (
        <section className="panel-premium relative overflow-hidden rounded-xl p-4">
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

      <div className="panel-premium rounded-xl p-4 md:p-5">
        <h1 className="heading-luxe text-3xl font-bold tracking-tight">Match {matchId}</h1>
        <p className="text-sm text-zinc-400">
          Duration: {fmtTime(durationS)} • Players: {rows.length}
        </p>
      </div>

      {session ? (
        <section className="panel-premium rounded-xl p-4 space-y-4">
          {dateStatus === "saved" ? (
            <p className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              Scrim date saved.
            </p>
          ) : null}
          {dateStatus === "cleared" ? (
            <p className="rounded border border-zinc-700/80 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
              Scrim date cleared.
            </p>
          ) : null}
          <form action={setScrimDateAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <label htmlFor="scrimDate" className="mb-1 block text-sm text-zinc-300">
                Scrim date (manual)
              </label>
              <input
                id="scrimDate"
                name="scrimDate"
                type="date"
                defaultValue={fmtDateInput(matchRow[0].scrimDate)}
                className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
              >
                Save date
              </button>
              <button
                type="submit"
                name="scrimDate"
                value=""
                className="rounded border border-zinc-700/80 bg-zinc-900/80 px-4 py-2 text-sm hover:bg-zinc-800"
              >
                Clear
              </button>
            </div>
          </form>

          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-200">Match bans</p>
              <span className={`rounded px-2 py-0.5 text-xs ${banCount > 0 ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border border-zinc-700/80 bg-zinc-900/60 text-zinc-300"}`}>
                {banCount > 0 ? `${banCount} uploaded` : "Not uploaded"}
              </span>
            </div>
            <UploadBansButton matchId={matchId} initialBanCount={banCount} />
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4">
          <p className="text-sm text-zinc-400">Sign in to set or edit the manual scrim date and upload bans.</p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/45 p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">Result</p>
          <p className="mt-1 text-sm font-medium">{winnerText(raw)}</p>
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/45 p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">Duration</p>
          <p className="mt-1 text-sm font-medium">{fmtTime(durationS)}</p>
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/45 p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">
            Hidden King souls
          </p>
          <p className="mt-1 text-sm font-medium">
            {(bySide.get("0") ?? []).reduce(
              (sum, r) => sum + safeNum(r.netWorth),
              0
            )}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/45 p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">
            Archmother souls
          </p>
          <p className="mt-1 text-sm font-medium">
            {(bySide.get("1") ?? []).reduce(
              (sum, r) => sum + safeNum(r.netWorth),
              0
            )}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/45 p-3">
          <p className="text-xs uppercase tracking-wide opacity-70">Scrim date</p>
          <p className="mt-1 text-sm font-medium">
            {matchRow[0].scrimDate ? new Date(matchRow[0].scrimDate).toLocaleDateString() : "Not set"}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-4">
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
                  <div key={`draft-side-${sideKey}`} className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
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
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-3">
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
          <p className="text-sm text-zinc-400">Upload a draft JSON on this match page to show picks and bans timeline.</p>
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
              className={`rounded-xl border border-zinc-800/80 bg-zinc-950/45 border-l-4 px-4 pt-5 pb-5 ${
                TEAM_ACCENTS[sideKey] ?? TEAM_ACCENTS.unknown
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  {teamLabel(sideKey === "unknown" ? null : sideKey)}
                  <span className="ml-2 text-sm font-normal text-zinc-400">
                    ({teamRows.length} players)
                  </span>
                </h2>
                <div className="flex flex-wrap gap-2 text-xs">
                  {topSouls ? (
                    <span className="rounded px-2 py-1 inline-flex items-center gap-1">
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
                    <span className="rounded px-2 py-1 inline-flex items-center gap-1">
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
                    <span className="rounded px-2 py-1 inline-flex items-center gap-1">
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

              <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-950/35">
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
                        Timeline
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
                      const knownTimeline = list.filter((it) =>
                        hasItem(Number(it.itemId))
                      );
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
                            <a
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
                            </a>
                          </td>

                          <td className="p-0">
                            <a href={playerHref} className="block px-3 py-3">
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
                            </a>
                          </td>

                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.netWorth ?? "-"}</a></td>
                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.netWorth != null ? fmt1(spm) : "-"}</a></td>
                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.level ?? "-"}</a></td>
                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.lastHits ?? "-"}</a></td>
                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.denies ?? "-"}</a></td>

                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.kills ?? "-"}</a></td>
                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.deaths ?? "-"}</a></td>
                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{r.assists ?? "-"}</a></td>
                          <td className="p-0 text-right"><a href={playerHref} className="block px-3 py-3">{fmt1(kda(K, D, A))}</a></td>

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

                          {/* ✅ FIX: lock timeline column width even when expanded */}
                          <td className="p-3 max-w-[320px] overflow-hidden">
                            {knownTimeline.length ? (
                              <details>
                                <summary className="cursor-pointer select-none opacity-90">
                                  Show ({knownTimeline.length})
                                </summary>
                                <div className="mt-2 flex flex-wrap gap-2 max-w-full overflow-hidden">
                                  {knownTimeline.map((it) => (
                                    <span
                                      key={`${it.gameTimeS}-${it.itemId}`}
                                      className="px-2 py-1 rounded bg-zinc-900 text-xs whitespace-nowrap inline-flex items-center gap-1"
                                      title={itemName(Number(it.itemId))}
                                    >
                                      <span className="font-mono">
                                        {fmtTime(it.gameTimeS)}
                                      </span>
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
                                      {it.soldTimeS && it.soldTimeS !== 0 ? (
                                        <span className="opacity-70">
                                          {" "}
                                          (sold {fmtTime(it.soldTimeS)})
                                        </span>
                                      ) : null}
                                    </span>
                                  ))}
                                </div>
                              </details>
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