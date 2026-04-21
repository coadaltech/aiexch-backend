CREATE OR REPLACE FUNCTION public.get_matka_sel_preductiondata_allnumber(
    varshift_id uuid, 
	vartransaction_date date
	
)
RETURNS TABLE(shift_id uuid, nums integer,amount numeric, profit numeric
		,declare_count bigint
)  -- added 'run' column
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH table_num AS (
        SELECT generate_series AS nums
        FROM generate_series(1, 100)
    )
    SELECT varshift_id as shift_id, table_num.nums
		,round(sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) * 1111 then matka_transaction_details.amount/10 else 0 end)
		else 0 end)),0) as amount
	
		,- round((sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) * 1111 then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		else 0 end) 
	  	* (
			mtc.owner_percent
		/ 100)
		)),0) as profit
		,COALESCE(declare_number_count.declare_count,0) as declare_count
	FROM table_num 
	join matka_transactions mt on mt.shift_id = varshift_id
		and transaction_date = vartransaction_date
		and mt.record_status = 0
	join matka_transaction_details on mt.id = matka_transaction_details.transaction_id
		and matka_transaction_details.record_status = 0
	join matka_transaction_commissions mtc on mt.id = mtc.matka_transaction_id
		and mtc.record_status = 0
	left join (
		select count(1) as declare_count,declare_result.declare_number from declare_result
		where declare_result.shift_id = varshift_id
		and declare_result.declare_date between vartransaction_date - INTERVAL '1 months' and vartransaction_date - INTERVAL '1 Days'
		and declare_result.record_status = 0
		group by declare_result.declare_number 
	) as declare_number_count on declare_number_count.declare_number = table_num.nums
	group by table_num.nums
		,declare_number_count.declare_count
	order by profit desc
	;
END;
$function$;

ALTER function public.get_matka_sel_preductiondata_allnumber(uuid,date)
    OWNER TO postgres;


DROP FUNCTION IF EXISTS public.get_matka_sel_user_sale_profit(varshift_id uuid, 
	vartransaction_date date,
	varnumber int);

