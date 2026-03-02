CREATE TABLE "match_player_items" (
	"match_id" text NOT NULL,
	"steam_id" text NOT NULL,
	"game_time_s" integer NOT NULL,
	"item_id" integer NOT NULL,
	"upgrade_id" integer,
	"sold_time_s" integer,
	"flags" integer,
	"imbued_ability_id" integer,
	CONSTRAINT "match_player_items_match_id_steam_id_game_time_s_item_id_pk" PRIMARY KEY("match_id","steam_id","game_time_s","item_id")
);
--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "net_worth" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "last_hits" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "denies" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "level" integer;--> statement-breakpoint
CREATE INDEX "mpi_match_idx" ON "match_player_items" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "mpi_player_idx" ON "match_player_items" USING btree ("steam_id");