-- fn_get_matches_with_default_markets(
--     p_event_type_id bigint,
--     p_whitelabel_id uuid,
--     p_user_id       uuid
-- )
--
-- Powers the CricketMatchesList (and its football/tennis/etc. twins): a FLAT
-- list of every visible match for a sport, with the competition it belongs to,
-- the market_id the list should show odds for, and the signed-in user's
-- matched bet count on that match. Odds are streamed over the /ws/markets
-- WebSocket — this function returns structural + per-user count data only.
--
-- Why a separate function (vs. flattening fn_get_series_with_matches on the
-- client): the list only needs matches with a default_market_id; filtering
-- that on the DB side skips events that would be dropped anyway, and bundling
-- betCount into the same round trip eliminates the old /sports/bet-counts
-- follow-up REST call.
--
-- Logic matches fn_get_series_with_matches:
--   * competitions.is_active = true
--   * events.is_active = true
--   * whitelabel overrides: missing row or is_active = true => visible
--   * events.default_market_id IS NOT NULL (list can't render odds without it)
--   * inPlay = open_date <= now()
--   * Sort: inPlay first, then open_date ascending.
--
-- betCount:
--   * When p_user_id IS NULL (anonymous caller) => 0 for every match.
--   * Otherwise: COUNT(*) FROM transactions WHERE user_id = p_user_id AND
--     match_id = event_id — same semantics as the old GET /sports/bet-counts
--     endpoint (no status / record_status filter, to match existing behavior).
--
-- Output:
--   [
--     {
--       "id":              <event_id>,
--       "name":            "<event name>",
--       "openDate":        "2026-04-24T10:30:00.000Z" | null,
--       "status":          "OPEN",
--       "inPlay":          true|false,
--       "defaultMarketId": "<market id>",
--       "seriesId":        <competition_id>,
--       "seriesName":      "<competition name>",
--       "betCount":        <int>
--     }, ...
--   ]

CREATE OR REPLACE FUNCTION fn_get_matches_with_default_markets(
  p_event_type_id  bigint,
  p_whitelabel_id  uuid DEFAULT NULL,
  p_user_id        uuid DEFAULT NULL
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
  visible_matches AS (
    SELECT
      e.event_id,
      e.name              AS event_name,
      e.open_date,
      e.default_market_id,
      vc.competition_id,
      vc.name             AS competition_name,
      (e.open_date IS NOT NULL AND e.open_date <= now()) AS in_play
    FROM events e
    JOIN visible_competitions vc
      ON vc.competition_id = e.competition_id
    LEFT JOIN event_whitelabel_overrides ewo
      ON ewo.event_id      = e.event_id
     AND ewo.whitelabel_id = p_whitelabel_id
    WHERE e.is_active = true
      AND e.default_market_id IS NOT NULL
      AND (
        p_whitelabel_id IS NULL
        OR COALESCE(ewo.is_active, true) = true
      )
  ),
  -- Bet counts per match for the signed-in user. Skipped entirely when
  -- anonymous (p_user_id IS NULL) so we don't scan transactions needlessly.
  user_bet_counts AS (
    SELECT
      t.match_id,
      COUNT(*)::int AS cnt
    FROM transactions t
    WHERE p_user_id IS NOT NULL
      AND t.user_id = p_user_id
      AND t.match_id IN (SELECT event_id FROM visible_matches)
    GROUP BY t.match_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',              vm.event_id,
        'name',            vm.event_name,
        'openDate',
          CASE
            WHEN vm.open_date IS NULL THEN NULL
            ELSE to_char(vm.open_date, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          END,
        'status',          'OPEN',
        'inPlay',          vm.in_play,
        'defaultMarketId', vm.default_market_id,
        'seriesId',        vm.competition_id,
        'seriesName',      vm.competition_name,
        'betCount',        COALESCE(ubc.cnt, 0)
      )
      ORDER BY
        vm.in_play DESC,
        vm.open_date NULLS LAST,
        vm.event_id
    ),
    '[]'::jsonb
  )
  FROM visible_matches vm
  LEFT JOIN user_bet_counts ubc
    ON ubc.match_id = vm.event_id;
$$;
