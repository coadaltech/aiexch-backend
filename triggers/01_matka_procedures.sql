-- -- ─────────────────────────────────────────────────────────────────────────────
-- --  Per-user (player view) jantri totals for one shift.
-- --
-- --  Returns one row per CANDIDATE matka number:
-- --    • 1..100               (dara,  num_type = 1)
-- --    • 111, 222 .. 999      (bahar, num_type = 2)
-- --    • 1111, 2222 .. 9999   (ander, num_type = 3)
-- --
-- --  Each row models "what if THIS number wins" via an implied dara result R:
-- --    dara  N      → R = N
-- --    bahar N(333) → R = N / 111         (e.g. 333 → 3)   ← representative
-- --    ander N(7777)→ R = (N / 1111) * 10 (e.g. 7777 → 70)
-- --
-- --  Profit uses the standard cross-type matka math evaluated at R:
-- --    type-1 bet on R                       → win,  else lose
-- --    type-2 bet on (R % 10) * 111          → win,  else lose
-- --    type-3 bet on (R / 10) * 1111         → win,  else lose
-- --  Winning bet contributes  +amount*rate, losing bet contributes -amount.
-- --
-- --    sale   — total stake placed on exactly this number (unchanged meaning)
-- --    profit — player-side P/L if this row's number wins
-- -- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION public.get_user_matka_jantri(
--     varuser_id  uuid,
--     varshift_id uuid
-- )
-- RETURNS TABLE(shift_id uuid, nums integer, amount numeric, profit numeric)
-- LANGUAGE plpgsql
-- AS $function$
-- BEGIN
--     RETURN QUERY
--     WITH all_nums AS (
--         SELECT generate_series AS nums, 1 AS num_type FROM generate_series(1, 100)
--         UNION ALL
--         SELECT generate_series * 111,  2 FROM generate_series(1, 9)
--         UNION ALL
--         SELECT generate_series * 1111, 3 FROM generate_series(1, 9)
--     ),
--     rows AS (
--         SELECT nums, num_type,
--             CASE num_type
--                 WHEN 1 THEN nums
--                 WHEN 2 THEN nums / 111
--                 WHEN 3 THEN (nums / 1111) * 10
--             END AS r
--         FROM all_nums
--     )
--     SELECT
--         varshift_id AS shift_id,
--         an.nums,
--         COALESCE(SUM(
--             CASE
--                 WHEN mtd.number_type = an.num_type
--                  AND mtd.number::integer = an.nums
--                 THEN mtd.amount
--                 ELSE 0
--             END
--         ), 0) AS amount,
--         COALESCE(SUM(
--             CASE
--                 WHEN mtd.number_type = 1 THEN
--                     CASE WHEN mtd.number::integer = an.r
--                         THEN mtd.amount * mtd.rate
--                         ELSE -mtd.amount
--                     END
--                 WHEN mtd.number_type = 2 THEN
--                     CASE WHEN mtd.number::integer = (an.r % 10) * 111
--                         THEN mtd.amount * mtd.rate
--                         ELSE -mtd.amount
--                     END
--                 WHEN mtd.number_type = 3 THEN
--                     CASE WHEN mtd.number::integer = (an.r / 10) * 1111
--                         THEN mtd.amount * mtd.rate
--                         ELSE -mtd.amount
--                     END
--                 ELSE 0
--             END
--         ), 0) AS profit
--     FROM rows an
--     LEFT JOIN matka_transactions mt
--         ON mt.user_id  = varuser_id
--        AND mt.shift_id = varshift_id
--        AND mt.record_status = 0
--     LEFT JOIN matka_transaction_details mtd
--         ON mtd.transaction_id = mt.id
--        AND mtd.record_status = 0
--     GROUP BY an.nums, an.num_type
--     ORDER BY an.num_type, an.nums;
-- END;
-- $function$;

-- ALTER FUNCTION public.get_user_matka_jantri(uuid, uuid) OWNER TO postgres;


