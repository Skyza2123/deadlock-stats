// app/api/ingest/route.ts
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { db } from "../../../db";
import {
  matches,
  players,
  matchPlayers,
  matchPlayerItems,
  teamMemberships,
  teams,
} from "../../../db/schema";
import { authOptions } from "../../../lib/auth";

function normalizeEnemyTeamName(value: string) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed.slice(0, 80);
}

function normalizeScrimName(value: string) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed.slice(0, 80);
}

function parseScrimDate(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsedUtc = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsedUtc.getTime()) ? null : parsedUtc;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function attachEnemyGroupMetadata(raw: any, teamSlug: string, enemyTeamName: string) {
  if (!enemyTeamName) return raw;
  const source = raw && typeof raw === "object" ? raw : {};
  const existingMeta = source.__ingestMeta && typeof source.__ingestMeta === "object" ? source.__ingestMeta : {};
  const existingEnemyByTeam =
    existingMeta.enemyByTeam && typeof existingMeta.enemyByTeam === "object"
      ? existingMeta.enemyByTeam
      : {};

  return {
    ...source,
    __ingestMeta: {
      ...existingMeta,
      enemyByTeam: {
        ...existingEnemyByTeam,
        [teamSlug]: enemyTeamName,
      },
    },
  };
}

function isMissingSavedMatchesTableError(err: any) {
  const topCode = String(err?.code ?? "").trim();
  const causeCode = String(err?.cause?.code ?? "").trim();
  const topMessage = String(err?.message ?? "").toLowerCase();
  const causeMessage = String(err?.cause?.message ?? "").toLowerCase();

  if (topCode === "42P01" || causeCode === "42P01") return true;

  const marker = 'relation "saved_matches" does not exist';
  return topMessage.includes(marker) || causeMessage.includes(marker);
}

