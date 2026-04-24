-- fn_get_live_markets_summary(p_user_id uuid, p_user_role int)
--
-- Powers the admin page /owner/live-markets/summary. Returns one row per
-- (market, runner) with the logged-in owner's share of P&L and the meta the
-- UI needs to group rows into sport / match / market cards.
--
-- P&L math lives in the existing helpers:
--     public.get_hissa_of_group        — non-fancy, per runner
--     public.get_hissa_of_group_fancy  — fancy, one row per market (no runner_id)
-- This function unions those two and folds in the enrichment the route used
-- to do inline (event / competition / team / runner names), so the route
-- becomes a single `SELECT * FROM fn_get_live_markets_summary(...)`.
--
-- Column shape matches the old inline query 1:1 (snake_case, same order) —
-- the frontend reads `row.market_id`, `row.runner_id`, `row.pnl`,
-- `row.runner_name`, `row.event_type_id`, `row.match_id`, `row.market_name`,
-- `row.market_type`, `row.competition_id`, `row.event_name`,
-- `row.competition_name`.

CREATE OR REPLACE FUNCTION fn_get_live_markets_summary(
  p_user_id   uuid,
  p_user_role int
)
RETURNS TABLE (
  market_id        numeric,
  runner_id        bigint,
  pnl              numeric,
  runner_name      varchar(255),
  event_type_id    bigint,
  match_id         bigint,
  market_name      varchar(255),
  market_type      int,
  competition_id   bigint,
  event_name       text,
  competition_name varchar(200)
)
LANGUAGE sql
STABLE
AS $$
  WITH
  -- All non-fancy runner rows (per runner, no aggregation)
  non_fancy_pnl AS (
    SELECT h.market_id, h.runner_id, h.runner_profit AS pnl
    FROM public.get_hissa_of_group(p_user_id, NULL::numeric, p_user_role) h
  ),
  -- Fancy markets (one row per market; no runner_id)
  fancy_pnl AS (
    SELECT h.market_id, NULL::bigint AS runner_id, h.runner_profit AS pnl
    FROM public.get_hissa_of_group_fancy(p_user_id, NULL::numeric, p_user_role) h
  ),
  all_pnl AS (
    SELECT market_id, runner_id, pnl FROM non_fancy_pnl
    UNION ALL
    SELECT market_id, runner_id, pnl FROM fancy_pnl
  ),
  -- Market / event / competition meta, one row per market_id from transactions
  market_meta AS (
    SELECT DISTINCT ON (t.market_id)
      t.market_id,
      t.event_type_id,
      t.match_id,
      t.market_name,
      t.market_type,
      t.competition_id,
      e.name  AS event_name,
      c.name  AS competition_name
    FROM transactions t
    LEFT JOIN events       e ON e.event_id        = t.match_id
    LEFT JOIN competitions c ON c.competition_id  = t.competition_id
    WHERE t.status = 'matched'
      AND COALESCE(t.record_status, 0) = 0
    ORDER BY t.market_id
  ),
  -- Fallback event label "TeamA v TeamB" when events.name isn't set
  match_teams AS (
    SELECT
      t.match_id,
      string_agg(DISTINCT t.selection_name, ' v ') AS team_names
    FROM transactions t
    WHERE t.market_type = 0
      AND t.selection_name IS NOT NULL
      AND t.selection_name <> ''
      AND COALESCE(t.record_status, 0) = 0
    GROUP BY t.match_id
  ),
  -- Runner names keyed by (market_id, runner_id) — pulled from the bet details
  runner_names AS (
    SELECT DISTINCT ON (t.market_id, td.runner_id)
      t.market_id,
      td.runner_id,
      td.runner_name
    FROM transaction_details td
    JOIN transactions t ON t.id = td.transaction_id
    WHERE t.status = 'matched'
      AND COALESCE(t.record_status, 0)  = 0
      AND COALESCE(td.record_status, 0) = 0
      AND td.runner_name IS NOT NULL
      AND td.runner_name <> ''
    ORDER BY t.market_id, td.runner_id
  )
  SELECT
    p.market_id,
    p.runner_id,
    p.pnl,
    r.runner_name,
    m.event_type_id,
    m.match_id,
    m.market_name,
    m.market_type,
    m.competition_id,
    COALESCE(m.event_name::text, mt.team_names) AS event_name,
    m.competition_name
  FROM all_pnl p
  LEFT JOIN market_meta  m  ON m.market_id = p.market_id
  LEFT JOIN runner_names r  ON r.market_id = p.market_id
                           AND r.runner_id = p.runner_id
  LEFT JOIN match_teams  mt ON mt.match_id = m.match_id
  ORDER BY m.match_id NULLS LAST, p.market_id, p.runner_id NULLS LAST;
$$;
