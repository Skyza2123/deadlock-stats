WITH ranked AS (
  SELECT ctid,
         ROW_NUMBER() OVER (
           PARTITION BY team_id, steam_id
           ORDER BY COALESCE(start_at, to_timestamp(0)) DESC
         ) AS rn
  FROM team_memberships
  WHERE end_at IS NULL
)
UPDATE team_memberships tm
SET end_at = now()
FROM ranked r
WHERE tm.ctid = r.ctid
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS team_memberships_one_active_idx
ON team_memberships (team_id, steam_id)
WHERE end_at IS NULL;