CREATE OR REPLACE FUNCTION public.get_matka_sel_user_sale_profit(
    varshift_id uuid,
	vartransaction_date date,
	varnumber int
)
RETURNS TABLE(user_id uuid, name varchar(255),amount numeric,profit numeric,totalsale numeric
	,streak int, streak_type int
)
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
	WITH mt AS (
        SELECT matka_transactions.id,matka_transactions.user_id
        FROM matka_transactions
		where matka_transactions.shift_id = varshift_id
		and matka_transactions.transaction_date = vartransaction_date
		and matka_transactions.record_status = 0
    ),
	-- per-user outcome (won=1, lost=0) for each past declaration on this shift (last 30 days)
	user_outcomes AS (
		SELECT
			mt_h.user_id,
			dr.declare_id,
			CASE WHEN SUM(
				CASE WHEN mtd_h.number_type = 1 THEN
					(CASE WHEN mtd_h.number::integer = dr.declare_number THEN mtd_h.amount * mtd_h.rate ELSE - mtd_h.amount END)
				WHEN mtd_h.number_type = 2 THEN
					(CASE WHEN mtd_h.number::integer = (dr.declare_number % 10) * 111 THEN mtd_h.amount * mtd_h.rate ELSE - mtd_h.amount END)
				WHEN mtd_h.number_type = 3 THEN
					(CASE WHEN mtd_h.number::integer = (round((dr.declare_number / 10),0)) * 1111 THEN mtd_h.amount * mtd_h.rate ELSE - mtd_h.amount END)
				ELSE 0 END
			) > 0 THEN 1 ELSE 0 END AS won,
			ROW_NUMBER() OVER (PARTITION BY mt_h.user_id ORDER BY dr.declare_date DESC, dr.declare_id DESC) AS rn
		FROM declare_result dr
		JOIN matka_transactions mt_h ON mt_h.shift_id = dr.shift_id
			AND mt_h.transaction_date = dr.declare_date
			AND mt_h.record_status = 0
		JOIN matka_transaction_details mtd_h ON mtd_h.transaction_id = mt_h.id
			AND mtd_h.record_status = 0
		WHERE dr.record_status = 0
			AND dr.shift_id = varshift_id
			AND dr.declare_date BETWEEN vartransaction_date - INTERVAL '1 months' AND vartransaction_date - INTERVAL '1 days'
		GROUP BY mt_h.user_id, dr.declare_id, dr.declare_date
	),
	-- gaps-and-islands: rn - row_number()OVER(user,won) groups consecutive same-won runs
	outcomes_ranked AS (
		SELECT uo.user_id, uo.rn, uo.won,
			uo.rn - ROW_NUMBER() OVER (PARTITION BY uo.user_id, uo.won ORDER BY uo.rn) AS grp
		FROM user_outcomes uo
	),
	-- pick the run that starts at rn=1 (most recent) → current streak
	user_streak AS (
		SELECT oru.user_id,
			MAX(oru.won)::int AS streak_type,
			COUNT(*)::int AS streak
		FROM outcomes_ranked oru
		WHERE oru.grp = 0
		GROUP BY oru.user_id
	)
    SELECT mt.user_id, users.username
		,round(sum((case when number_type = 1 then
			(case when matka_transaction_details.number::integer = varnumber then matka_transaction_details.amount else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (varnumber % 10) * 111 then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (round((varnumber / 10),0)) * 1111 then matka_transaction_details.amount/10 else 0 end)
		else 0 end)),0) as amount

		-- owner's P&L from this user when varnumber is declared
		-- user's net P&L is negated so green(+) = owner wins, red(-) = owner pays
		,- round((sum((case when number_type = 1 then
			(case when matka_transaction_details.number::integer = varnumber then matka_transaction_details.amount * matka_transaction_details.rate else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (varnumber % 10) * 111 then matka_transaction_details.amount * matka_transaction_details.rate else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (round((varnumber / 10),0)) * 1111 then matka_transaction_details.amount * matka_transaction_details.rate else - matka_transaction_details.amount end)
		else 0 end)
	  	* (
			(mtc.owner_percent)
		/ 100)
		)),2) as profit

		,round(sum(matka_transaction_details.amount ),0) as totalsale
		,COALESCE(us.streak, 0) AS streak
		,us.streak_type AS streak_type
	FROM mt
	join matka_transaction_details on mt.id = matka_transaction_details.transaction_id
		and matka_transaction_details.record_status = 0
	join users on users.id = mt.user_id
	join matka_transaction_commissions mtc on mt.id = mtc.matka_transaction_id
		and mtc.record_status = 0
	left join user_streak us on us.user_id = mt.user_id
	group by mt.user_id, users.username, us.streak, us.streak_type
	order by amount desc
	;
END;
$function$;

ALTER function public.get_matka_sel_user_sale_profit(uuid,date,int)
    OWNER TO postgres;

    
DROP FUNCTION IF EXISTS public.get_matka_sel_whitelabel_sale( varshift_id uuid, 
vartransaction_date date,
varnumber int);



CREATE OR REPLACE FUNCTION public.get_matka_sel_whitelabel_sale(
    varshift_id uuid, 
	vartransaction_date date,
	varnumber int
)
RETURNS TABLE(whitelabel_id uuid, name varchar(255),amount numeric
)  -- added 'run' column
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
	WITH mt AS (
        SELECT matka_transactions.id,matka_transactions.whitelabel_id 
        FROM matka_transactions
		where matka_transactions.shift_id = varshift_id
		and matka_transactions.transaction_date = vartransaction_date
		and matka_transactions.record_status = 0
    )
    SELECT mt.whitelabel_id, whitelabels.name
		,round(sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = varnumber then matka_transaction_details.amount else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (varnumber % 10) * 111 then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 10)::int % 10) * 1111 then matka_transaction_details.amount/10 else 0 end)
		else 0 end)),0) as amount
	
	FROM mt  
	join matka_transaction_details on mt.id = matka_transaction_details.transaction_id
		and matka_transaction_details.record_status = 0
	join whitelabels on whitelabels.id = mt.whitelabel_id 
/*
	join matka_transaction_commissions mtc on mt.id = mtc.matka_transaction_id
		and mtc.record_status = 0
*/
	group by mt.whitelabel_id
		,whitelabels.name
	order by amount desc
	;
END;
$function$;