-- -- ─────────────────────────────────────────────────────────────────────────────
-- --  Upline (owner / admin / super / master / agent) view of jantri totals for
-- --  one shift. Same row set and cross-type math as above; profit is the
-- --  upline's net P/L: −(player_profit × role_pct / 100).
-- -- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION public.get_user_matka_jantri_of_group(
--     varuser_id          uuid,
--     varshift_id         uuid,
--     varuser_group_type  int
-- )
-- RETURNS TABLE(shift_id uuid, nums integer, amount numeric, profit numeric)
-- LANGUAGE plpgsql
-- AS $function$
-- BEGIN
--     RETURN QUERY
--     WITH all_nums AS (
--         SELECT generate_series AS nums, 1 AS num_type FROM generate_series(1, 100)
--         UNION ALL
--         SELECT generate_series * 111,  2 FROM generate_series(1, 9)
--         UNION ALL
--         SELECT generate_series * 1111, 3 FROM generate_series(1, 9)
--     ),
--     rows AS (
--         SELECT nums, num_type,
--             CASE num_type
--                 WHEN 1 THEN nums
--                 WHEN 2 THEN nums / 111
--                 WHEN 3 THEN (nums / 1111) * 10
--             END AS r
--         FROM all_nums
--     )
--     SELECT
--         varshift_id AS shift_id,
--         an.nums,
--         COALESCE(SUM(
--             CASE
--                 WHEN mtd.number_type = an.num_type
--                  AND mtd.number::integer = an.nums
--                 THEN mtd.amount
--                 ELSE 0
--             END
--         ), 0) AS amount,
--         ROUND(
--             -COALESCE(SUM(
--                 (CASE
--                     WHEN mtd.number_type = 1 THEN
--                         CASE WHEN mtd.number::integer = an.r
--                             THEN mtd.amount * mtd.rate
--                             ELSE -mtd.amount
--                         END
--                     WHEN mtd.number_type = 2 THEN
--                         CASE WHEN mtd.number::integer = (an.r % 10) * 111
--                             THEN mtd.amount * mtd.rate
--                             ELSE -mtd.amount
--                         END
--                     WHEN mtd.number_type = 3 THEN
--                         CASE WHEN mtd.number::integer = (an.r / 10) * 1111
--                             THEN mtd.amount * mtd.rate
--                             ELSE -mtd.amount
--                         END
--                     ELSE 0
--                 END) * (
--                     CASE varuser_group_type
--                         WHEN 0 THEN mtc.owner_percent
--                         WHEN 3 THEN mtc.admin_percent
--                         WHEN 4 THEN mtc.super_percent
--                         WHEN 5 THEN mtc.master_percent
--                         WHEN 6 THEN mtc.agent_percent
--                         ELSE 0
--                     END / 100
--                 )
--             ), 0),
--         2) AS profit
--     FROM rows an
--     LEFT JOIN matka_transactions mt
--         ON mt.shift_id = varshift_id
--        AND mt.record_status = 0
--     LEFT JOIN matka_transaction_details mtd
--         ON mtd.transaction_id = mt.id
--        AND mtd.record_status = 0
--     LEFT JOIN matka_transaction_commissions mtc
--         ON mtc.matka_transaction_id = mt.id
--        AND mtc.record_status = 0
--        AND (
--               (varuser_group_type = 0 AND mtc.owner_id  = varuser_id)
--            OR (varuser_group_type = 3 AND mtc.admin_id  = varuser_id)
--            OR (varuser_group_type = 4 AND mtc.super_id  = varuser_id)
--            OR (varuser_group_type = 5 AND mtc.master_id = varuser_id)
--            OR (varuser_group_type = 6 AND mtc.agent_id  = varuser_id)
--        )
--     GROUP BY an.nums, an.num_type
--     ORDER BY an.num_type, an.nums;
-- END;
-- $function$;

-- ALTER FUNCTION public.get_user_matka_jantri_of_group(uuid, uuid, int) OWNER TO postgres;



