import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  jsonb,
  primaryKey,
  index,
  bigserial,
} from "drizzle-orm/pg-core";

// TEAMS
export const teams = pgTable("teams", {
  teamId: bigserial("team_id", { mode: "number" }).primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PLAYERS (SteamID as TEXT to avoid JS bigint issues)
export const players = pgTable("players", {
  steamId: text("steam_id").primaryKey(),

  // from steam-search
  displayName: text("display_name"),
  profileUrl: text("profile_url"),
  avatar: text("avatar"),
  avatarMedium: text("avatar_medium"),
  avatarFull: text("avatar_full"),
  realName: text("real_name"),
  countryCode: text("country_code"),
  lastUpdated: integer("last_updated"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ROSTER HISTORY
export const teamMemberships = pgTable(
  "team_memberships",
  {
    teamId: text("team_id").notNull(), // we'll reference teams via id, but keep simple for v1
    steamId: text("steam_id").notNull(),
    role: text("role"),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.steamId, t.startAt] }),
    teamIdx: index("team_memberships_team_idx").on(t.teamId),
  })
);

// MATCHES
export const matches = pgTable("matches", {
  matchId: text("match_id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  scrimDate: timestamp("scrim_date", { withTimezone: true }),
  map: text("map"),
  rawJson: jsonb("raw_json").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  saved: integer("saved").default(0),
});

// MATCH_PLAYERS
export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: text("match_id").notNull(),
    steamId: text("steam_id").notNull(),
    side: text("side"),
    heroId: text("hero_id"),
    kills: integer("kills"),
    deaths: integer("deaths"),
    assists: integer("assists"),
    rawJson: jsonb("raw_json"),
    netWorth: integer("net_worth"),     // souls/gold
    lastHits: integer("last_hits"),
    denies: integer("denies"),
    level: integer("level"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchId, t.steamId] }),
    matchIdx: index("match_players_match_idx").on(t.matchId),
    playerIdx: index("match_players_player_idx").on(t.steamId),
  })
);

export const matchPlayerItems = pgTable(
  "match_player_items",
  {
    matchId: text("match_id").notNull(),
    steamId: text("steam_id").notNull(),

    gameTimeS: integer("game_time_s").notNull(),

    // IMPORTANT: item ids can be > 2,147,483,647 so they must be BIGINT
    itemId: bigint("item_id", { mode: "number" }).notNull(),
    upgradeId: bigint("upgrade_id", { mode: "number" }),

    soldTimeS: integer("sold_time_s"),
    flags: integer("flags"),

    imbuedAbilityId: bigint("imbued_ability_id", { mode: "number" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchId, t.steamId, t.gameTimeS, t.itemId] }),
    matchIdx: index("mpi_match_idx").on(t.matchId),
    playerIdx: index("mpi_player_idx").on(t.steamId),
  })
);

// AUTH: USERS
export const appUsers = pgTable("app_users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// AUTH: INVITE CODES (store hash, not plaintext)
export const inviteCodes = pgTable("invite_codes", {
  codeHash: text("code_hash").primaryKey(),

  teamId: bigserial("team_id", { mode: "number" }).notNull(), // ← change (see note below)
  // If you keep team_memberships.teamId as TEXT, use: text("team_id").notNull()

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  note: text("note"),
});