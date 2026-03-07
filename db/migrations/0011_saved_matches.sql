CREATE TABLE IF NOT EXISTS saved_matches (
  steam_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (steam_id, match_id)
);

CREATE INDEX IF NOT EXISTS saved_matches_steam_created_idx
ON saved_matches (steam_id, created_at DESC);
