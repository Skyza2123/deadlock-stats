import { desc, eq } from "drizzle-orm";

import { db } from "../../../../db";
import { matchPlayers, matches, players } from "../../../../db/schema";
import { fmtTime, heroName } from "../../../../lib/deadlockData";

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

function safeNum(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;

  const matchRows = await db
    .select({
      matchId: matches.matchId,
      rawJson: matches.rawJson,
      ingestedAt: matches.ingestedAt,
    })
    .from(matches)
    .where(eq(matches.matchId, matchId))
    .limit(1);

  if (!matchRows.length) {
    return Response.json({ ok: false, error: "Match not found" }, { status: 404 });
  }

  const topRows = await db
    .select({
      steamId: matchPlayers.steamId,
      heroId: matchPlayers.heroId,
      netWorth: matchPlayers.netWorth,
      kills: matchPlayers.kills,
      assists: matchPlayers.assists,
      displayName: players.displayName,
    })
    .from(matchPlayers)
    .leftJoin(players, eq(players.steamId, matchPlayers.steamId))
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(desc(matchPlayers.netWorth))
    .limit(1);

  const row = matchRows[0];
  const top = topRows[0] ?? null;
  const raw: any = row.rawJson;

  const winnerKey = String(raw?.match_info?.winning_team ?? "");
  const winner = TEAM_NAMES[winnerKey] ?? "Unknown";

  const rawDuration = Number(raw?.match_info?.duration_s ?? raw?.match_info?.duration ?? raw?.duration_s ?? NaN);
  const durationText = Number.isFinite(rawDuration) && rawDuration > 0 ? fmtTime(rawDuration) : "-";

  return Response.json({
    ok: true,
    row: {
      matchId: row.matchId,
      winner,
      durationText,
      durationSeconds: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0,
      saved: 1,
      top: top
        ? {
            displayName: top.displayName,
            heroName: heroName(top.heroId),
            netWorth: safeNum(top.netWorth),
            killAssist: safeNum(top.kills) + safeNum(top.assists),
          }
        : null,
      ingestedAtText: row.ingestedAt ? new Date(row.ingestedAt).toLocaleString() : "-",
    },
  });
}
