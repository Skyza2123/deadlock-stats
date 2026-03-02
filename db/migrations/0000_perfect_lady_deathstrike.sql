CREATE TABLE "match_players" (
	"match_id" text NOT NULL,
	"steam_id" text NOT NULL,
	"side" text,
	"hero_id" text,
	"kills" integer,
	"deaths" integer,
	"assists" integer,
	"raw_json" jsonb,
	CONSTRAINT "match_players_match_id_steam_id_pk" PRIMARY KEY("match_id","steam_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"map" text,
	"raw_json" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"team_id" text NOT NULL,
	"steam_id" text NOT NULL,
	"role" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	CONSTRAINT "team_memberships_team_id_steam_id_start_at_pk" PRIMARY KEY("team_id","steam_id","start_at")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"team_id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "match_players_match_idx" ON "match_players" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_players_player_idx" ON "match_players" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "team_memberships_team_idx" ON "team_memberships" USING btree ("team_id");