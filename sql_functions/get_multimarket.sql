-- get_multimarket(p_user_id uuid)
--
-- Returns the caller's pinned markets. Odds are NOT included: they live in
-- the external sports API (cached in Redis) and are streamed separately via
-- WebSocket. Names (sport / competition / event / market) are read from the
-- user_multimarkets row itself — they're cached there at pin time so the
-- /multimarket page can render even if a parent row is later removed. The
-- live `is_active` / `suspended` flags are joined from `events` for freshness.
--
-- Output: jsonb array, most-recently-pinned first.

CREATE OR REPLACE FUNCTION get_multimarket(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'multimarketId',   um.id,
        'marketId',        um.market_id,
        'marketName',      um.market_name,
        'marketType',      um.market_type,
        'eventId',         um.event_id,
        'eventName',       um.event_name,
        'openDate',        um.open_date,
        'isActive',        COALESCE(e.is_active, true),
        'suspended',       COALESCE(e.suspended, false),
        'competitionId',   um.competition_id,
        'competitionName', um.competition_name,
        'sportId',         um.sport_id,
        'sportName',       um.sport_name,
        'addedDate',       um.added_date
      )
      ORDER BY um.added_date DESC
    ),
    '[]'::jsonb
  )
  FROM user_multimarkets um
  LEFT JOIN events e ON e.event_id = um.event_id
  WHERE um.user_id       = p_user_id
    AND um.record_status = 0;
$$;
