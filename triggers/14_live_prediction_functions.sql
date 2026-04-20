-- ─────────────────────────────────────────────────────────────────────────────
--  Live Prediction support functions
--
--  Matka result declarations are stored in market_results with
--  event_type_id = 999 (synthetic id used for matka). The `runs` column
--  holds the declared winning number (1-100). The shift the result belongs
--  to lives in api_response JSONB as {"shiftId": "...", "shiftName": "...",
--  "shiftDate": "..."}.
--
--  A single declared result counts as a hit for THREE numbers:
--    • the dara value itself                     (e.g. 73)
--    • the bahar derived from the last digit     (e.g. 73 % 10 = 3 → 333)
--    • the ander derived from the first digit    (e.g. 73 / 10 = 7 → 7777)
--  When the dara value is 100 the integer-division rules drop bahar (0*111)
--  and ander (10*1111 = 11110) so neither contributes — matches the way
--  bets pay out elsewhere in the system.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_matka_declared_counts_last_n_days(
    var_days integer DEFAULT 30
)
RETURNS TABLE(nums integer, num_type integer, declared_count integer)
LANGUAGE sql
AS $function$
    WITH all_nums AS (
        SELECT generate_series AS nums, 1 AS num_type FROM generate_series(1, 100)
        UNION ALL
        SELECT generate_series * 111,  2 FROM generate_series(1, 9)
        UNION ALL
        SELECT generate_series * 1111, 3 FROM generate_series(1, 9)
    ),
    declared AS (
        SELECT runs
        FROM public.market_results
        WHERE event_type_id = 999
          AND status = 'DECLARED'
          AND runs IS NOT NULL
          AND record_status = 0
          AND declared_at >= NOW() - (var_days || ' days')::interval
    )
    SELECT
        an.nums,
        an.num_type,
        COALESCE(SUM(
            CASE
                WHEN an.num_type = 1 AND d.runs = an.nums                       THEN 1
                WHEN an.num_type = 2 AND (d.runs % 10) * 111  = an.nums         THEN 1
                WHEN an.num_type = 3 AND (d.runs / 10) * 1111 = an.nums         THEN 1
                ELSE 0
            END
        ), 0)::integer AS declared_count
    FROM all_nums an
    LEFT JOIN declared d ON TRUE
    GROUP BY an.nums, an.num_type
    ORDER BY an.num_type, an.nums;
$function$;

ALTER FUNCTION public.get_matka_declared_counts_last_n_days(integer) OWNER TO postgres;
