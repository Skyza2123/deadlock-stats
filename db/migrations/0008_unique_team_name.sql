CREATE UNIQUE INDEX IF NOT EXISTS teams_name_unique_idx ON teams (lower(name));
