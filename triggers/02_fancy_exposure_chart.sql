CREATE OR REPLACE FUNCTION public.get_user_market_detail_of_fancy(
    varuser_id uuid,
    varmarket_id numeric
)
RETURNS TABLE(market_id numeric, run integer, runner_profit numeric)  -- added 'run' column
LANGUAGE plpgsql
AS $function$
DECLARE
    var_start_run INTEGER;
    var_end_run   INTEGER;
BEGIN
    -- Determine the range of runs based on existing transactions (shifted by bet type)
    SELECT
        MIN(td2.run - 2),
        MAX(td2.run + 2)
    INTO var_start_run, var_end_run
    FROM transactions t2
    JOIN transaction_details td2 ON td2.transaction_id = t2.id
        AND COALESCE(t2.record_status, 0) = 0
        AND COALESCE(td2.record_status, 0) = 0
    WHERE t2.market_type = 4
      AND (t2.market_id = varmarket_id OR COALESCE(varmarket_id, 0) = 0);

    -- If no transactions found, return empty result
    IF var_start_run IS NULL OR var_end_run IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH run_series AS (
        SELECT generate_series AS run
        FROM generate_series(var_start_run, var_end_run)
    )
    SELECT
        t.market_id,
        rs.run,
        SUM(
            CASE
                WHEN td.bet_type = 1 THEN
                    CASE WHEN td.run <= rs.run THEN -td.stake ELSE td.potential_return END
                ELSE
                    CASE WHEN td.run > rs.run THEN -td.stake ELSE td.potential_return END
            END
        ) AS runner_profit
    FROM transactions t
    JOIN transaction_details td ON td.transaction_id = t.id
        AND COALESCE(t.record_status, 0) = 0
        AND COALESCE(td.record_status, 0) = 0
    CROSS JOIN run_series rs
    WHERE t.status = 'matched'
      AND t.market_type = 4
      AND t.user_id = varuser_id
      AND (t.market_id = varmarket_id OR COALESCE(varmarket_id, 0) = 0)
    GROUP BY t.market_id, rs.run
    ORDER BY t.market_id, rs.run;
END;
$function$;