async function fetchPersonaForAccountId(accountId: string, apiKey: string) {
  const url =
    "https://api.deadlock-api.com/v1/players/steam-search?search_query=" +
    encodeURIComponent(accountId);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const arr = (await res.json()) as any[];
  if (!Array.isArray(arr) || arr.length === 0) return null;

  // Prefer exact account_id match if present
  const exact = arr.find((x) => String(x.account_id) === String(accountId));
  return exact ?? arr[0];
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
    }

    const form = await req.formData();
    const matchId = String(form.get("matchId") ?? "").trim();
    const teamSlug = String(form.get("teamSlug") ?? "").trim();
    const enemyTeamName = normalizeEnemyTeamName(String(form.get("enemyTeamName") ?? ""));
    const assignmentTypeRaw = String(form.get("assignmentType") ?? "team").trim().toLowerCase();
    const assignmentType = assignmentTypeRaw === "individual" ? "individual" : "team";
    const isTeamUpload = assignmentType === "team";
    const scrimName = normalizeScrimName(String(form.get("scrimName") ?? ""));
    const scrimDateRaw = String(form.get("scrimDate") ?? "");
    const parsedScrimDate = parseScrimDate(scrimDateRaw);

    const rawUserId = String((session?.user as { id?: string } | undefined)?.id ?? "");
    const sessionEmail = String(session?.user?.email ?? "").trim().toLowerCase();
    const savedMatchesKey = String(rawUserId || sessionEmail).trim();
    const membershipKey = rawUserId.startsWith("user:")
      ? rawUserId.slice(5)
      : rawUserId.startsWith("steam:")
        ? rawUserId.slice(6)
        : "";

    if (!matchId) {
      return NextResponse.json({ ok: false, error: "Missing matchId" }, { status: 400 });
    }

    if (isTeamUpload && !teamSlug) {
      return NextResponse.json({ ok: false, error: "Missing team selection" }, { status: 400 });
    }

    if (isTeamUpload) {
      if (!membershipKey) {
        return NextResponse.json({ ok: false, error: "Invalid session user" }, { status: 401 });
      }

      const teamExists = await db
        .select({ slug: teams.slug })
        .from(teams)
        .where(eq(teams.slug, teamSlug))
        .limit(1);

      if (!teamExists.length) {
        return NextResponse.json({ ok: false, error: "Selected team not found" }, { status: 404 });
      }

      const isMember = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, membershipKey),
            sql`${teamMemberships.endAt} is null`
          )
        )
        .limit(1);

      if (!isMember.length) {
        return NextResponse.json({ ok: false, error: "Forbidden team" }, { status: 403 });
      }
    }

    const existingMatch = await db
      .select({ matchId: matches.matchId })
      .from(matches)
      .where(eq(matches.matchId, matchId))
      .limit(1);

    if (existingMatch.length > 0) {
      const existingRaw = await db
        .select({ rawJson: matches.rawJson })
        .from(matches)
        .where(eq(matches.matchId, matchId))
        .limit(1);

      let mergedRaw = attachIngestMetadata(existingRaw[0]?.rawJson ?? {}, {
        teamSlug: isTeamUpload ? teamSlug : "",
        assignmentType,
        ownerId: rawUserId,
        scrimName,
        scrimDate: parsedScrimDate,
      });

      if (isTeamUpload && enemyTeamName) {
        mergedRaw = attachEnemyGroupMetadata(mergedRaw, teamSlug, enemyTeamName);
      }

      const updatePayload: {
        rawJson: unknown;
        ingestedAt: Date;
        saved: number;
        scrimDate?: Date | null;
      } = {
        rawJson: mergedRaw,
        ingestedAt: new Date(),
        saved: 1,
      };

      const existingScrimDateColumnCheck = await db.execute(
        sql`select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
      );
      const hasExistingScrimDateColumn = existingScrimDateColumnCheck.rows.length > 0;
      if (hasExistingScrimDateColumn && parsedScrimDate) {
        updatePayload.scrimDate = parsedScrimDate;
      }

      await db
        .update(matches)
        .set(updatePayload)
        .where(eq(matches.matchId, matchId));

      if (savedMatchesKey) {
        try {
          await db.execute(
            sql`insert into saved_matches (steam_id, match_id) values (${savedMatchesKey}, ${matchId}) on conflict (steam_id, match_id) do nothing`
          );
        } catch (err) {
          if (!isMissingSavedMatchesTableError(err)) throw err;
        }
      }

      return NextResponse.json({
        ok: true,
        saved: true,
        fromDb: true,
        matchId,
        teamSlug: teamSlug || null,
        redirectTo: `/match/${matchId}`,
      });
    }

    const apiKey = process.env.DEADLOCK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing DEADLOCK_API_KEY in .env(.local)" },
        { status: 500 }
      );
    }

    const res = await fetch(`https://api.deadlock-api.com/v1/matches/${matchId}/metadata`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { ok: false, error: `Deadlock API error ${res.status}`, details: text.slice(0, 500) },
        { status: 502 }
      );
    }

    let matchJson: any = await res.json();
    matchJson = attachIngestMetadata(matchJson, {
      teamSlug: isTeamUpload ? teamSlug : "",
      assignmentType,
      ownerId: rawUserId,
      scrimName,
      scrimDate: parsedScrimDate,
    });

    if (isTeamUpload && enemyTeamName) {
      matchJson = attachEnemyGroupMetadata(matchJson, teamSlug, enemyTeamName);
    }
    const participants: any[] = matchJson?.match_info?.players ?? [];

    const playerColumnsResult = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'players'`
    );
    const playerColumns = new Set(
      playerColumnsResult.rows.map((row: any) => String(row.column_name))
    );

    const matchPlayerColumnsResult = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'match_players'`
    );
    const matchPlayerColumns = new Set(
      matchPlayerColumnsResult.rows.map((row: any) => String(row.column_name))
    );

    const matchPlayerItemsTableResult = await db.execute(
      sql`select 1 as ok from information_schema.tables where table_name = 'match_player_items' limit 1`
    );
    const hasMatchPlayerItemsTable = matchPlayerItemsTableResult.rows.length > 0;

    const itemIdTypeResult = await db.execute(
      sql`select data_type from information_schema.columns where table_name = 'match_player_items' and column_name = 'item_id' limit 1`
    );
    const itemIdDataType = String((itemIdTypeResult.rows[0] as any)?.data_type ?? "").toLowerCase();
    const itemIdIsInteger = itemIdDataType === "integer";

    const matchScrimDateColumnResult = await db.execute(
      sql`select 1 as ok from information_schema.columns where table_name = 'matches' and column_name = 'scrim_date' limit 1`
    );
    const hasMatchScrimDateColumn = matchScrimDateColumnResult.rows.length > 0;

    await db.transaction(async (tx) => {
      // 1) Save raw JSON always
      if (hasMatchScrimDateColumn) {
        const matchValues: {
          matchId: string;
          rawJson: unknown;
          startedAt: null;
          endedAt: null;
          map: null;
          saved: number;
          scrimDate?: Date | null;
        } = {
          matchId,
          rawJson: matchJson,
          startedAt: null,
          endedAt: null,
          map: null,
          saved: 1,
        };
        matchValues.scrimDate = parsedScrimDate;

        const updateSet: {
          rawJson: unknown;
          ingestedAt: Date;
          saved: number;
          scrimDate?: Date | null;
        } = {
          rawJson: matchJson,
          ingestedAt: new Date(),
          saved: 1,
        };
        if (parsedScrimDate) {
          updateSet.scrimDate = parsedScrimDate;
        }

        await tx
          .insert(matches)
          .values(matchValues)
          .onConflictDoUpdate({
            target: matches.matchId,
            set: updateSet,
          });
      } else {
        await tx.execute(sql`
          insert into matches (match_id, started_at, ended_at, map, raw_json, saved)
          values (${matchId}, null, null, null, ${matchJson}::jsonb, 1)
          on conflict (match_id)
          do update set raw_json = excluded.raw_json, ingested_at = now(), saved = 1
        `);
      }

      // 2) Upsert players + per-match stats + items
      for (const p of participants) {
        const steamId = String(p?.account_id ?? "").trim();
        if (!steamId) continue;

        // ---- name lookup ----
        // Most match payloads don't contain names; if missing, fetch persona name
        let displayName: string | null = (p?.name ?? p?.display_name ?? null) as string | null;

        if (!displayName) {
          const info = await fetchPersonaForAccountId(steamId, apiKey);
          if (info?.personaname) displayName = String(info.personaname);
          // optional safety: small delay to avoid hammering endpoint
          // await new Promise((r) => setTimeout(r, 100));
        }

        // Upsert player

        let profileUrl: string | null = null;
        let avatar: string | null = null;
        let avatarMedium: string | null = null;
        let avatarFull: string | null = null;
        let realName: string | null = null;
        let countryCode: string | null = null;
        let lastUpdated: number | null = null;

        if (!displayName) {
        const info = await fetchPersonaForAccountId(steamId, apiKey);
        if (info) {
            displayName = info.personaname ?? null;
            profileUrl = info.profileurl ?? null;
            avatar = info.avatar ?? null;
            avatarMedium = info.avatarmedium ?? null;
            avatarFull = info.avatarfull ?? null;
            realName = info.realname ?? null;
            countryCode = info.countrycode ?? null;
            lastUpdated = info.last_updated ?? null;
        }
        }

        const playerValues: any = {
          steamId,
          displayName,
        };

        const playerSet: any = {
          displayName,
        };

        if (playerColumns.has("profile_url")) {
          playerValues.profileUrl = profileUrl;
          playerSet.profileUrl = profileUrl;
        }
        if (playerColumns.has("avatar")) {
          playerValues.avatar = avatar;
          playerSet.avatar = avatar;
        }
        if (playerColumns.has("avatar_medium")) {
          playerValues.avatarMedium = avatarMedium;
          playerSet.avatarMedium = avatarMedium;
        }
        if (playerColumns.has("avatar_full")) {
          playerValues.avatarFull = avatarFull;
          playerSet.avatarFull = avatarFull;
        }
        if (playerColumns.has("real_name")) {
          playerValues.realName = realName;
          playerSet.realName = realName;
        }
        if (playerColumns.has("country_code")) {
          playerValues.countryCode = countryCode;
          playerSet.countryCode = countryCode;
        }
        if (playerColumns.has("last_updated")) {
          playerValues.lastUpdated = lastUpdated;
          playerSet.lastUpdated = lastUpdated;
        }

        await tx
          .insert(players)
          .values(playerValues)
          .onConflictDoUpdate({
            target: players.steamId,
            set: playerSet,
          });
        // Upsert match player stats
        const matchPlayerValues: any = {
          matchId,
          steamId,
          side: p?.team != null ? String(p.team) : null,
          heroId: p?.hero_id != null ? String(p.hero_id) : null,
          kills: p?.kills ?? null,
          deaths: p?.deaths ?? null,
          assists: p?.assists ?? null,
          rawJson: p,
        };

        const matchPlayerSet: any = {
          side: p?.team != null ? String(p.team) : null,
          heroId: p?.hero_id != null ? String(p.hero_id) : null,
          kills: p?.kills ?? null,
          deaths: p?.deaths ?? null,
          assists: p?.assists ?? null,
          rawJson: p,
        };

        if (matchPlayerColumns.has("net_worth")) {
          matchPlayerValues.netWorth = p?.net_worth ?? null;
          matchPlayerSet.netWorth = p?.net_worth ?? null;
        }
        if (matchPlayerColumns.has("last_hits")) {
          matchPlayerValues.lastHits = p?.last_hits ?? null;
          matchPlayerSet.lastHits = p?.last_hits ?? null;
        }
        if (matchPlayerColumns.has("denies")) {
          matchPlayerValues.denies = p?.denies ?? null;
          matchPlayerSet.denies = p?.denies ?? null;
        }
        if (matchPlayerColumns.has("level")) {
          matchPlayerValues.level = p?.level ?? null;
          matchPlayerSet.level = p?.level ?? null;
        }

        await tx
          .insert(matchPlayers)
          .values(matchPlayerValues)
          .onConflictDoUpdate({
            target: [matchPlayers.matchId, matchPlayers.steamId],
            set: matchPlayerSet,
          });

        // 3) Items: make ingestion idempotent (delete then insert)
        if (!hasMatchPlayerItemsTable) continue;

        await tx
          .delete(matchPlayerItems)
          .where(and(eq(matchPlayerItems.matchId, matchId), eq(matchPlayerItems.steamId, steamId)));

        const items = Array.isArray(p?.items) ? p.items : [];

        // Prevent duplicate (game_time_s, item_id) combos (PK collision)
        const seen = new Set<string>();

        for (const it of items) {
          const gameTimeS = Number(it?.game_time_s);
          const itemId = Number(it?.item_id);

          if (!Number.isFinite(gameTimeS) || !Number.isFinite(itemId)) continue;
          if (itemIdIsInteger && itemId > 2147483647) continue;

          const key = `${gameTimeS}:${itemId}`;
          if (seen.has(key)) continue;
          seen.add(key);

          await tx
            .insert(matchPlayerItems)
            .values({
              matchId,
              steamId,
              gameTimeS,
              itemId,
              upgradeId:
                it?.upgrade_id != null
                  ? (() => {
                      const value = Number(it.upgrade_id);
                      if (!Number.isFinite(value)) return null;
                      if (itemIdIsInteger && value > 2147483647) return null;
                      return value;
                    })()
                  : null,
              soldTimeS: it?.sold_time_s ?? null,
              flags: it?.flags ?? null,
              imbuedAbilityId:
                it?.imbued_ability_id != null
                  ? (() => {
                      const value = Number(it.imbued_ability_id);
                      if (!Number.isFinite(value)) return null;
                      if (itemIdIsInteger && value > 2147483647) return null;
                      return value;
                    })()
                  : null,
            })
            .onConflictDoNothing();
        }
      }
    });

    if (savedMatchesKey) {
      try {
        await db.execute(
          sql`insert into saved_matches (steam_id, match_id) values (${savedMatchesKey}, ${matchId}) on conflict (steam_id, match_id) do nothing`
        );
      } catch (err) {
        if (!isMissingSavedMatchesTableError(err)) throw err;
      }
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      matchId,
      teamSlug: isTeamUpload ? teamSlug : null,
      assignmentType,
      publicUpload: false,
      redirectTo: `/match/${matchId}`,
    });
  } catch (err: any) {
    const causeMessage = String(err?.cause?.message ?? "").trim();
    const baseMessage = String(err?.message ?? err ?? "Unknown error").trim();
    const details = causeMessage || baseMessage;

    return NextResponse.json(
      { ok: false, error: "Server error", details },
      { status: 500 }
    );
  }
}

