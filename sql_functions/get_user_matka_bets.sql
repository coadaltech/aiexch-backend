-- fn_get_user_matka_bets(
--     p_user_id    uuid,
--     p_sport_type int,           -- 1001 = Matka, 1004 = Jambo
--     p_shift_id   uuid,          -- optional: filter to a single shift
--     p_status     text,          -- 'active' (today) | 'inactive' (past days)
--     p_limit      int
-- )
--
-- Returns the signed-in user's matka/jambo transaction headers (same shape
-- the /matka/my-bets route used to return).
--
-- Logic kept 1:1 with the old route:
--   * matka_transactions.user_id = p_user_id
--   * matka_transactions.record_status = 0  (Active)
--   * matka_shifts.sport_type = p_sport_type
--   * If p_shift_id IS NOT NULL: filter to that shift.
--   * p_status = 'inactive' => transaction_date < today
--     otherwise (active/NULL/'active') => transaction_date = today
--   * ORDER BY added_date DESC, LIMIT p_limit (old default: 200).
--   * copyReferenceShiftName resolved in the same call via a LEFT JOIN —
--     eliminates the follow-up "resolve copy-reference shift names" query
--     the route used to run.
--
-- Output:
--   [
--     {
--       "id": <uuid>,
--       "shiftId": <uuid>,
--       "shiftName": "<string>",
--       "shiftDate": "YYYY-MM-DD",
--       "transactionDate": "YYYY-MM-DD",
--       "totalAmount": "<decimal as string>",
--       "totalCommission": "<decimal as string>",
--       "finalAmount": "<decimal as string>",
--       "addedDate": "<ISO timestamp>",
--       "copyReferenceShiftId": <uuid> | null,
--       "copyReferenceShiftName": "<string>" | null,
--       "whitelabelId": <uuid> | null
--     }, ...
--   ]

CREATE OR REPLACE FUNCTION fn_get_user_matka_bets(
  p_user_id    uuid,
  p_sport_type int  DEFAULT 1001,
  p_shift_id   uuid DEFAULT NULL,
  p_status     text DEFAULT 'active',
  p_limit      int  DEFAULT 200
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH paged AS (
    SELECT
      mt.id,
      mt.shift_id,
      ms.name               AS shift_name,
      ms.shift_date,
      mt.transaction_date,
      mt.total_amount,
      mt.total_commission,
      mt.final_amount,
      mt.added_date,
      mt.copy_reference_shift_id,
      mt.whitelabel_id
    FROM matka_transactions mt
    INNER JOIN matka_shifts ms
      ON ms.id = mt.shift_id
    WHERE mt.user_id       = p_user_id
      AND mt.record_status = 0
      AND ms.sport_type    = p_sport_type
      AND (p_shift_id IS NULL OR mt.shift_id = p_shift_id)
      AND (
        CASE
          WHEN LOWER(COALESCE(p_status, 'active')) = 'inactive'
            THEN mt.transaction_date < CURRENT_DATE
          ELSE mt.transaction_date = CURRENT_DATE
        END
      )
    ORDER BY mt.added_date DESC
    LIMIT GREATEST(p_limit, 0)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                      p.id,
        'shiftId',                 p.shift_id,
        'shiftName',               p.shift_name,
        'shiftDate',               p.shift_date,
        'transactionDate',         p.transaction_date,
        'totalAmount',             p.total_amount,
        'totalCommission',         p.total_commission,
        'finalAmount',             p.final_amount,
        'addedDate',               p.added_date,
        'copyReferenceShiftId',    p.copy_reference_shift_id,
        'copyReferenceShiftName',  ref.name,
        'whitelabelId',            p.whitelabel_id
      )
      ORDER BY p.added_date DESC
    ),
    '[]'::jsonb
  )
  FROM paged p
  LEFT JOIN matka_shifts ref
    ON ref.id = p.copy_reference_shift_id;
$$;
