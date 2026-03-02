// app/page.tsx
import { db } from "../db";
import { matchPlayers, matches, players } from "../db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { fmtTime, heroName } from "../lib/deadlockData";
import MatchIngestForm from "../components/MatchIngestForm";
import HomeRecentPanel from "../components/HomeRecentPanel";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function hasUploadedBans(raw: any) {
  const separateCount = Number(raw?.separateBans?.count ?? 0);
  if (Number.isFinite(separateCount) && separateCount > 0) return true;

  const arrays = [
    raw?.match_info?.bans,
    raw?.match_info?.hero_bans,
    raw?.hero_bans,
    raw?.bans,
    raw?.pick_bans,
    raw?.draft?.bans,
  ];

  return arrays.some((value) => Array.isArray(value) && value.length > 0);
}

function normalizeViewerIds(viewerId: string) {
  const ids = new Set<string>();
  const raw = String(viewerId ?? "").trim();
  if (!raw) return [] as string[];
  ids.add(raw);
  if (raw.startsWith("steam:")) ids.add(raw.slice(6));
  if (raw.startsWith("user:")) ids.add(raw.slice(5));
  return [...ids].filter(Boolean);
}

function dayKeyUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftUtcDay(dayKey: string, delta: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + delta);
  return dayKeyUtc(date);
}

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const isSignedIn = Boolean(session);
  const viewerId = String((session?.user as { id?: string } | undefined)?.id ?? "");
  const viewerIds = normalizeViewerIds(viewerId);

  const scrimDateColumnCheck = await db.execute(
    sql`select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
  );
  const hasScrimDateColumn = scrimDateColumnCheck.rows.length > 0;

  const savedRows = isSignedIn && viewerIds.length
    ? await (async () => {
        try {
          const rows = await db.execute(
            sql`select steam_id, match_id, created_at from saved_matches where steam_id in (${sql.join(viewerIds.map((id) => sql`${id}`), sql`, `)}) order by created_at desc limit 5000`
          );
          return rows.rows
            .map((row: any) => ({
              steamId: String(row.steam_id ?? "").trim(),
              matchId: String(row.match_id ?? "").trim(),
              createdAt: row.created_at ? new Date(row.created_at) : null,
            }))
            .filter((row: { steamId: string; matchId: string; createdAt: Date | null }) => Boolean(row.matchId));
        } catch {
          return [] as Array<{ steamId: string; matchId: string; createdAt: Date | null }>;
        }
      })()
    : [];

  const savedByMatch = new Map<string, Date | null>();
  for (const row of savedRows) {
    const existing = savedByMatch.get(row.matchId);
    if (!existing) {
      savedByMatch.set(row.matchId, row.createdAt ?? null);
      continue;
    }
    if (row.createdAt && existing && row.createdAt > existing) {
      savedByMatch.set(row.matchId, row.createdAt);
    }
    if (!existing && row.createdAt) {
      savedByMatch.set(row.matchId, row.createdAt);
    }
  }

  const savedEntries = [...savedByMatch.entries()]
    .map(([matchId, createdAt]) => ({ matchId, createdAt }))
    .sort((a, b) => {
      const aTime = a.createdAt?.getTime() ?? 0;
      const bTime = b.createdAt?.getTime() ?? 0;
      return bTime - aTime;
    });

  const savedMatchIds = savedEntries.map((entry) => entry.matchId);

  const recent = isSignedIn && savedMatchIds.length
    ? hasScrimDateColumn
      ? await db
          .select({
            matchId: matches.matchId,
            ingestedAt: matches.ingestedAt,
            scrimDate: matches.scrimDate,
            rawJson: matches.rawJson,
          })
          .from(matches)
          .where(inArray(matches.matchId, savedMatchIds))
          .orderBy(matches.ingestedAt)
          .limit(100)
      : (
          await db
            .select({
              matchId: matches.matchId,
              ingestedAt: matches.ingestedAt,
              rawJson: matches.rawJson,
            })
            .from(matches)
            .where(inArray(matches.matchId, savedMatchIds))
            .orderBy(matches.ingestedAt)
            .limit(100)
        ).map((row) => ({ ...row, scrimDate: null as Date | null }))
    : [];

  const rows = [...recent]
    .sort((a, b) => {
      const aNum = Number(a.matchId);
      const bNum = Number(b.matchId);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
      return String(b.matchId).localeCompare(String(a.matchId));
    })
    .slice(0, 20);
  const recentMatchIds = rows.map((row) => row.matchId);

  const recentPlayers = isSignedIn && recentMatchIds.length
    ? await db
        .select({
          matchId: matchPlayers.matchId,
          steamId: matchPlayers.steamId,
          heroId: matchPlayers.heroId,
          netWorth: matchPlayers.netWorth,
          kills: matchPlayers.kills,
          assists: matchPlayers.assists,
          displayName: players.displayName,
        })
        .from(matchPlayers)
        .leftJoin(players, eq(players.steamId, matchPlayers.steamId))
        .where(inArray(matchPlayers.matchId, recentMatchIds))
    : [];

  const topByMatch = new Map<
    string,
    {
      steamId: string;
      heroId: string | null;
      displayName: string | null;
      netWorth: number | null;
      kills: number | null;
      assists: number | null;
    }
  >();

  for (const row of recentPlayers) {
    const current = topByMatch.get(row.matchId);
    if (!current || safeNum(row.netWorth) > safeNum(current.netWorth)) {
      topByMatch.set(row.matchId, {
        steamId: row.steamId,
        heroId: row.heroId,
        displayName: row.displayName,
        netWorth: row.netWorth,
        kills: row.kills,
        assists: row.assists,
      });
    }
  }

  const enrichedRows = rows.map((row) => {
    const raw: any = row.rawJson;
    const winnerKey = String(raw?.match_info?.winning_team ?? "");
    const winner = TEAM_NAMES[winnerKey] ?? "Unknown";
    const rawDuration = Number(raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? raw?.duration_s ?? NaN);
    const durationText = Number.isFinite(rawDuration) && rawDuration > 0 ? fmtTime(rawDuration) : "-";
    const top = topByMatch.get(row.matchId) ?? null;

    return {
      ...row,
      winnerKey,
      winner,
      durationText,
      top,
    };
  });

  const recentForView = enrichedRows.map((row) => ({
    matchId: row.matchId,
    winnerKey: row.winnerKey,
    winner: row.winner,
    durationText: row.durationText,
    durationSeconds: Number((row.rawJson as any)?.match_info?.duration_s ?? (row.rawJson as any)?.match_info?.duration ?? (row.rawJson as any)?.duration_s ?? 0),
    saved: 1,
    top: row.top
      ? {
          displayName: row.top.displayName,
          heroName: heroName(row.top.heroId),
          netWorth: safeNum(row.top.netWorth),
          killAssist: safeNum(row.top.kills) + safeNum(row.top.assists),
        }
      : null,
    scrimDateSet: Boolean(row.scrimDate),
    bansUploaded: hasUploadedBans(row.rawJson),
    ingestedAtText: row.ingestedAt ? new Date(row.ingestedAt).toLocaleString() : "-",
  }));

  const totalSavedMatches = savedEntries.length;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const uploadsLast7d = savedEntries.reduce((sum, entry) => {
    if (!entry.createdAt) return sum;
    return entry.createdAt >= sevenDaysAgo ? sum + 1 : sum;
  }, 0);

  const uploadDayKeys = [...new Set(savedEntries
    .filter((entry) => Boolean(entry.createdAt))
    .map((entry) => dayKeyUtc(entry.createdAt as Date)))]
    .sort((a, b) => b.localeCompare(a));

  let uploadStreak = 0;
  if (uploadDayKeys.length > 0) {
    uploadStreak = 1;
    let expected = shiftUtcDay(uploadDayKeys[0], -1);
    for (let index = 1; index < uploadDayKeys.length; index += 1) {
      if (uploadDayKeys[index] !== expected) break;
      uploadStreak += 1;
      expected = shiftUtcDay(expected, -1);
    }
  }

  const lastUploadAt = savedEntries[0]?.createdAt ?? null;
  const lastUploadText = lastUploadAt ? lastUploadAt.toLocaleString() : "-";

  const totalRecent = recentForView.length;
  const totalDurationSeconds = recentForView.reduce((sum, row) => sum + (Number.isFinite(row.durationSeconds) ? row.durationSeconds : 0), 0);
  const avgDurationText = totalRecent > 0 ? fmtTime(Math.round(totalDurationSeconds / totalRecent)) : "-";
  const bansUploadedCount = recentForView.reduce((sum, row) => sum + (row.bansUploaded ? 1 : 0), 0);
  const scrimDateCount = recentForView.reduce((sum, row) => sum + (row.scrimDateSet ? 1 : 0), 0);

  const viewerKey = String(session?.user?.email ?? session?.user?.name ?? "public-viewer").toLowerCase();

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <header className="panel-premium relative overflow-hidden rounded-xl p-5 md:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-16 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />

        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="heading-luxe text-3xl font-bold tracking-tight">Deadlock Stats</h1>
              <p className="mt-2 text-sm text-zinc-400">Search any match ID and open match pages without signing in.</p>
            </div>
            <div className="panel-premium-soft inline-flex items-center rounded-full px-3 py-1 text-xs">
              {isSignedIn ? "Signed in workspace" : "Public browsing mode"}
            </div>
          </div>

          {isSignedIn ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="panel-premium-soft rounded-full px-3 py-1 text-zinc-300">
                {session?.user?.name ?? session?.user?.email ?? "user"}
              </span>
              <a
                href="/"
                className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Refresh
              </a>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Sign in only if you want to upload matches to a team.</p>
          )}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Personal saved</p>
          <p className="mt-1 text-2xl font-semibold">{isSignedIn ? totalSavedMatches : "-"}</p>
          <p className="text-xs text-zinc-500">Total matches in your saved list</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Upload streak</p>
          <p className="mt-1 text-2xl font-semibold">{isSignedIn ? `${uploadStreak}d` : "-"}</p>
          <p className="text-xs text-zinc-500">Consecutive upload days</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Uploads (7d)</p>
          <p className="mt-1 text-2xl font-semibold">{isSignedIn ? uploadsLast7d : "-"}</p>
          <p className="text-xs text-zinc-500">Saved in last 7 days</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Last upload</p>
          <p className="mt-1 text-sm font-semibold">{isSignedIn ? lastUploadText : "-"}</p>
          <p className="text-xs text-zinc-500">Most recent saved match</p>
        </div>

        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Saved matches</p>
          <p className="mt-1 text-2xl font-semibold">{totalRecent}</p>
          <p className="text-xs text-zinc-500">Visible in your recent feed</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Avg duration</p>
          <p className="mt-1 text-2xl font-semibold">{avgDurationText}</p>
          <p className="text-xs text-zinc-500">Across current recent matches</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Bans uploaded</p>
          <p className="mt-1 text-2xl font-semibold">{bansUploadedCount}</p>
          <p className="text-xs text-zinc-500">Matches with ban data present</p>
        </div>
        <div className="panel-premium-soft rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide opacity-70">Scrim dates set</p>
          <p className="mt-1 text-2xl font-semibold">{scrimDateCount}</p>
          <p className="text-xs text-zinc-500">Matches with manual scrim date</p>
        </div>
      </section>

      {/* Ingest form */}
      <section id="ingest" className="panel-premium rounded-xl p-5 transition-colors">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Import a match</h2>
          <span className="panel-premium-soft rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide opacity-80">Ingest</span>
        </div>
        <MatchIngestForm />
      </section>

      {isSignedIn ? <HomeRecentPanel rows={recentForView} viewerKey={viewerKey} /> : null}
    </main>
  );
}