ALTER function public.get_matka_sel_whitelabel_sale(uuid,date,int)
    OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.get_user_matka_jantri_of_whitelabel(
    varwhitelabel_id uuid,
    varshift_id uuid, 
	vartransaction_date date
)
RETURNS TABLE(whitelabel_id uuid, nums integer,amount numeric, profit numeric)  -- added 'run' column
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH table_num AS (
        SELECT generate_series AS nums
        FROM generate_series(1, 100)
    )
    SELECT varwhitelabel_id as whitelabel_id, table_num.nums
		,sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) * 1111 then matka_transaction_details.amount/10 else 0 end)
		else 0 end)) as amount
	
		,- round((sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount * matka_transaction_details.rate else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then matka_transaction_details.amount * matka_transaction_details.rate else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) * 1111 then matka_transaction_details.amount * matka_transaction_details.rate else - matka_transaction_details.amount end)
		else 0 end) 
	  	* (
			(mtc.admin_percent)
		/ 100)
		)),2) as profit
	
	FROM table_num 
	join matka_transactions mt on mt.shift_id = varshift_id
		and mt.record_status = 0
		and mt.transaction_date = vartransaction_date
		and mt.whitelabel_id = varwhitelabel_id
	join matka_transaction_details on mt.id = matka_transaction_details.transaction_id
		and matka_transaction_details.record_status = 0
	join matka_transaction_commissions mtc on mt.id = mtc.matka_transaction_id
		and mtc.record_status = 0
	group by table_num.nums
	order by table_num.nums
	;
END;
$function$;

ALTER function public.get_user_matka_jantri_of_whitelabel(uuid,uuid,date)
    OWNER TO postgres;

/*
call declare_process_matka('00000000-0000-0000-0000-000000000000','2026-04-17','2026-04-17',100)
*/

CREATE OR REPLACE PROCEDURE public.declare_process_matka(
    varshift_id UUID,
    vardeclare_date date,
	vartransaction_date date,
    vardeclare_number int
	)
