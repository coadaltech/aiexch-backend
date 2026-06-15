CREATE OR REPLACE FUNCTION public.get_zambo_sel_preductiondata_allnumber(
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
        FROM generate_series(1, 1000)
    )
    SELECT varshift_id as shift_id, table_num.nums
		,round(sum((case when number_type = 0 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount else 0 end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 100)::int % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) then matka_transaction_details.amount/100 else 0 end)
		else 0 end)),0) as amount
	
		,- round((sum((case when number_type = 0 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 100) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 100) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 100)::int % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
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

ALTER function public.get_zambo_sel_preductiondata_allnumber(uuid,date)
    OWNER TO postgres;




CREATE OR REPLACE FUNCTION public.get_zambo_sel_whitelabel_sale(
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
		,round(sum((case when number_type = 0 then 
			(case when matka_transaction_details.number::integer = varnumber then matka_transaction_details.amount else 0 end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (varnumber % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 10)::int % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (varnumber % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 100)::int % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 10)::int % 10) then matka_transaction_details.amount/100 else 0 end)
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

ALTER function public.get_zambo_sel_whitelabel_sale(uuid,date,int)
    OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.get_user_zambo_jantri_of_whitelabel(
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
        FROM generate_series(1, 1000)
    )
    SELECT varwhitelabel_id as whitelabel_id, table_num.nums
		,round(sum((case when number_type = 0 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount else 0 end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 100)::int % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) then matka_transaction_details.amount/100 else 0 end)
		else 0 end)),0) as amount
	
		,- round((sum((case when number_type = 0 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 100) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 100) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 100)::int % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		else 0 end) 
	  	* (
			mtc.admin_percent
		/ 100)
		)),0) as profit

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

ALTER function public.get_user_zambo_jantri_of_whitelabel(uuid,uuid,date)
    OWNER TO postgres;
-- PROCEDURE: public.declare_process_zambo(uuid, date, date, integer)

-- DROP PROCEDURE IF EXISTS public.declare_process_zambo(uuid, date, date, integer);

CREATE OR REPLACE PROCEDURE public.declare_process_zambo(
	IN varshift_id uuid,
	IN vardeclare_date date,
	IN vartransaction_date date,
	IN vardeclare_number integer)
