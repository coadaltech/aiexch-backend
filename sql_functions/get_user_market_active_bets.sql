-- fn_get_user_market_active_bets(
--     p_user_id   uuid,
--     p_market_id numeric
-- )
--
-- Returns the user's currently-active (status = 'matched', record_status = 0)
-- bets on a single sports market, joined with their transaction_details (the
-- per-runner row that captured what the user actually clicked) and the
-- transaction_logs row (IP / device).
--
-- Used by the "Exposure Usage" modal: when the user clicks a sports row, we
-- show the bets making up that exposure for the given market.
--
-- Output:
--   {
--     "market": {
--       "marketId": <numeric>,
--       "marketName": "<string>" | null,
--       "marketType": "match_odds" | "tied_match" | "complete_match" | "bookmaker" | "fancy",
--       "sportName": "<string>" | null,
--       "competitionName": "<string>" | null,
--       "eventName": "<string>" | null
--     } | null,
--     "bets": [
--       {
--         "transactionId":  <uuid>,
--         "status":         "matched",
--         "selectionName":  "<string>",
--         "betType":        0 | 1,        -- 0 = back, 1 = lay
--         "odds":           <decimal>,
--         "stake":          <decimal>,
--         "addedDate":      "<ISO timestamp>",
--         "matchedAt":      "<ISO timestamp>" | null,
--         "runnerId":       <bigint>,
--         "runnerName":     "<string>" | null,
--         "isUserSelection":true,
--         "price":          <decimal>,
--         "run":            <int> | null,
--         "potentialReturn":<decimal>,
--         "log": {
--           "ipAddress":      "<string>" | null,
--           "userAgent":      "<string>" | null,
--           "browser":        "<string>" | null,
--           "browserVersion": "<string>" | null,
--           "os":             "<string>" | null,
--           "osVersion":      "<string>" | null,
--           "deviceType":     "<string>" | null,
--           "deviceBrand":    "<string>" | null,
--           "deviceModel":    "<string>" | null,
--           "country":        "<string>" | null,
--           "city":           "<string>" | null
--         }
--       }, ...
--     ],
--     "summary": {
--       "totalBets":   <int>,
--       "totalStake":  <decimal>
--     }
--   }

CREATE OR REPLACE FUNCTION fn_get_user_market_active_bets(
  p_user_id   uuid,
  p_market_id numeric
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH user_txns AS (
    SELECT t.*
    FROM transactions t
    WHERE t.user_id       = p_user_id
      AND t.market_id     = p_market_id
      AND t.status        = 'matched'
      AND t.record_status = 0
  )
  SELECT jsonb_build_object(
    'market', (
      SELECT jsonb_build_object(
        'marketId',        ut.market_id,
        'marketName',      ut.market_name,
        'marketType',      CASE ut.market_type
                             WHEN 0 THEN 'match_odds'
                             WHEN 1 THEN 'tied_match'
                             WHEN 2 THEN 'complete_match'
                             WHEN 3 THEN 'bookmaker'
                             WHEN 4 THEN 'fancy'
                             ELSE        'match_odds'
                           END,
        'sportName',       s.name,
        'competitionName', c.name,
        'eventName',       e.name
      )
      FROM user_txns ut
      LEFT JOIN sports       s ON s.sport_id        = ut.event_type_id
      LEFT JOIN competitions c ON c.competition_id  = ut.competition_id
      LEFT JOIN events       e ON e.event_id        = ut.match_id
      LIMIT 1
    ),
    'bets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'transactionId',   ut.id,
          'status',          ut.status,
          'selectionName',   ut.selection_name,
          'betType',         ut.bet_type,
          'odds',            ut.odds,
          'stake',           ut.stake,
          'addedDate',       ut.added_date,
          'matchedAt',       ut.matched_at,
          'runnerId',        td.runner_id,
          'runnerName',      td.runner_name,
          'isUserSelection', td.is_user_selection,
          'price',           td.price,
          'run',             td.run,
          'potentialReturn', td.potential_return,
          'log', jsonb_build_object(
            'ipAddress',      tl.ip_address,
            'userAgent',      tl.user_agent,
            'browser',        tl.browser,
            'browserVersion', tl.browser_version,
            'os',             tl.os,
            'osVersion',      tl.os_version,
            'deviceType',     tl.device_type,
            'deviceBrand',    tl.device_brand,
            'deviceModel',    tl.device_model,
            'country',        tl.country,
            'city',           tl.city
          )
        )
        ORDER BY ut.added_date DESC
      )
      FROM user_txns ut
      INNER JOIN transaction_details td
              ON td.transaction_id    = ut.id
             AND td.is_user_selection = TRUE
             AND td.record_status     = 0
      LEFT JOIN transaction_logs tl
              ON tl.transaction_id   = ut.id
             AND tl.record_status    = 0
    ), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'totalBets',  COUNT(*),
        'totalStake', COALESCE(SUM(ut.stake), 0)
      )
      FROM user_txns ut
    )
  );
$$;