CREATE OR REPLACE FUNCTION public.get_user_matka_jantri(
    varuser_id uuid,
    varshift_id uuid
)
RETURNS TABLE(shift_id uuid, nums integer,amount numeric, profit numeric)  -- added 'run' column
LANGUAGE plpgsql
AS $function$
DECLARE
    var_start_run INTEGER;
    var_end_run   INTEGER;
BEGIN
    -- Determine the range of runs based on existing transactions (shifted by bet type)

    -- If no transactions found, return empty result
    IF var_start_run IS NULL OR var_end_run IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH table_num AS (
        SELECT generate_series AS nums
        FROM generate_series(1, 100)
    )
    SELECT varshift_id as shift_id, table_num.nums
	,sum((case when number_type = 1 then 
		(case when matka_transaction_details.number::integer = table_num.nums then amount else 0 end)
	when number_type = 2 then
		(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then amount/10 else 0 end)
	when number_type = 3 then
		(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then amount/10 else 0 end)
	else 0 end)) as amount
	,sum((case when number_type = 1 then 
		(case when matka_transaction_details.number::integer = table_num.nums then amount * rate else - amount end)
	when number_type = 2 then
		(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then amount * rate else - amount end)
	when number_type = 3 then
		(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then amount * rate else - amount end)
	else 0 end)) as profit
	FROM table_num 
	join matka_transactions mt on matka_transactions.user_id = varuser_id
		and matka_transactions.shift_id = varshift_id
		and mt.record_status = 0
	join matka_transaction_details mtd on matka_transactions.id = matka_transaction_details.transaction_id
		and mtd.record_status = 0
	order by table_num.nums
	;
END;
$function$;

ALTER function public.get_user_matka_jantri(uuid,uuid)
    OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.get_user_matka_jantri_of_group(
    varuser_id uuid,
    varshift_id uuid, 
	varuser_group_type int
	
)
RETURNS TABLE(shift_id uuid, nums integer,amount numeric, profit numeric)  -- added 'run' column
LANGUAGE plpgsql
AS $function$
DECLARE
    var_start_run INTEGER;
    var_end_run   INTEGER;
BEGIN
    -- Determine the range of runs based on existing transactions (shifted by bet type)

    -- If no transactions found, return empty result
    IF var_start_run IS NULL OR var_end_run IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH table_num AS (
        SELECT generate_series AS nums
        FROM generate_series(1, 100)
    )
    SELECT varshift_id as shift_id, table_num.nums
		,sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then amount else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then amount/10 else 0 end)
		else 0 end)) as amount
	
		,- round((sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then amount * rate else - amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then amount * rate else - amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then amount * rate else - amount end)
		else 0 end) 
	  	* (
			(case when varuser_group_type = 0 then mtc.owner_percent
			  when varuser_group_type = 3 then mtc.admin_percent
			  when varuser_group_type = 4 then mtc.super_percent
			  when varuser_group_type = 5 then mtc.master_percent
			  when varuser_group_type = 6 then mtc.agent_percent
			  else 0 end)
		/ 100)
		)),2) as profit
	
	FROM table_num 
	join matka_transactions mt on matka_transactions.shift_id = varshift_id
		and mt.record_status = 0
	join matka_transaction_details mtd on matka_transactions.id = matka_transaction_details.transaction_id
		and mtd.record_status = 0
	join matka_transaction_commissions mtc on matka_transactions.id = mtc.transaction_id
		and mtc.record_status = 0
		and (case when varuser_group_type = 0 then tc.owner_id = varuser_id
			  when varuser_group_type = 3 then tc.admin_id = varuser_id
			  when varuser_group_type = 4 then tc.super_id = varuser_id
			  when varuser_group_type = 5 then tc.master_id = varuser_id
			  when varuser_group_type = 6 then tc.agent_id = varuser_id
			else
				1<>1
		end)
	order by table_num.nums
	;
END;
$function$;

ALTER function public.get_user_matka_jantri_of_group(uuid,uuid,int)
    OWNER TO postgres;