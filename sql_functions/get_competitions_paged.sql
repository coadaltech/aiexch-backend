-- fn_get_competitions_paged(p_sport_id, p_whitelabel_id, p_is_owner, p_search, p_limit, p_offset)
--
-- Owner panel: paged list of competitions for one sport, with the count of
-- events (matches) for each competition. Used by the per-sport "Competitions"
-- screen, which previously loaded ALL competitions in one shot and showed
-- "0 events" because the count was never computed.
--
-- Behavior (matches getCompetitionsWithOverrides + adds count + paging):
--   * Owner (p_is_owner = true): every competition for the sport.
--   * Non-owner: only globally-active competitions (is_active = true).
--   * If p_whitelabel_id is non-null, the per-whitelabel override row is
--     joined in and exposed as `whitelabelActive` (NULL override -> true).
--   * Optional case-insensitive name search (p_search).
--   * Sorted by event_count DESC, then by name ASC.
--   * Paginated with LIMIT/OFFSET.
--
-- Returns: jsonb { totalCount: number, items: [...] }
--   items[i] shape mirrors the old service output, plus `eventCount`.

CREATE OR REPLACE FUNCTION fn_get_competitions_paged(
  p_sport_id       bigint,
  p_whitelabel_id  uuid    DEFAULT NULL,
  p_is_owner       boolean DEFAULT false,
  p_search         text    DEFAULT NULL,
  p_limit          int     DEFAULT 50,
  p_offset         int     DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH event_counts AS (
    SELECT e.competition_id, COUNT(*)::bigint AS event_count
    FROM events e
    JOIN competitions c ON c.competition_id = e.competition_id
    WHERE c.sport_id = p_sport_id
    GROUP BY e.competition_id
  ),
  base AS (
    SELECT
      c.id,
      c.competition_id,
      c.sport_id,
      c.name,
      c.provider,
      c.is_active,
      c.is_top_competition,
      c.is_archived,
      c.metadata,
      cwo.is_active AS whitelabel_active_raw,
      COALESCE(ec.event_count, 0) AS event_count
    FROM competitions c
    LEFT JOIN competition_whitelabel_overrides cwo
      ON cwo.competition_id = c.competition_id
     AND cwo.whitelabel_id  = p_whitelabel_id
    LEFT JOIN event_counts ec
      ON ec.competition_id = c.competition_id
    WHERE c.sport_id = p_sport_id
      AND (p_is_owner OR c.is_active = true)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR c.name ILIKE '%' || p_search || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS total FROM base
  ),
  paged AS (
    SELECT *
    FROM base
    ORDER BY event_count DESC, name ASC
    LIMIT  GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'totalCount', (SELECT total FROM counted),
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',                 p.id,
          'competition_id',     p.competition_id,
          'sport_id',           p.sport_id,
          'name',               p.name,
          'provider',           p.provider,
          'is_active',          p.is_active,
          'is_top_competition', p.is_top_competition,
          'is_archived',        p.is_archived,
          'metadata',           p.metadata,
          'whitelabelActive',   COALESCE(p.whitelabel_active_raw, true),
          'eventCount',         p.event_count
        )
        ORDER BY p.event_count DESC, p.name ASC
      ),
      '[]'::jsonb
    )
  )
  FROM paged p;
$$;
