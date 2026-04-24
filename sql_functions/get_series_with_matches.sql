-- fn_get_series_with_matches(p_event_type_id bigint, p_whitelabel_id uuid)
--
-- Returns competitions (series) and their events (matches) for a given sport
-- in a single query. Replaces the old backend flow:
--     getSeriesList()  ->  Promise.all(series.map(getEventsFromDb))
-- which fired 1 + N DB queries. This function does it in one.
--
-- Logic (kept identical to the old service):
--   * Competitions: sport_id = p_event_type_id AND is_active = true.
--     If p_whitelabel_id is provided, exclude competitions whose
--     competition_whitelabel_overrides row has is_active = false.
--     NULL override => treat as visible.
--   * Events: competition_id IN (visible competitions) AND is_active = true.
--     Same whitelabel override rule on event_whitelabel_overrides.
--   * Order: competitions by name ASC.
--   * Event shape matches old getEventsFromDb output (id, name, openDate,
--     status = 'OPEN', inPlay, defaultMarketId). openDate is ISO-8601 UTC
--     with milliseconds and trailing Z, same as JS Date#toISOString().
--   * inPlay is true when openDate <= now() (same "has started" heuristic).
--
-- Output shape (matches old getSeriesWithMatches):
--   [
--     {
--       "id": <competition_id>,
--       "name": "<competition name>",
--       "eventTypeId": "<sport_id as string>",
--       "matches": [
--         {
--           "id": <event_id>,
--           "name": "<event name>",
--           "openDate": "2026-04-24T10:30:00.000Z" | null,
--           "status": "OPEN",
--           "inPlay": true|false,
--           "defaultMarketId": "..." | null
--         }, ...
--       ]
--     }, ...
--   ]

CREATE OR REPLACE FUNCTION fn_get_series_with_matches(
  p_event_type_id  bigint,
  p_whitelabel_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH visible_competitions AS (
    SELECT
      c.competition_id,
      c.name
    FROM competitions c
    LEFT JOIN competition_whitelabel_overrides cwo
      ON cwo.competition_id = c.competition_id
     AND cwo.whitelabel_id  = p_whitelabel_id
    WHERE c.sport_id  = p_event_type_id
      AND c.is_active = true
      AND (
        p_whitelabel_id IS NULL
        OR COALESCE(cwo.is_active, true) = true
      )
  ),
  visible_events AS (
    SELECT
      e.competition_id,
      e.event_id,
      e.name,
      e.open_date,
      e.default_market_id
    FROM events e
    JOIN visible_competitions vc
      ON vc.competition_id = e.competition_id
    LEFT JOIN event_whitelabel_overrides ewo
      ON ewo.event_id      = e.event_id
     AND ewo.whitelabel_id = p_whitelabel_id
    WHERE e.is_active = true
      AND (
        p_whitelabel_id IS NULL
        OR COALESCE(ewo.is_active, true) = true
      )
  ),
  matches_per_competition AS (
    SELECT
      ve.competition_id,
      jsonb_agg(
        jsonb_build_object(
          'id',              ve.event_id,
          'name',            ve.name,
          'openDate',
            CASE
              WHEN ve.open_date IS NULL THEN NULL
              ELSE to_char(ve.open_date, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            END,
          'status',          'OPEN',
          'inPlay',          (ve.open_date IS NOT NULL AND ve.open_date <= now()),
          'defaultMarketId', ve.default_market_id
        )
        ORDER BY ve.open_date NULLS LAST, ve.event_id
      ) AS matches
    FROM visible_events ve
    GROUP BY ve.competition_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',          vc.competition_id,
        'name',        vc.name,
        'eventTypeId', p_event_type_id::text,
        'matches',     COALESCE(mpc.matches, '[]'::jsonb)
      )
      ORDER BY vc.name
    ),
    '[]'::jsonb
  )
  FROM visible_competitions vc
  LEFT JOIN matches_per_competition mpc
    ON mpc.competition_id = vc.competition_id;
$$;
