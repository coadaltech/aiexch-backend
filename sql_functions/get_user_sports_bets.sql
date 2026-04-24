-- fn_get_user_sports_bets(
--     p_user_id uuid,
--     p_status  text,          -- 'all' | 'matched' | 'won' | 'lost' | 'cancelled' | 'void' | 'pending'
--     p_limit   int,
--     p_offset  int
-- )
--
-- Returns the signed-in user's sports bets (transactions) with every field
-- the existing frontend consumers read:
--
--   BetSlip  (components/sports/bet-slip.tsx)
--     id, matchId, status, marketType (STRING), odds, selectionName,
--     marketName, stake, betType, details[].isUserSelection, details[].run
--
--   Bet history page (app/(main)/profile/bet-history/page.tsx)
--     id, status, addedDate, sportName, selectionName, eventName,
--     marketName, odds, stake, betType
--
-- The payload shape is 1:1 with what the old /betting/my-bets route produced
-- (which did `...t` spread on a Drizzle .select() result, i.e. camelCase
-- keys). We keep all transaction columns + enrichment fields so nothing else
-- downstream breaks.
--
-- Replaces the route's old flow:
--   1 SELECT transactions
--   1 SELECT transaction_details  (IN list)
--   3 parallel SELECTs for sport / competition / event names
--   JS-side detailsMap + sportMap/competitionMap/eventMap join
--
-- Logic matches the old endpoint exactly:
--   * p_status = 'all'  => no status filter; any other value => exact match.
--   * ORDER BY added_date DESC (newest first).
--   * LIMIT / OFFSET honored.
--   * marketType is returned as the same string the frontend already branches
--     on ("fancy" = 4, "bookmaker" = 3, ...).

CREATE OR REPLACE FUNCTION fn_get_user_sports_bets(
  p_user_id uuid,
  p_status  text DEFAULT 'all',
  p_limit   int  DEFAULT 50,
  p_offset  int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH paged AS (
    SELECT t.*
    FROM transactions t
    WHERE t.user_id = p_user_id
      AND (p_status = 'all' OR t.status = p_status)
    ORDER BY t.added_date DESC
    LIMIT  GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0)
  ),
  bet_details AS (
    SELECT
      td.transaction_id,
      jsonb_agg(
        jsonb_build_object(
          'id',               td.id,
          'transactionId',    td.transaction_id,
          'runnerId',         td.runner_id,
          'runnerName',       td.runner_name,
          'isUserSelection',  td.is_user_selection,
          'betType',          td.bet_type,
          'basePrice',        td.base_price,
          'price',            td.price,
          'run',              td.run,
          'stake',            td.stake,
          'potentialReturn',  td.potential_return,
          'addedBy',          td.added_by,
          'addedDate',        td.added_date,
          'updateBy',         td.update_by,
          'updateDate',       td.update_date,
          'recordStatus',     td.record_status
        )
        ORDER BY td.added_date
      ) AS rows
    FROM transaction_details td
    WHERE td.transaction_id IN (SELECT id FROM paged)
    GROUP BY td.transaction_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        -- ── transaction columns (camelCase, matching Drizzle's mapping) ──
        'id',                p.id,
        'userId',            p.user_id,
        'whitelabelId',      p.whitelabel_id,
        'eventTypeId',       p.event_type_id,
        'competitionId',     p.competition_id,
        'matchId',           p.match_id,
        'marketId',          p.market_id,
        'marketName',        p.market_name,
        -- marketType returned as STRING (the frontend checks === 'fancy')
        'marketType',        CASE p.market_type
                               WHEN 0 THEN 'match_odds'
                               WHEN 1 THEN 'tied_match'
                               WHEN 2 THEN 'complete_match'
                               WHEN 3 THEN 'bookmaker'
                               WHEN 4 THEN 'fancy'
                               ELSE        'match_odds'
                             END,
        'selectionId',       p.selection_id,
        'selectionName',     p.selection_name,
        'betType',           p.bet_type,
        'stake',             p.stake,
        'odds',              p.odds,
        'status',            p.status,
        'settledAmount',     p.settled_amount,
        'ipAddress',         p.ip_address,
        'matchedAt',         p.matched_at,
        'settledAt',         p.settled_at,
        'cancelledAt',       p.cancelled_at,
        'resultCheckedAt',   p.result_checked_at,
        'addedBy',           p.added_by,
        'addedDate',         p.added_date,
        'updateBy',          p.update_by,
        'updateDate',        p.update_date,
        'recordStatus',      p.record_status,
        -- ── Enrichment fields ──
        'details',           COALESCE(bd.rows, '[]'::jsonb),
        'sportName',         s.name,
        'competitionName',   c.name,
        'eventName',         e.name
      )
      ORDER BY p.added_date DESC
    ),
    '[]'::jsonb
  )
  FROM paged p
  LEFT JOIN bet_details bd ON bd.transaction_id = p.id
  LEFT JOIN sports       s ON s.sport_id        = p.event_type_id
  LEFT JOIN competitions c ON c.competition_id  = p.competition_id
  LEFT JOIN events       e ON e.event_id        = p.match_id;
$$;
