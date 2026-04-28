-- fn_get_events_paged(p_competition_id, p_whitelabel_id, p_is_owner, p_search, p_limit, p_offset)
--
-- Owner panel: paged list of events for one competition. Used by the
-- per-competition "Events" screen. Mirrors getEventsWithOverrides but adds
-- search + LIMIT/OFFSET so we never load every event in a single call.
--
-- Behavior:
--   * Owner (p_is_owner = true): every event for the competition.
--   * Non-owner: only globally-active events (is_active = true).
--   * If p_whitelabel_id is non-null, the per-whitelabel override row is
--     joined in and exposed as `whitelabelActive` (NULL override -> true).
--   * Optional case-insensitive name search (p_search).
--   * Sort: active first (per role), then by openDate ASC NULLS LAST,
--     then by event_id (stable tiebreak).
--   * Paginated with LIMIT/OFFSET.
--
-- Returns: jsonb { totalCount: number, items: [...] }
--   items[i] shape mirrors the old service output for events.

CREATE OR REPLACE FUNCTION fn_get_events_paged(
  p_competition_id bigint,
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
  WITH base AS (
    SELECT
      e.id,
      e.event_id,
      e.competition_id,
      e.sport_id,
      e.name,
      e.open_date,
      e.is_active,
      e.is_visible,
      e.is_recommended,
      e.suspended,
      e.default_market_id,
      e.metadata,
      ewo.is_active AS whitelabel_active_raw
    FROM events e
    LEFT JOIN event_whitelabel_overrides ewo
      ON ewo.event_id      = e.event_id
     AND ewo.whitelabel_id = p_whitelabel_id
    WHERE e.competition_id = p_competition_id
      AND (p_is_owner OR e.is_active = true)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR e.name ILIKE '%' || p_search || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS total FROM base
  ),
  paged AS (
    SELECT
      b.*,
      CASE
        WHEN p_is_owner THEN b.is_active
        ELSE COALESCE(b.whitelabel_active_raw, true)
      END AS effective_active
    FROM base b
    ORDER BY
      CASE
        WHEN p_is_owner THEN b.is_active
        ELSE COALESCE(b.whitelabel_active_raw, true)
      END DESC,
      b.open_date ASC NULLS LAST,
      b.event_id ASC
    LIMIT  GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'totalCount', (SELECT total FROM counted),
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',              p.id,
          'eventId',         p.event_id,
          'competitionId',   p.competition_id,
          'sportId',         p.sport_id,
          'name',            p.name,
          'openDate',
            CASE
              WHEN p.open_date IS NULL THEN NULL
              ELSE to_char(p.open_date, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            END,
          'isActive',        p.is_active,
          'isVisible',       p.is_visible,
          'isRecommended',   p.is_recommended,
          'suspended',       p.suspended,
          'defaultMarketId', p.default_market_id,
          'metadata',        p.metadata,
          'whitelabelActive', COALESCE(p.whitelabel_active_raw, true)
        )
        ORDER BY p.effective_active DESC, p.open_date ASC NULLS LAST, p.event_id ASC
      ),
      '[]'::jsonb
    )
  )
  FROM paged p;
$$;