LANGUAGE 'plpgsql'
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
			,tc.owner_id,tc.admin_id,tc.super_id,tc.master_id,tc.agent_id
		FROM transaction_table t
		LEFT JOIN matka_transaction_commissions tc ON tc.matka_transaction_id = t.id
			AND COALESCE(tc.record_status, 0) = 0
	)
		SELECT
			tp.user_id,
			tp.whitelabel_id,			
			sum((case when number_type = 0 then 
				(case when td.number::integer = vardeclare_number then amount * rate - amount else - amount end)
			when number_type = 1 then
				(case when td.number::integer = (vardeclare_number % 100) then amount * rate - amount else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 100) then amount * rate - amount else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (vardeclare_number % 10) then amount * rate - amount else - amount end)
			when number_type = 4 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 100)::integer % 10) then amount * rate - amount else - amount end)
			when number_type = 5 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) then amount * rate - amount else - amount end)
			else 0 end)) as net_pl
			,			
			sum((case when number_type = 0 then 
				(case when td.number::integer = vardeclare_number then amount * rate - amount else - amount end)
			when number_type = 1 then
				(case when td.number::integer = (vardeclare_number % 100) then amount * rate - amount else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 100) then amount * rate - amount else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (vardeclare_number % 10) then amount * rate - amount else - amount end)
			when number_type = 4 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 100)::integer % 10) then amount * rate - amount else - amount end)
			when number_type = 5 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) then amount * rate - amount else - amount end)
			else 0 end)*COALESCE(tp.admin_percent, 0) / 100.0
			) AS admin_commission
			,			
			sum((case when number_type = 0 then 
				(case when td.number::integer = vardeclare_number then amount * rate - amount else - amount end)
			when number_type = 1 then
				(case when td.number::integer = (vardeclare_number % 100) then amount * rate - amount else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 100) then amount * rate - amount else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (vardeclare_number % 10) then amount * rate - amount else - amount end)
			when number_type = 4 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 100)::integer % 10) then amount * rate - amount else - amount end)
			when number_type = 5 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) then amount * rate - amount else - amount end)
			else 0 end)*COALESCE(tp.super_percent, 0) / 100.0
			) AS super_commission
			,
			sum((case when number_type = 0 then 
				(case when td.number::integer = vardeclare_number then amount * rate - amount else - amount end)
			when number_type = 1 then
				(case when td.number::integer = (vardeclare_number % 100) then amount * rate - amount else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 100) then amount * rate - amount else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (vardeclare_number % 10) then amount * rate - amount else - amount end)
			when number_type = 4 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 100)::integer % 10) then amount * rate - amount else - amount end)
			when number_type = 5 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) then amount * rate - amount else - amount end)
			else 0 end)*COALESCE(tp.master_percent, 0) / 100.0
			) AS master_commission,
			sum((case when number_type = 0 then 
				(case when td.number::integer = vardeclare_number then amount * rate - amount else - amount end)
			when number_type = 1 then
				(case when td.number::integer = (vardeclare_number % 100) then amount * rate - amount else - amount end)
			when number_type = 2 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 100) then amount * rate - amount else - amount end)
			when number_type = 3 then
				(case when td.number::integer = (vardeclare_number % 10) then amount * rate - amount else - amount end)
			when number_type = 4 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 100)::integer % 10) then amount * rate - amount else - amount end)
			when number_type = 5 then
				(case when td.number::integer = (FLOOR(vardeclare_number / 10)::integer % 10) then amount * rate - amount else - amount end)
			else 0 end)*COALESCE(tp.agent_percent, 0) / 100.0
			) AS agent_commission,
			tp.owner_id,
			tp.admin_id,
			tp.super_id,
			tp.master_id,
			tp.agent_id
		FROM tp
			JOIN matka_transaction_details td ON td.transaction_id = tp.id
				AND COALESCE(td.record_status, 0) = 0
		GROUP BY tp.user_id, tp.whitelabel_id, tp.owner_id, tp.admin_id, tp.super_id, tp.master_id, tp.agent_id
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
        (case when agent_id is not null then agent_id 
			when master_id is not null then master_id 
			when super_id is not null then super_id 
			when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),
        7,  -- role: user-to-company
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl > 0 then net_pl else -net_pl end), 0), 2),
        (case when net_pl > 0 then 1 else 0 end),  -- dr_cr = 0 (user pays company)
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
        (case when agent_id is not null then agent_id 
			when master_id is not null then master_id 
			when super_id is not null then super_id 
			when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),
        user_id,
        7,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl > 0 then net_pl else -net_pl end), 0), 2),
        (case when net_pl > 0 then 0 else 1 end),  -- dr_cr = 0 (company pays user)
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
		
    -- 5. User ↔ Agent (role 6) – using admin_commission
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
        (case when master_id is not null then master_id 
			when super_id is not null then super_id 
			when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),   -- replace with actual admin ID if different
        6,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission > 0 then net_pl-agent_commission else -(net_pl-agent_commission) end), 0), 2),
        (case when net_pl-agent_commission > 0 then 1 else 0 end),  -- dr_cr = 0 (user pays company)
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

    -- 6. Agent ↔ User (opposite, dr_cr = 0)
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
        (case when master_id is not null then master_id 
			when super_id is not null then super_id 
			when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),   -- Note: opposite direction - company to master
		agent_id,
        6,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission > 0 then net_pl-agent_commission else -(net_pl-agent_commission) end), 0), 2),
        (case when net_pl-agent_commission > 0 then 0 else 1 end),  -- dr_cr = 0 (user pays company)
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

    -- 5. User ↔ master (role 5) – using super_commission
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
        (case when super_id is not null then super_id 
			when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),   -- replace with actual admin ID if different
        5,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission-master_commission > 0 then net_pl-agent_commission-master_commission else -(net_pl-agent_commission-master_commission) end), 0), 2),
        (case when net_pl-agent_commission-master_commission > 0 then 1 else 0 end),  -- dr_cr = 0 (company pays user)
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
        (case when super_id is not null then super_id 
			when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),   -- Note: opposite direction - company to master
		master_id,
        5,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission-master_commission > 0 then net_pl-agent_commission-master_commission else -(net_pl-agent_commission-master_commission) end), 0), 2),
        (case when net_pl-agent_commission-master_commission > 0 then 0 else 1 end),  -- dr_cr = 0 (company pays user)
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

    -- 5. User ↔ Super (role 4) – using master_commission
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
        (case when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),   
        4,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission-master_commission-super_commission > 0 then net_pl-agent_commission-master_commission-super_commission else -(net_pl-agent_commission-master_commission-super_commission) end), 0), 2),
        (case when net_pl-agent_commission-master_commission-super_commission > 0 then 1 else 0 end),  -- dr_cr = 0 (company pays user)
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
        (case when admin_id is not null then admin_id 
			when owner_id is not null then owner_id 
			else varCompanyId end),   -- Note: opposite direction - company to Super
		super_id,
        4,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission-master_commission-super_commission > 0 then net_pl-agent_commission-master_commission-super_commission else -(net_pl-agent_commission-master_commission-super_commission) end), 0), 2),
        (case when net_pl-agent_commission-master_commission-super_commission > 0 then 0 else 1 end),  -- dr_cr = 0 (company pays user)
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

    -- 5. User ↔ Admin (role 3) – using agent_commission
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
        (case when owner_id is not null then owner_id 
			else varCompanyId end),   -- replace with actual admin ID if different
        3,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission-master_commission-super_commission-admin_commission > 0 then net_pl-agent_commission-master_commission-super_commission-admin_commission else -(net_pl-agent_commission-master_commission-super_commission-admin_commission) end), 0), 2),
        (case when net_pl-agent_commission-master_commission-super_commission-admin_commission > 0 then 1 else 0 end),  -- dr_cr = 0 (company pays user)
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
        (case when owner_id is not null then owner_id 
			else varCompanyId end),   -- Note: opposite direction - company to user
		admin_id,
        3,
        varVoucherType,
        varVoucherDetailType,
        ROUND(COALESCE((case when net_pl-agent_commission-master_commission-super_commission-admin_commission > 0 then net_pl-agent_commission-master_commission-super_commission-admin_commission else -(net_pl-agent_commission-master_commission-super_commission-admin_commission) end), 0), 2),
        (case when net_pl-agent_commission-master_commission-super_commission-admin_commission > 0 then 0 else 1 end),  -- dr_cr = 0 (company pays user)
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

	drop table base_data;
	
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
ALTER PROCEDURE public.declare_process_zambo(uuid, date, date, integer)
    OWNER TO postgres;

	-- FUNCTION: public.get_zambo_sel_user_sale_profit(uuid, date, integer)

