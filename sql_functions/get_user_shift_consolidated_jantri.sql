-- fn_get_user_shift_consolidated_jantri(
--     p_user_id  uuid,
--     p_shift_id uuid
-- )
--
-- Returns the *user's* consolidated jantri view of a single matka/jambo shift —
-- i.e. all of the user's active bets in that shift aggregated by
-- (number_type, number). Mirrors the consolidated grid the matka/transactions
-- page draws after toggling "Consolidate Jantri" on a transaction, but scoped
-- to the requesting user (which is what the Exposure Usage modal needs).
--
-- Active scope:
--   matka_transactions.user_id        = p_user_id
--   matka_transactions.shift_id       = p_shift_id
--   matka_transactions.record_status  = 0
--   matka_transaction_details.record_status = 0
--
-- Works for both Matka (sport_type = 1001) and Jambo (sport_type = 1004) —
-- the number_type values returned just differ by game (matka uses 1/2/3,
-- jambo uses 0/1/2/3 depending on rate type).
--
-- Output:
--   {
--     "shift": {
--       "shiftId":    <uuid>,
--       "shiftName":  "<string>",
--       "shiftDate":  "YYYY-MM-DD",
--       "sportType":  1001 | 1004,
--       "endTime":    "<string>",
--       "daraRate":   <decimal>,
--       "akharRate":  <decimal>,
--       "tripleRate": <decimal>
--     } | null,
--     "totals": [
--       { "numberType": 1, "number": "1",  "totalAmount": "<decimal>" },
--       { "numberType": 2, "number": "B3", "totalAmount": "<decimal>" },
--       ...
--     ],
--     "summary": {
--       "transactionCount": <int>,
--       "totalAmount":      "<decimal>",
--       "totalCommission":  "<decimal>",
--       "finalAmount":      "<decimal>"
--     }
--   }

CREATE OR REPLACE FUNCTION fn_get_user_shift_consolidated_jantri(
  p_user_id  uuid,
  p_shift_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH user_txns AS (
    SELECT mt.*
    FROM matka_transactions mt
    WHERE mt.user_id       = p_user_id
      AND mt.shift_id      = p_shift_id
      AND mt.record_status = 0
  )
  SELECT jsonb_build_object(
    'shift', (
      SELECT jsonb_build_object(
        'shiftId',    ms.id,
        'shiftName',  ms.name,
        'shiftDate',  ms.shift_date,
        'sportType',  ms.sport_type,
        'endTime',    ms.end_time,
        'daraRate',   ms.dara_rate,
        'akharRate',  ms.akhar_rate,
        'tripleRate', ms.triple_rate
      )
      FROM matka_shifts ms
      WHERE ms.id = p_shift_id
    ),
    'totals', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'numberType',  agg.number_type,
          'number',      agg.number,
          'totalAmount', agg.total_amount
        )
        ORDER BY agg.number_type, agg.number
      )
      FROM (
        SELECT
          mtd.number_type,
          mtd.number,
          SUM(mtd.amount)::numeric(15,2) AS total_amount
        FROM user_txns ut
        INNER JOIN matka_transaction_details mtd
                ON mtd.transaction_id = ut.id
               AND mtd.record_status   = 0
        GROUP BY mtd.number_type, mtd.number
      ) agg
    ), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'transactionCount', COUNT(*),
        'totalAmount',      COALESCE(SUM(ut.total_amount), 0),
        'totalCommission',  COALESCE(SUM(ut.total_commission), 0),
        'finalAmount',      COALESCE(SUM(ut.final_amount), 0)
      )
      FROM user_txns ut
    )
  );
$$;