function attachIngestMetadata(
  raw: any,
  options: {
    teamSlug?: string;
    assignmentType?: "team" | "individual";
    ownerId?: string;
    scrimName?: string;
    scrimDate?: Date | null;
  }
) {
  const source = raw && typeof raw === "object" ? raw : {};
  const existingMeta = source.__ingestMeta && typeof source.__ingestMeta === "object" ? source.__ingestMeta : {};
  const existingTeamSlugsRaw = Array.isArray(existingMeta.teamSlugs) ? existingMeta.teamSlugs : [];
  const existingTeamSlugs = existingTeamSlugsRaw
    .map((value: unknown) => String(value ?? "").trim())
    .filter(Boolean);

  const nextTeamSlugs = new Set(existingTeamSlugs);
  const teamSlug = String(options.teamSlug ?? "").trim();
  if (teamSlug) nextTeamSlugs.add(teamSlug);

  const assignmentType = options.assignmentType === "individual" ? "individual" : "team";
  const ownerId = String(options.ownerId ?? "").trim();
  const scrimName = normalizeScrimName(String(options.scrimName ?? ""));
  const scrimDateIso = options.scrimDate ? new Date(options.scrimDate).toISOString() : null;

  return {
    ...source,
    __ingestMeta: {
      ...existingMeta,
      teamSlugs: [...nextTeamSlugs],
      assignmentType,
      ownerId: ownerId || null,
      scrimName: scrimName || null,
      scrimDate: scrimDateIso,
      public: false,
    },
  };
}