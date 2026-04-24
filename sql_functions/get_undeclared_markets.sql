-- fn_get_undeclared_markets(p_market_types int[])
--
-- Powers the MarketResultCronService (src/services/market-result-cron-service.ts).
-- Returns every distinct market that still has at least one matched bet but
-- has NOT been declared/voided/rolled-back yet — enriched with the sport,
-- competition, and event names the result-processing loop needs for logging
-- and for passing into declare_process.
--
-- Logic matches the old TypeScript flow exactly:
--   1. GROUP BY transactions WHERE status='matched' AND market_type IN p_market_types
--   2. Exclude any marketId that already has a row in market_results whose
--      status != 'PENDING'  (so PENDING placeholders still get retried).
--   3. LEFT JOIN sports / competitions / events to get display names
--      (missing name => empty string, matching the old `?? ""` fallback).
--
-- Output columns — match the UndeclaredMarket TypeScript shape:
--   market_id        numeric
--   match_id         bigint
--   event_type_id    bigint
--   competition_id   bigint      (nullable)
--   market_type      int
--   market_name      varchar     (nullable)
--   event_type_name  varchar
--   competition_name varchar
--   event_name       varchar
--
-- Replaces: 1 GROUP BY query + 1 market_results lookup + 3 parallel name
-- lookups + 3 JS-side Maps — all collapsed into one SQL round trip.

CREATE OR REPLACE FUNCTION fn_get_undeclared_markets(
  p_market_types int[]
)
RETURNS TABLE (
  market_id        numeric,
  match_id         bigint,
  event_type_id    bigint,
  competition_id   bigint,
  market_type      int,
  market_name      varchar(255),
  event_type_name  varchar(100),
  competition_name varchar(200),
  event_name       varchar(255)
)
LANGUAGE sql
STABLE
AS $$
  WITH unsettled AS (
    -- Every distinct (marketId, matchId, ...) tuple that has at least one
    -- matched bet for the requested market types.
    SELECT
      t.market_id,
      t.match_id,
      t.event_type_id,
      t.competition_id,
      t.market_type,
      t.market_name
    FROM transactions t
    WHERE t.status = 'matched'
      AND t.market_type = ANY(p_market_types)
    GROUP BY
      t.market_id,
      t.match_id,
      t.event_type_id,
      t.competition_id,
      t.market_type,
      t.market_name
  ),
  already_declared AS (
    -- Markets whose result is already recorded as anything but PENDING.
    -- PENDING placeholders are retried — matches the old `ne(status, 'PENDING')`.
    SELECT mr.market_id
    FROM market_results mr
    WHERE mr.market_id IN (SELECT market_id FROM unsettled)
      AND mr.status <> 'PENDING'
  )
  SELECT
    u.market_id,
    u.match_id,
    u.event_type_id,
    u.competition_id,
    u.market_type,
    u.market_name,
    COALESCE(s.name, '')::varchar(100) AS event_type_name,
    COALESCE(c.name, '')::varchar(200) AS competition_name,
    COALESCE(e.name, '')::varchar(255) AS event_name
  FROM unsettled u
  LEFT JOIN sports       s ON s.sport_id       = u.event_type_id
  LEFT JOIN competitions c ON c.competition_id = u.competition_id
  LEFT JOIN events       e ON e.event_id       = u.match_id
  WHERE u.market_id NOT IN (SELECT market_id FROM already_declared);
$$;