-- DROP FUNCTION IF EXISTS public.get_zambo_sel_user_sale_profit(uuid, date, integer);

CREATE OR REPLACE FUNCTION public.get_zambo_sel_user_sale_profit(
	varshift_id uuid,
	vartransaction_date date,
	varnumber integer)
    RETURNS TABLE(user_id uuid, name character varying, amount numeric, profit numeric, totalsale numeric, streak integer, streak_type integer) 
    LANGUAGE 'plpgsql'
    COST 100
    VOLATILE PARALLEL UNSAFE
    ROWS 1000

AS $BODY$
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
				case when mtd_h.number_type = 0 then 
					(case when mtd_h.number::integer = dr.declare_number then mtd_h.amount * mtd_h.rate - mtd_h.amount ELSE - mtd_h.amount end)
				when mtd_h.number_type = 1 then
					(case when mtd_h.number::integer = (dr.declare_number % 100) then mtd_h.amount * mtd_h.rate - mtd_h.amount ELSE - mtd_h.amount end)
				when mtd_h.number_type = 2 then
					(case when mtd_h.number::integer = (FLOOR(dr.declare_number / 10)::int % 100) then mtd_h.amount * mtd_h.rate - mtd_h.amount ELSE - mtd_h.amount end)
				when mtd_h.number_type = 3 then
					(case when mtd_h.number::integer = (dr.declare_number % 10) then mtd_h.amount * mtd_h.rate - mtd_h.amount ELSE - mtd_h.amount end)
				when mtd_h.number_type = 4 then
					(case when mtd_h.number::integer = (FLOOR(dr.declare_number / 100)::int % 10) then mtd_h.amount * mtd_h.rate - mtd_h.amount ELSE - mtd_h.amount end)
				when mtd_h.number_type = 5 then
					(case when mtd_h.number::integer = (FLOOR(dr.declare_number / 10)::int % 10) then mtd_h.amount * mtd_h.rate - mtd_h.amount ELSE - mtd_h.amount end)
				else 0 end
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
		,round(sum((case when number_type = 0 then 
			(case when matka_transaction_details.number::integer = varnumber then matka_transaction_details.amount else 0 end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (varnumber % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 10)::int % 100) then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (varnumber % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 100)::int % 10) then matka_transaction_details.amount/100 else 0 end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 10)::int % 10) then matka_transaction_details.amount/100 else 0 end)
		else 0 end)),0) as amount
	
		,- round((sum((case when number_type = 0 then 
			(case when matka_transaction_details.number::integer = varnumber then matka_transaction_details.amount * rate - matka_transaction_details.amount  else - matka_transaction_details.amount end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (varnumber % 100) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 10)::int % 100) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (varnumber % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 100)::int % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(varnumber / 10)::int % 10) then matka_transaction_details.amount * rate - matka_transaction_details.amount else - matka_transaction_details.amount end)
		else 0 end) 
	  	* (
			mtc.owner_percent
		/ 100)
		)),0) as profit
		
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
$BODY$;

ALTER FUNCTION public.get_zambo_sel_user_sale_profit(uuid, date, integer)
    OWNER TO postgres;