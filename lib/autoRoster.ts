import "server-only";

import { pool } from "./index";

type MatchPlayerRow = {
  match_id: string;
  steam_id: string;
  side: string | null;
};

function normalizeTeamSlug(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function addToNestedMap(map: Map<string, Map<string, Set<string>>>, matchId: string, side: string, steamId: string) {
  const sides = map.get(matchId) ?? new Map<string, Set<string>>();
  const players = sides.get(side) ?? new Set<string>();
  players.add(steamId);
  sides.set(side, players);
  map.set(matchId, sides);
}

function chooseSideByRoster(sides: Map<string, Set<string>>, activeRoster: Set<string>) {
  let bestSide = "";
  let bestCount = 0;

  for (const [side, steamIds] of sides.entries()) {
    let count = 0;
    for (const steamId of steamIds) {
      if (activeRoster.has(steamId)) count += 1;
    }

    if (count > bestCount) {
      bestSide = side;
      bestCount = count;
    }
  }

  return bestCount > 0 ? bestSide : "";
}

function chooseFallbackCandidates(matchPlayers: MatchPlayerRow[]) {
  const matchesBySteam = new Map<string, Set<string>>();

  for (const row of matchPlayers) {
    const steamId = String(row.steam_id ?? "").trim();
    const matchId = String(row.match_id ?? "").trim();
    if (!steamId || !matchId) continue;

    const matches = matchesBySteam.get(steamId) ?? new Set<string>();
    matches.add(matchId);
    matchesBySteam.set(steamId, matches);
  }

  const recurring = [...matchesBySteam.entries()]
    .filter(([, matchIds]) => matchIds.size >= 2)
    .map(([steamId]) => steamId);

  return recurring.length > 0 && recurring.length <= 6 ? recurring : [];
}

export async function syncAutoRosterForTeam(teamSlugRaw: string) {
  const teamSlug = normalizeTeamSlug(teamSlugRaw);
  if (!teamSlug) return { added: 0 };

  const tablesResult = await pool.query<{
    has_scrims: boolean;
    has_matches: boolean;
    has_match_players: boolean;
    has_team_memberships: boolean;
    has_teams: boolean;
  }>(
    `
    SELECT
      to_regclass('public.scrims') IS NOT NULL AS has_scrims,
      to_regclass('public.matches') IS NOT NULL AS has_matches,
      to_regclass('public.match_players') IS NOT NULL AS has_match_players,
      to_regclass('public.team_memberships') IS NOT NULL AS has_team_memberships,
      to_regclass('public.teams') IS NOT NULL AS has_teams
    `
  );

  const tables = tablesResult.rows[0];
  if (!tables?.has_matches || !tables.has_match_players || !tables.has_team_memberships || !tables.has_teams) {
    return { added: 0 };
  }

  const teamResult = await pool.query<{ team_id: string }>(
    `
    SELECT team_id::text
    FROM teams
    WHERE slug = $1
    LIMIT 1
    `,
    [teamSlug]
  );
  const teamIdText = String(teamResult.rows[0]?.team_id ?? "").trim();
  if (!teamIdText) return { added: 0 };

  const teamMembershipKeys = [...new Set([teamSlug, teamIdText].filter(Boolean))];

  const assignedMatchRows = tables.has_scrims
    ? await pool.query<{ match_id: string }>(
        `
        WITH scrim_matches AS (
          SELECT DISTINCT match_entry->>'matchId' AS match_id
          FROM scrims
          CROSS JOIN LATERAL jsonb_array_elements(matches) AS match_entry
          WHERE assignment_type = 'team'
            AND team_slug = $1
            AND match_entry->>'matchId' IS NOT NULL
        ),
        metadata_matches AS (
          SELECT match_id
          FROM matches
          WHERE COALESCE(raw_json->'__ingestMeta'->'teamSlugs', '[]'::jsonb) ? $1
             OR raw_json->'__ingestMeta'->>'teamSlug' = $1
        )
        SELECT DISTINCT match_id
        FROM (
          SELECT match_id FROM scrim_matches
          UNION ALL
          SELECT match_id FROM metadata_matches
        ) assigned
        WHERE match_id IS NOT NULL AND btrim(match_id) <> ''
        `,
        [teamSlug]
      )
    : await pool.query<{ match_id: string }>(
        `
        SELECT DISTINCT match_id
        FROM matches
        WHERE COALESCE(raw_json->'__ingestMeta'->'teamSlugs', '[]'::jsonb) ? $1
           OR raw_json->'__ingestMeta'->>'teamSlug' = $1
        `,
        [teamSlug]
      );

  const assignedMatchIds = assignedMatchRows.rows
    .map((row) => String(row.match_id ?? "").trim())
    .filter(Boolean);

  if (assignedMatchIds.length < 2) return { added: 0 };

  const [rosterResult, matchPlayersResult] = await Promise.all([
    pool.query<{ steam_id: string }>(
      `
      SELECT steam_id
      FROM team_memberships
      WHERE team_id = ANY($1::text[]) AND end_at IS NULL
      `,
      [teamMembershipKeys]
    ),
    pool.query<MatchPlayerRow>(
      `
      SELECT match_id, steam_id, side
      FROM match_players
      WHERE match_id = ANY($1::text[])
      `,
      [assignedMatchIds]
    ),
  ]);

  const activeRoster = new Set(
    rosterResult.rows.map((row) => String(row.steam_id ?? "").trim()).filter(Boolean)
  );

  const byMatchSide = new Map<string, Map<string, Set<string>>>();
  for (const row of matchPlayersResult.rows) {
    const matchId = String(row.match_id ?? "").trim();
    const steamId = String(row.steam_id ?? "").trim();
    const side = String(row.side ?? "").trim();
    if (!matchId || !steamId || !side) continue;
    addToNestedMap(byMatchSide, matchId, side, steamId);
  }

  const candidates = new Set<string>();
  for (const sides of byMatchSide.values()) {
    const side = chooseSideByRoster(sides, activeRoster);
    if (!side) continue;

    for (const steamId of sides.get(side) ?? []) {
      candidates.add(steamId);
    }
  }

  if (candidates.size === 0) {
    for (const steamId of chooseFallbackCandidates(matchPlayersResult.rows)) {
      candidates.add(steamId);
    }
  }

  const steamIdsToAdd = [...candidates].filter((steamId) => steamId && !activeRoster.has(steamId));
  if (steamIdsToAdd.length === 0) return { added: 0 };

  const insertResult = await pool.query(
    `
    INSERT INTO team_memberships (team_id, steam_id, role, start_at)
    SELECT $1, candidate.steam_id, 'player', now()
    FROM unnest($2::text[]) AS candidate(steam_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM team_memberships existing
      WHERE existing.team_id = ANY($3::text[])
        AND existing.steam_id = candidate.steam_id
        AND existing.end_at IS NULL
    )
    `,
    [teamSlug, steamIdsToAdd, teamMembershipKeys]
  );

  return { added: insertResult.rowCount ?? 0 };
}