LANGUAGE plpgsql
AS $BODY$
DECLARE
    varVoucherId UUID;
    varCompanyId UUID := '00000000-0000-0000-0000-000000000001';
    varVoucherType INT := 6;
    varVoucherDetailType INT := 11;
    varSystemUserId UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- Generate new voucher ID
    varVoucherId := gen_random_uuid();

    -- 1. Insert the main voucher record
    INSERT INTO public.vouchers (
        id, user_id, type, status, method, reference,
        --remarks, remarks1, remarks2, remarks3,
        --event_type_id, competition_id, event_id, market_id,
		shift_id,
        approved_by, approved_date, voucher_date,
        added_by, added_date, update_by, update_date, record_status
    ) VALUES (
        varVoucherId, varSystemUserId, varVoucherType,
        1, 'DECLARE', null ,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --varEventTypeId, varCompetitionId, varEventId, varmarket_id,
		varshift_id,
        varSystemUserId, CURRENT_TIMESTAMP, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    );

    -- 2. Pre-calculate per-user net P&L and admin commission using a CTE
    CREATE TEMP TABLE base_data AS
    WITH transaction_table AS 
	(
		select t.user_id,t.whitelabel_id,t.id
		from matka_transactions as t
		where t.shift_id = varshift_id
		and t.transaction_date = vartransaction_date
		AND COALESCE(t.record_status, 0) = 0
	),
	tp as (
		select t.user_id,t.id,t.whitelabel_id
			,tc.admin_percent,tc.super_percent,tc.master_percent,tc.agent_percent
			,tc.admin_id,tc.super_id,tc.master_id,tc.agent_id
		FROM transaction_table t
		LEFT JOIN matka_transaction_commissions tc ON tc.matka_transaction_id = t.id
			AND COALESCE(tc.record_status, 0) = 0
	)
		SELECT
			tp.user_id,
			tp.whitelabel_id,			
			sum((case when number_type = 1 then 
				(case when td.number::integer = vardeclare_number then amount * rate else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (vardeclare_number % 10) * 111 then amount * rate else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) * 1111 then amount * rate else - amount end)
			else 0 end)) as net_pl
			,			
			SUM((case when number_type = 1 then 
				(case when td.number::integer = vardeclare_number then amount * rate else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (vardeclare_number % 10) * 111 then amount * rate else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) * 1111 then amount * rate else - amount end)
			else 0 end)*COALESCE(tp.admin_percent, 0) / 100.0
			) AS admin_commission,
			SUM((case when number_type = 1 then 
				(case when td.number::integer = vardeclare_number then amount * rate else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (vardeclare_number % 10) * 111 then amount * rate else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) * 1111 then amount * rate else - amount end)
			else 0 end)*COALESCE(tp.super_percent, 0) / 100.0
			) AS super_commission,
			SUM((case when number_type = 1 then 
				(case when td.number::integer = vardeclare_number then amount * rate else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (vardeclare_number % 10) * 111 then amount * rate else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) * 1111 then amount * rate else - amount end)
			else 0 end)*COALESCE(tp.master_percent, 0) / 100.0
			) AS master_commission,
			SUM((case when number_type = 1 then 
				(case when td.number::integer = vardeclare_number then amount * rate else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (vardeclare_number % 10) * 111 then amount * rate else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) * 1111 then amount * rate else - amount end)
			else 0 end)*COALESCE(tp.agent_percent, 0) / 100.0
			) AS agent_commission,
			tp.admin_id,
			tp.super_id,
			tp.master_id,
			tp.agent_id
		FROM tp
			JOIN matka_transaction_details td ON td.transaction_id = tp.id
				AND COALESCE(td.record_status, 0) = 0
		GROUP BY tp.user_id, tp.whitelabel_id, tp.admin_id, tp.super_id, tp.master_id, tp.agent_id
		;


	-- 3. Insert voucher details for User ↔ Company (role 7)
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
		monday_final, 
		--remarks, remarks1, remarks2, remarks3,
        --proof_image, transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        user_id,
        varCompanyId,
        7,  -- role: user-to-company
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(net_pl, 0), 2),
        1,  -- dr_cr = 0 (user pays company)
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(net_pl, 0), 2) <> 0
		and user_id is not null
		;

    -- 4. Company ↔ User (opposite direction, same role 7, dr_cr = 1)
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        varCompanyId,
        user_id,
        7,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(net_pl, 0), 2),
        0,   -- dr_cr = 1 (company pays user)
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(net_pl, 0), 2) <> 0
		and user_id is not null
		;
		
    -- 5. User ↔ Admin (role 3) – using admin_commission
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        admin_id,
        varCompanyId,   -- replace with actual admin ID if different
        3,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(admin_commission, 0), 2),
        0,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(admin_commission, 0), 2) <> 0
		and admin_id is not null
		;

    -- 6. Admin ↔ User (opposite, dr_cr = 0)
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        varCompanyId,   -- Note: opposite direction - company to user
		admin_id,
        3,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(admin_commission, 0), 2),
        1,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(admin_commission, 0), 2) <> 0
		and admin_id is not null
		;


    -- 5. User ↔ Super (role 6) – using super_commission
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        super_id,
        varCompanyId,   
        4,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(super_commission, 0), 2),
        0,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(super_commission, 0), 2) <> 0
		and super_id is not null
		;

    -- 6. Super ↔ User (opposite, dr_cr = 0)
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        varCompanyId,   -- Note: opposite direction - company to Super
		super_id,
        4,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(super_commission, 0), 2),
        1,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(super_commission, 0), 2) <> 0
		and super_id is not null
		;

    -- 5. User ↔ Master (role 6) – using master_commission
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        master_id,
        varCompanyId,   -- replace with actual admin ID if different
        5,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(master_commission, 0), 2),
        0,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(master_commission, 0), 2) <> 0
		and master_id is not null
		;

    -- 6. Master ↔ User (opposite, dr_cr = 0)
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        varCompanyId,   -- Note: opposite direction - company to master
		master_id,
        5,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(master_commission, 0), 2),
        1,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(master_commission, 0), 2) <> 0
		and master_id is not null
		;


    -- 5. User ↔ Agent (role 6) – using agent_commission
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        agent_id,
        varCompanyId,   -- replace with actual admin ID if different
        6,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(agent_commission, 0), 2),
        0,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(agent_commission, 0), 2) <> 0
		and agent_id is not null
		;

    -- 6. Master ↔ User (opposite, dr_cr = 0)
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        shift_id,
        monday_final, 
		--remarks, remarks1, remarks2, remarks3, proof_image,
        --transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        varCompanyId,   -- Note: opposite direction - company to master
		agent_id,
        6,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE(agent_commission, 0), 2),
        1,
        NULL,
        varshift_id,
        FALSE,
		--varEventTypeName, varCompetitionName, varEventName, varMarketName,
        --NULL,
        --NULL, NULL, FALSE, 'declare-voucher',
        whitelabel_id,
        CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    FROM base_data  -- THIS WAS MISSING
    WHERE ROUND(COALESCE(agent_commission, 0), 2) <> 0
		and agent_id is not null
		;

	
    -- 7. Update matched transactions to 'declared' (commented out in original)
    /*
	CREATE TEMP TABLE user_table AS
    select 
	distinct user_id
	from transactions
	where market_id = varmarket_id	
	;
	*/
	
	
	INSERT INTO matka_transactions_declare(
	id, user_id, shift_id, transaction_date, dara_rate, dara_commission, akhar_rate, akhar_commission, total_amount, total_commission, final_amount, device_type, added_by, added_date, update_by, update_date, record_status, copy_reference_shift_id, whitelabel_id)
	select 
	id, user_id, shift_id, transaction_date, dara_rate, dara_commission, akhar_rate, akhar_commission, total_amount, total_commission, final_amount, device_type, added_by, added_date, update_by, update_date, record_status, copy_reference_shift_id, whitelabel_id
	from matka_transactions
	where shift_id = varshift_id and transaction_date = vartransaction_date	
	;
	
	INSERT INTO matka_transaction_details_declare(
	id, transaction_id, number_type, "number", amount, rate, commission, final_amount, order_number, added_by, added_date, update_by, update_date, record_status)
	select 
	id, transaction_id, number_type, "number", amount, rate, commission, final_amount, order_number, added_by, added_date, update_by, update_date, record_status
	from matka_transaction_details
	where transaction_id in (select id from matka_transactions where shift_id = varshift_id and transaction_date = vartransaction_date) 
	;

	INSERT INTO matka_transaction_commissions_declare(
	id, matka_transaction_id, agent_id, agent_percent, master_id, master_percent, super_id, super_percent, admin_id, admin_percent, owner_id, owner_percent, added_by, added_date, update_by, update_date, record_status)
	select 
	id, matka_transaction_id, agent_id, agent_percent, master_id, master_percent, super_id, super_percent, admin_id, admin_percent, owner_id, owner_percent, added_by, added_date, update_by, update_date, record_status
	from matka_transaction_commissions
	where matka_transaction_id in (select id from matka_transactions where shift_id = varshift_id and transaction_date = vartransaction_date) 
	;

	INSERT INTO matka_transaction_logs_declare(
	id, matka_transaction_id, ip_address, user_agent, browser, browser_version, os, os_version, device_type, device_brand, device_model, country, city, added_by, added_date, update_by, update_date, record_status)
	select 
	id, matka_transaction_id, ip_address, user_agent, browser, browser_version, os, os_version, device_type, device_brand, device_model, country, city, added_by, added_date, update_by, update_date, record_status
	from matka_transaction_logs
	where matka_transaction_id in (select id from matka_transactions where shift_id = varshift_id and transaction_date = vartransaction_date) 
	;

	DELETE from matka_transaction_logs
	where matka_transaction_id in (select id from matka_transactions where shift_id = varshift_id and transaction_date = vartransaction_date) 
	;
	DELETE from matka_transaction_commissions
	where matka_transaction_id in (select id from matka_transactions where shift_id = varshift_id and transaction_date = vartransaction_date) 
	;
	DELETE from matka_transaction_details
	where transaction_id in (select id from matka_transactions where shift_id = varshift_id and transaction_date = vartransaction_date) 
	;
	DELETE from matka_transactions
	where shift_id = varshift_id and transaction_date = vartransaction_date	
	;
	
	
	INSERT INTO public.declare_result(
	declare_id
	, shift_id
	, declare_date
	, declare_number
	, is_needed
	, redeclare_nos
	, added_by, added_date, update_by, update_date, record_status
	)
	VALUES (gen_random_uuid()
	, varshift_id
	, vardeclare_date
	, vardeclare_number
	, 1
	, 1
	,varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
	)
	;
	
	
	-- Optional: commit or raise notice if varwin_run = 0 (test mode)
    /*
    IF varwin_run = 0 THEN
        RAISE NOTICE 'Test run completed. Voucher ID: %', varVoucherId;
        -- In test mode, you might rollback; caller decides.
    END IF;
    */
    
END;
$BODY$;

ALTER PROCEDURE public.declare_process_matka(
    UUID,
    date,
    date,
    int
)
    OWNER TO postgres;