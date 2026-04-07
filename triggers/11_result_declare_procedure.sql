CREATE OR REPLACE PROCEDURE public.declare_process(
    varmarket_id NUMERIC,
    varmarket_type INT,
    varEventTypeId bigint,
	varCompetitionId bigint,
	varEventId bigint,
	varEventTypeName varchar(200), 
	varCompetitionName varchar(200), 
	varEventName varchar(200), 
	varMarketName varchar(200),
	varwin_runner_id BIGINT,
    varwin_run INT 
	, varwin_TeamName varchar(200)
	, varrunners jsonb
	, varsource varchar(200)
	, varapi_response jsonb
	)
LANGUAGE plpgsql
AS $BODY$
DECLARE
    varVoucherId UUID;
    varCompanyId UUID := '00000000-0000-0000-0000-000000000001';
    varVoucherType INT := 6;
    varVoucherDetailType INT := 6;
    varSystemUserId UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- Generate new voucher ID
    varVoucherId := gen_random_uuid();

    -- 1. Insert the main voucher record
    INSERT INTO public.vouchers (
        id, user_id, type, status, method, reference,
        remarks, remarks1, remarks2, remarks3,
        event_type_id, competition_id, event_id, market_id,
        approved_by, approved_date, voucher_date,
        added_by, added_date, update_by, update_date, record_status
    ) VALUES (
        varVoucherId, varSystemUserId, varVoucherType,
        1, 'DECLARE', null ,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        varEventTypeId, varCompetitionId, varEventId, varmarket_id,
        varSystemUserId, CURRENT_TIMESTAMP, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    );

    -- 2. Pre-calculate per-user net P&L and admin commission using a CTE
    DROP TABLE IF EXISTS base_data;
    CREATE TEMP TABLE base_data AS
    WITH transaction_table AS 
	(
		select t.user_id,t.whitelabel_id,t.id,t.market_type
		FROM transactions t
		WHERE t.status = 'matched'
		  AND t.market_id = varmarket_id
		  AND COALESCE(t.record_status, 0) = 0
	),
	tp as (
		select t.user_id,t.whitelabel_id,t.id,t.market_type
			,tc.admin_percent,tc.super_percent,tc.master_percent,tc.agent_percent
			,tc.admin_id,tc.super_id,tc.master_id,tc.agent_id
		FROM transaction_table t
		LEFT JOIN transaction_commissions tc ON tc.transaction_id = t.id
			AND COALESCE(tc.record_status, 0) = 0
	)
		SELECT
			tp.user_id,
			tp.whitelabel_id,
			SUM(
				(CASE WHEN td.bet_type = 0 THEN 1 ELSE -1 END) *
				(CASE WHEN td.is_user_selection THEN td.potential_return - td.stake ELSE -td.stake END)
			) AS net_pl,
			SUM(
				(CASE WHEN td.bet_type = 0 THEN 1 ELSE -1 END) *
				(CASE WHEN td.is_user_selection THEN td.potential_return - td.stake ELSE -td.stake END)
				*
				COALESCE(tp.admin_percent, 0) / 100.0
			) AS admin_commission,
			SUM(
				(CASE WHEN td.bet_type = 0 THEN 1 ELSE -1 END) *
				(CASE WHEN td.is_user_selection THEN td.potential_return - td.stake ELSE -td.stake END)
				*
				COALESCE(tp.super_percent, 0) / 100.0
			) AS super_commission,
			SUM(
				(CASE WHEN td.bet_type = 0 THEN 1 ELSE -1 END) *
				(CASE WHEN td.is_user_selection THEN td.potential_return - td.stake ELSE -td.stake END)
				*
				COALESCE(tp.master_percent, 0) / 100.0
			) AS master_commission,
			SUM(
				(CASE WHEN td.bet_type = 0 THEN 1 ELSE -1 END) *
				(CASE WHEN td.is_user_selection THEN td.potential_return - td.stake ELSE -td.stake END)
				*
				COALESCE(tp.agent_percent, 0) / 100.0
			) AS agent_commission,
			tp.admin_id,
			tp.super_id,
			tp.master_id,
			tp.agent_id
		FROM tp
			JOIN transaction_details td ON td.transaction_id = tp.id
				AND COALESCE(td.record_status, 0) = 0
				AND td.runner_id = varwin_runner_id
		  where tp.market_type in (0,1,2,3)
		GROUP BY tp.user_id, tp.whitelabel_id, tp.admin_id, tp.super_id, tp.master_id, tp.agent_id
		union all
			SELECT
			tp.user_id
			,tp.whitelabel_id
			,sum(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN -td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
			)as net_pl
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN -td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
				*
				COALESCE(tp.admin_percent, 0) / 100.0
			) AS admin_commission
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN -td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
				*
				COALESCE(tp.super_percent, 0) / 100.0
			) AS super_commission
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN -td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
				*
				COALESCE(tp.master_percent, 0) / 100.0
			) AS master_commission
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN -td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
				*
				COALESCE(tp.agent_percent, 0) / 100.0
			) AS agent_commission
			,tp.admin_id
			,tp.super_id
			,tp.master_id
			,tp.agent_id
		FROM tp
			JOIN transaction_details td ON td.transaction_id = tp.id
				AND COALESCE(td.record_status, 0) = 0
		WHERE tp.market_type = 4
		GROUP BY tp.user_id, tp.whitelabel_id, tp.admin_id, tp.super_id, tp.master_id, tp.agent_id
		;


	-- 3. Insert voucher details for User ↔ Company (role 7)
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3,
        proof_image, transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
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
        FALSE,
		varEventTypeName, varCompetitionName, varEventName, varMarketName,
        NULL,
        NULL, NULL, FALSE, 'declare-voucher',
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
	
	
	INSERT INTO transactions_declare(
	id, user_id, whitelabel_id, event_type_id, competition_id, match_id, market_id, market_name, market_type, selection_id, selection_name, bet_type, stake, odds, status, settled_amount, ip_address, matched_at, settled_at, cancelled_at, result_checked_at, added_by, added_date, update_by, update_date, record_status)
	select 
	id, user_id, whitelabel_id, event_type_id, competition_id, match_id, market_id, market_name, market_type, selection_id, selection_name, bet_type, stake, odds, 'declared', settled_amount, ip_address, matched_at, settled_at, cancelled_at, result_checked_at, added_by, added_date, update_by, update_date, record_status
	from transactions
	where market_id = varmarket_id	
	;
	
	INSERT INTO transaction_details_declare(
	id, transaction_id, runner_id, runner_name, is_user_selection, bet_type, price, run, stake, potential_return, added_by, added_date, update_by, update_date, record_status)
	select 
	id, transaction_id, runner_id, runner_name, is_user_selection, bet_type, price, run, stake, potential_return, added_by, added_date, update_by, update_date, record_status
	from transaction_details
	where transaction_id in (select id from transactions where market_id = varmarket_id) 
	;

	INSERT INTO transaction_commissions_declare(
	id, transaction_id, user_id, agent_id, agent_percent, master_id, master_percent, super_id, super_percent, admin_id, admin_percent, owner_id, owner_percent, added_by, added_date, update_by, update_date, record_status)
	select 
	id, transaction_id, user_id, agent_id, agent_percent, master_id, master_percent, super_id, super_percent, admin_id, admin_percent, owner_id, owner_percent, added_by, added_date, update_by, update_date, record_status
	from transaction_commissions
	where transaction_id in (select id from transactions where market_id = varmarket_id) 
	;

	INSERT INTO transaction_logs_declare(
	id, transaction_id, user_id, ip_address, user_agent, browser, browser_version, os, os_version, device_type, device_brand, device_model, country, city, added_by, added_date, update_by, update_date, record_status)
	select 
	id, transaction_id, user_id, ip_address, user_agent, browser, browser_version, os, os_version, device_type, device_brand, device_model, country, city, added_by, added_date, update_by, update_date, record_status
	from transaction_logs
	where transaction_id in (select id from transactions where market_id = varmarket_id) 
	;

	DELETE from transaction_logs
	where transaction_id in (select id from transactions where market_id = varmarket_id) 
	;
	DELETE from transaction_commissions
	where transaction_id in (select id from transactions where market_id = varmarket_id) 
	;
	DELETE from transaction_details
	where transaction_id in (select id from transactions where market_id = varmarket_id) 
	;
	DELETE from transactions
	where market_id = varmarket_id 
	;
	
	INSERT INTO public.market_results(
	id, event_id, event_type_id, competition_id, market_id, market_type
	, status, winner_id, winner_name
	, runners, source, api_response
	, settled_at, declared_at
	, added_by, added_date, update_by, update_date, record_status
	, runs)
	VALUES (gen_random_uuid(), varEventId, varEventTypeId, varCompetitionId, varmarket_id, varmarket_type
	, 'declared', varwin_runner_id, varwin_TeamName
	, varrunners, varsource,varapi_response
	, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP 
    ,varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
	, varwin_run)
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

ALTER PROCEDURE public.declare_process(NUMERIC,
    INT,
    bigint,
	bigint,
	bigint,
	varchar(200), 
	varchar(200), 
	varchar(200), 
	varchar(200),
	BIGINT,
    INT 
	,varchar(200)
	,jsonb
	,varchar(200)
	,jsonb
)
    OWNER TO postgres;