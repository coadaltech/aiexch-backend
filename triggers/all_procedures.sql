CREATE OR REPLACE PROCEDURE public.set_limit_used_of_user(
	IN varuser_id uuid)
LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
WITH trans as  
	(	
		select t.id,t.market_id,t.market_type
		FROM transactions t
		WHERE t.status = 'matched'
		AND t.user_id = varuser_id
		and t.record_status = 0
	),
	trans_det as  
	(	
		select t.market_id,t.market_type,td.bet_type,td.runner_id
		,td.potential_return,td.stake,td.run,td.is_user_selection
		FROM trans t
		join transaction_details td on t.id = td.transaction_id
		and td.record_status = 0
	),
	market_profit AS 
	(
	SELECT
	  td.market_id
      --,market_id_runners.runner_id
	  ,sum((case when market_id_runners.runner_id = td.runner_id then 
		  		td.potential_return 
			else
				(case when td.bet_type = 0 then -1 else 1 end) * td.stake
			end) 
	  	) as runner_profit 
    FROM trans_det as td
	join (SELECT
      td2.market_id
      ,td2.runner_id
		FROM trans_det as td2
		group by td2.market_id, td2.runner_id
	) as market_id_runners on market_id_runners.market_id = td.market_id 
    WHERE td.market_type <> 4
	and td.is_user_selection = TRUE 
    group by td.market_id, market_id_runners.runner_id

	union ALL
	SELECT
	  td.market_id
      --,td.runner_id
	  --,td.run
	  --,td.bet_type
	  --,market_id_runs.run
	  ,sum((case when td.bet_type = 1 then 
	  	  (case when td.run <= market_id_runs.run then 
		  		td.potential_return
			else
				+ td.stake
			end) 
		else
	  	  (case when td.run > market_id_runs.run then 
		  		- td.stake
			else
				+ td.potential_return
			end) 
		end)
	  	)as runner_profit 
    FROM trans_det as td
	join (
		SELECT distinct td2.market_id
		,(case when td2.bet_type = 1 then td2.run else td2.run - 1 end) as run
		FROM trans_det as td2
		  where td2.market_type = 4
	) as market_id_runs on market_id_runs.market_id = td.market_id 
    WHERE td.market_type = 4
	group by td.market_id,market_id_runs.run
	),
	minlimit_marketid AS 
    (SELECT
	  COALESCE(min((case when mp.runner_profit <= 0 then mp.runner_profit else 0 end)),0) as limit_use
      FROM market_profit mp
      GROUP BY mp.market_id
	  UNION ALL
	  select sum(total_amount) from matka_transactions
	  where user_id = varuser_id and record_status = 0
	)
	update ledger_limit set limit_consumed = COALESCE((select -sum(limit_use) from minlimit_marketid),0)
	where user_id = varuser_id 
	; 
	update ledger_limit set final_limit = COALESCE(user_limit,0) + COALESCE(user_balance,0) - COALESCE(limit_consumed,0)
	where user_id = varuser_id 
	;
END;
$BODY$;

ALTER PROCEDURE public.set_limit_used_of_user(uuid)
    OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.get_limituse_of_user_market(varuser_id uuid, varmarket_id numeric)
 RETURNS TABLE(market_id numeric,runner_id bigint, runner_profit numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
RETURN QUERY
	SELECT
	  t.market_id
      ,market_id_runners.runner_id
	  ,sum(
		  (case when market_id_runners.runner_id = td.runner_id then 
		  		td.potential_return 
			else
				(case when td.bet_type = 0 then -1 else 1 end) * td.stake
			end) 
	  	) as runner_profit 
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id 
	  and COALESCE(t.record_status,0) = 0 
	  and COALESCE(td.record_status,0) = 0 
	  and td.is_user_selection = TRUE 
	left join (SELECT
      t2.market_id
      ,td2.runner_id
		FROM transactions t2
	    JOIN transaction_details td2
	      ON td2.transaction_id = t2.id 
		  and COALESCE(t2.record_status,0) = 0 
		  and COALESCE(td2.record_status,0) = 0       	  
		group by t2.market_id, td2.runner_id
	) as market_id_runners on market_id_runners.market_id = t.market_id 
    WHERE t.status = 'matched'
      AND t.market_type <> 4
      AND t.user_id = varuser_id
	  and (t.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	group by t.market_id, market_id_runners.runner_id
	;
	
END;
$function$
;

ALTER function public.get_limituse_of_user_market(uuid, numeric)
    OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_limituse_of_user_market_fancy(varuser_id uuid, varmarket_id numeric)
 RETURNS TABLE(market_id numeric,runner_profit numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
RETURN QUERY
WITH market_profit AS 
	(SELECT
	  t.market_id
      --,td.runner_id
	  --,td.run
	  --,td.bet_type
	  ,market_id_runs.run
	  ,sum((case when td.bet_type = 1 then 
	  	  (case when td.run <= market_id_runs.run then 
		  		td.potential_return
			else
				+ td.stake
			end) 
		else
	  	  (case when td.run > market_id_runs.run then 
		  		- td.stake
			else
				+ td.potential_return
			end) 
		end)
	  	)as runner_profit 
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id 
	  and COALESCE(t.record_status,0) = 0 
	  and COALESCE(td.record_status,0) = 0 
	left join (
		SELECT distinct t2.market_id
		,(case when td2.bet_type = 1 then td2.run else td2.run - 1 end) as run
		FROM transactions t2
	    JOIN transaction_details td2
	      ON td2.transaction_id = t2.id 
		  and COALESCE(t2.record_status,0) = 0 
		  and COALESCE(td2.record_status,0) = 0 
		  where t2.market_type = 4
	  	  and (t2.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	) as market_id_runs on market_id_runs.market_id = t.market_id 
    
	WHERE t.status = 'matched'
      AND t.market_type = 4
      AND t.user_id = varuser_id
	  and (t.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	group by t.market_id,market_id_runs.run
	)
	select market_profit.market_id,min(market_profit.runner_profit) 
	from market_profit
	group by market_profit.market_id
	;
	
END;
$function$
;
ALTER function public.get_limituse_of_user_market_fancy(uuid, numeric)
    OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.get_hissa_of_group(varuser_id uuid, varmarket_id numeric, varuser_group_type int )
 RETURNS TABLE(market_id numeric,runner_id bigint, runner_profit numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
RETURN QUERY
/*WITH tot_users AS 
	select --profiles.downline,
	(case when users.group_id = 7 then users.id else '00000000-0000-0000-0000-000000000000' end) as users_id
	,(case when owneruser.group_id = 7 then owneruser.id else '00000000-0000-0000-0000-000000000000' end) as owner_id
	,(case when adminuser.group_id = 7 then adminuser.id else '00000000-0000-0000-0000-000000000000' end) as admin_id
	,(case when superuser.group_id = 7 then superuser.id else '00000000-0000-0000-0000-000000000000' end) as super_id
	,(case when masteruser.group_id = 7 then masteruser.id else '00000000-0000-0000-0000-000000000000' end) as master_id
	,(case when agentuser.group_id = 7 then agentuser.id else '00000000-0000-0000-0000-000000000000' end) as agent_id
	FROM users as owneruser 
	left join users as adminuser on owneruser.created_by = adminuser.id
	left join users as superuser on adminuser.created_by = superuser.id
	left join users as masteruser on superuser.created_by = masteruser.id
	left join users as agentuser on masteruser.created_by = agentuser.id
	left join users on agentuser.created_by = users.id
	--left join profiles on profiles.user_id = users.id
	where 1=1 
	and (case when varuser_group_type = 0 then owneruser.id = varuser_id
			  when varuser_group_type = 3 then adminuser.id = varuser_id
			  when varuser_group_type = 4 then superuser.id = varuser_id
			  when varuser_group_type = 5 then masteruser.id = varuser_id
			  when varuser_group_type = 6 then agentuser.id = varuser_id
			  when varuser_group_type = 7 then users.id = varuser_id
			else
				TRUE
		end)
	,tot_users_new as 
	(
		select users_id from tot_users
		union ALL
		select owner_id from tot_users
		union ALL
		select admin_id from tot_users
		union ALL
		select super_id from tot_users
		union ALL
		select master_id from tot_users
		union ALL
		select agent_id from tot_users
	)
*/
	SELECT
	  t.market_id
      ,market_id_runners.runner_id
	  ,- round((sum((case when market_id_runners.runner_id = td.runner_id then 
		  		td.potential_return 
			else
				(case when td.bet_type = 0 then -1 else 1 end) * td.stake
			end)  
	  	* (
			(case when varuser_group_type = 0 then tc.owner_percent
			  when varuser_group_type = 3 then tc.admin_percent
			  when varuser_group_type = 4 then tc.super_percent
			  when varuser_group_type = 5 then tc.master_percent
			  when varuser_group_type = 6 then tc.agent_percent
			  else 0 end)
		/ 100)
		)),2) 
		as runner_profit 
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id 
	  and COALESCE(t.record_status,0) = 0 
	  and COALESCE(td.record_status,0) = 0 
	  and td.is_user_selection = TRUE 
    JOIN transaction_commissions tc on
		 tc.transaction_id = t.id 
		 and COALESCE(tc.record_status,0) = 0 
	left join (SELECT
      t2.market_id
      ,td2.runner_id
		FROM transactions t2
	    JOIN transaction_details td2
	      ON td2.transaction_id = t2.id 
		  and COALESCE(t2.record_status,0) = 0 
		  and COALESCE(td2.record_status,0) = 0       	  
		group by t2.market_id, td2.runner_id
	) as market_id_runners on market_id_runners.market_id = t.market_id 
    WHERE t.status = 'matched'
      AND t.market_type <> 4
  	  and (case when varuser_group_type = 0 then tc.owner_id = varuser_id
			  when varuser_group_type = 3 then tc.admin_id = varuser_id
			  when varuser_group_type = 4 then tc.super_id = varuser_id
			  when varuser_group_type = 5 then tc.master_id = varuser_id
			  when varuser_group_type = 6 then tc.agent_id = varuser_id
			else
				1<>1
		end)
    --AND t.user_id in (select users_id from tot_users_new)
	  and (t.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	group by t.market_id,market_id_runners.runner_id
	;
	
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_hissa_of_group_fancy(varuser_id uuid, varmarket_id numeric, varuser_group_type int )
 RETURNS TABLE(market_id numeric,runner_profit numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
RETURN QUERY
	WITH market_profit AS 
	(SELECT
	  t.market_id
      --,td.runner_id
	  --,td.run
	  --,td.bet_type
	  ,market_id_runs.run
	  ,round((sum((case when td.bet_type = 1 then 
	  	  (case when td.run <= market_id_runs.run then 
		  		td.potential_return
			else
				+ td.stake
			end) 
		else
	  	  (case when td.run > market_id_runs.run then 
		  		- td.stake
			else
				+ td.potential_return
			end) 
		end)
		* (
			(case when varuser_group_type = 0 then tc.owner_percent
			  when varuser_group_type = 3 then tc.admin_percent
			  when varuser_group_type = 4 then tc.super_percent
			  when varuser_group_type = 5 then tc.master_percent
			  when varuser_group_type = 6 then tc.agent_percent
			  else 0 end)
		/ 100)
	  	)),2)as runner_profit 
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id 
	  and COALESCE(t.record_status,0) = 0 
	  and COALESCE(td.record_status,0) = 0 
    JOIN transaction_commissions tc on
		 tc.transaction_id = t.id 
		 and COALESCE(tc.record_status,0) = 0 
	left join (
		SELECT distinct t2.market_id
		,(case when td2.bet_type = 1 then td2.run else td2.run - 1 end) as run
		FROM transactions t2
	    JOIN transaction_details td2
	      ON td2.transaction_id = t2.id 
		  and COALESCE(t2.record_status,0) = 0 
		  and COALESCE(td2.record_status,0) = 0 
		  where t2.market_type = 4
	  	  and (t2.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	) as market_id_runs on market_id_runs.market_id = t.market_id 
    
	WHERE t.status = 'matched'
      AND t.market_type = 4
  	  and (case when varuser_group_type = 0 then tc.owner_id = varuser_id
			  when varuser_group_type = 3 then tc.admin_id = varuser_id
			  when varuser_group_type = 4 then tc.super_id = varuser_id
			  when varuser_group_type = 5 then tc.master_id = varuser_id
			  when varuser_group_type = 6 then tc.agent_id = varuser_id
			else
				1<>1
		end)
      --AND t.user_id = varuser_id
	  and (t.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	group by t.market_id,market_id_runs.run
	)
	select market_profit.market_id,-min(market_profit.runner_profit) 
	from market_profit
	group by market_profit.market_id
	;
	
END;
$function$
;
/*
select * from get_limituse_of_user_market_fancy('650513c6-2715-43f7-989d-bb2f66b90b83',2930118)
;
*/


CREATE OR REPLACE FUNCTION public.get_list_of_market_with_trans(varuser_id uuid, varuser_group_type int)
 RETURNS TABLE(market_id numeric
 ,event_type_id bigint
 ,event_name varchar(200)
 ,competition_id bigint
 ,competitions_name varchar(200)
 ,match_id bigint
 ,market_name varchar(255)
 ,market_type int
 )
 LANGUAGE plpgsql
AS $function$
DECLARE
varwhitelabel_id uuid;
BEGIN

-- Resolve whitelabel for non-owner roles
SELECT users.whitelabel_id
INTO varwhitelabel_id
FROM users
WHERE users.id = varuser_id;

RETURN QUERY
WITH market_list AS (
	SELECT
	  t.market_id
      ,t.event_type_id
      ,t.competition_id
	  ,t.match_id
      ,t.market_name
      ,t.market_type
    FROM transactions t
    JOIN transaction_commissions tc ON tc.transaction_id = t.id
		AND COALESCE(tc.record_status, 0) = 0
    WHERE t.status = 'matched'
      AND COALESCE(t.record_status, 0) = 0
      AND (CASE
              WHEN varuser_group_type = 0 THEN tc.owner_id = varuser_id
              WHEN varuser_group_type = 3 THEN tc.admin_id = varuser_id
              WHEN varuser_group_type = 4 THEN tc.super_id = varuser_id
              WHEN varuser_group_type = 5 THEN tc.master_id = varuser_id
              WHEN varuser_group_type = 6 THEN tc.agent_id = varuser_id
              WHEN varuser_group_type = 7 THEN t.user_id = varuser_id
              ELSE 1 <> 1
          END)
      AND (CASE WHEN varuser_group_type = 0 THEN 1=1 ELSE t.whitelabel_id = varwhitelabel_id END)
	GROUP BY
		t.market_id
		,t.event_type_id
		,t.competition_id
		,t.match_id
		,t.market_name
		,t.market_type
)
SELECT
  ml.market_id
  ,ml.event_type_id
  ,e.name::varchar(200) AS event_name
  ,ml.competition_id
  ,c.name::varchar(200) AS competitions_name
  ,ml.match_id
  ,ml.market_name
  ,ml.market_type
FROM market_list AS ml
LEFT JOIN events e ON e.event_id = ml.match_id
LEFT JOIN competitions c ON c.competition_id = ml.competition_id;

END;
$function$
;

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
                    CASE WHEN td.run <= rs.run THEN td.potential_return ELSE td.stake END
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

/*

call declare_process(
2948067
,4
,4
,101480
,35452229
,'Cricket'
,'IPL'
,'India Vs Pak'
,'Match Odds'
,2948047
,1
,''
,'[]'
,''
,'[]'
)

*/


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
				(CASE WHEN td.is_user_selection THEN td.potential_return 
						ELSE (case when td.bet_type = 0 then -1 else 1 end) * td.stake END)
			) AS net_pl,
			SUM(
				(CASE WHEN td.is_user_selection THEN td.potential_return 
						ELSE (case when td.bet_type = 0 then -1 else 1 end) * td.stake END)
				*
				COALESCE(tp.admin_percent, 0) / 100.0
			) AS admin_commission,
			SUM(
				(CASE WHEN td.is_user_selection THEN td.potential_return 
						ELSE (case when td.bet_type = 0 then -1 else 1 end) * td.stake END)
				*
				COALESCE(tp.super_percent, 0) / 100.0
			) AS super_commission,
			SUM(
				(CASE WHEN td.is_user_selection THEN td.potential_return 
						ELSE (case when td.bet_type = 0 then -1 else 1 end) * td.stake END)
				*
				COALESCE(tp.master_percent, 0) / 100.0
			) AS master_commission,
			SUM(
				(CASE WHEN td.is_user_selection THEN td.potential_return 
						ELSE (case when td.bet_type = 0 then -1 else 1 end) * td.stake END)
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
						CASE WHEN td.run <= varwin_run THEN td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
			)as net_pl
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
				*
				COALESCE(tp.admin_percent, 0) / 100.0
			) AS admin_commission
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
				*
				COALESCE(tp.super_percent, 0) / 100.0
			) AS super_commission
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN td.potential_return ELSE td.stake END
					ELSE
						CASE WHEN td.run > varwin_run THEN -td.stake ELSE td.potential_return END
				END)
				*
				COALESCE(tp.master_percent, 0) / 100.0
			) AS master_commission
			,SUM(
				(CASE
					WHEN td.bet_type = 1 THEN
						CASE WHEN td.run <= varwin_run THEN td.potential_return ELSE td.stake END
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



CREATE OR REPLACE PROCEDURE public.update_limit_after_declare(
    varmarket_id NUMERIC
	)
LANGUAGE plpgsql
AS $BODY$
BEGIN
	DECLARE
    user_cursor CURSOR FOR 
        select 
		user_id
		from transactions_declare
		where market_id = varmarket_id	
		;
    user_record RECORD;
	BEGIN
		FOR user_record IN user_cursor LOOP
			call set_limit_used_of_user(user_record.user_id);
		END LOOP;
	END;
	
	-- Optional: commit or raise notice if varwin_run = 0 (test mode)
    /*
    IF varwin_run = 0 THEN
        RAISE NOTICE 'Test run completed. Voucher ID: %', varVoucherId;
        -- In test mode, you might rollback; caller decides.
    END IF;
    */
    
END;
$BODY$;

ALTER PROCEDURE public.update_limit_after_declare(NUMERIC
)
    OWNER TO postgres;


-- CREATE OR REPLACE FUNCTION public.get_user_account_ledger_statement(
--     varuser_id uuid,
--     varfromdate date,
-- 	vartodate date
-- )
-- RETURNS TABLE(voucher_id uuid
-- 		, voucher_date DATE
-- 		, parent_voucher_detail_id uuid
-- 		, monday_final BOOLEAN
-- 		, proof_image text
-- 		, transaction_id uuid
-- 		, reference_id varchar(200)
-- 		, is_processed BOOLEAN
-- 		, description varchar(200)
-- 		, whitelabel_id uuid
-- 		, user_id uuid
-- 		, opposite_user_id uuid
-- 		, role int
-- 		, voucher_type int
-- 		, voucher_detail_type int
-- 		, credit NUMERIC
-- 		, debit NUMERIC
-- 		, status int
-- 		, method varchar(200)
-- 		, reference varchar(200)
-- 		, remarks varchar(200)
-- 		, remarks1 varchar(200)
-- 		, remarks2 varchar(200)
-- 		, remarks3 varchar(200)
-- 		, event_type_id bigint
-- 		, competition_id bigint
-- 		, event_id bigint
-- 		, market_id NUMERIC
-- 		, approved_by uuid
-- 		, approved_date date
-- 		, added_by uuid
-- 		, added_date timestamp with time zone
-- 		, update_by uuid
-- 		, update_date timestamp with time zone
-- 		, record_status int
-- 	)  
-- LANGUAGE plpgsql
-- AS $function$
-- BEGIN
--     RETURN QUERY
-- 	with v as (
-- 		SELECT 
-- 		vouchers.id as voucher_id
-- 		, vouchers.status
-- 		, vouchers.method
-- 		, vouchers.reference
-- 		, vouchers.remarks
-- 		, vouchers.remarks1
-- 		, vouchers.remarks2
-- 		, vouchers.remarks3
-- 		, vouchers.event_type_id
-- 		, vouchers.competition_id
-- 		, vouchers.event_id
-- 		, vouchers.market_id
-- 		, vouchers.approved_by
-- 		, vouchers.approved_date
-- 		, vouchers.voucher_date
-- 		, vouchers.added_by
-- 		, vouchers.added_date
-- 		, vouchers.update_by
-- 		, vouchers.update_date
-- 		, vouchers.record_status
-- 		FROM vouchers
-- 		where vouchers.record_status = 0 
-- 		and vouchers.type <> 2
-- 		and vouchers.user_id = varuser_id	
-- 	),
-- 	vd as 
-- 	(
-- 		SELECT 
-- 		voucher_details.voucher_id
-- 		, voucher_details.user_id
-- 		, voucher_details.opposite_user_id
-- 		, voucher_details.role, amount
-- 		, voucher_details.voucher_type
-- 		, voucher_details.voucher_detail_type
-- 		, voucher_details.dr_cr
-- 		, voucher_details.parent_voucher_detail_id
-- 		, voucher_details.monday_final
-- 		, voucher_details.proof_image
-- 		, voucher_details.transaction_id
-- 		, voucher_details.reference_id
-- 		, voucher_details.is_processed
-- 		, voucher_details.description
-- 		, voucher_details.whitelabel_id
-- 		FROM voucher_details
-- 		where voucher_details.record_status = 0 
-- 		and voucher_details.voucher_type <> 2
-- 		and voucher_details.user_id = varuser_id
-- 	),
-- 	a as 
-- 	(
-- 		SELECT 
-- 		vd.voucher_id
-- 		, vd.parent_voucher_detail_id
-- 		, vd.monday_final
-- 		, vd.proof_image
-- 		, vd.transaction_id
-- 		, vd.reference_id
-- 		, vd.is_processed
-- 		, vd.description
-- 		, vd.whitelabel_id
-- 		, vd.user_id
-- 		, vd.opposite_user_id
-- 		, vd.role
-- 		, vd.voucher_type
-- 		, vd.voucher_detail_type
-- 		, vd.amount
-- 		, vd.dr_cr
		
-- 		, v.status
-- 		, v.method
-- 		, v.reference
-- 		, v.remarks
-- 		, v.remarks1
-- 		, v.remarks2
-- 		, v.remarks3
-- 		, v.event_type_id
-- 		, v.competition_id
-- 		, v.event_id
-- 		, v.market_id
-- 		, v.approved_by
-- 		, v.approved_date
-- 		, v.voucher_date
-- 		, v.added_by
-- 		, v.added_date
-- 		, v.update_by
-- 		, v.update_date
-- 		, v.record_status
-- 		FROM v join vd on v.voucher_id = vd.voucher_id
-- 	),
-- 	user_opening as 
-- 	(
-- 		select ledger_limit.user_balance 
-- 			- sum(case when a.voucher_date < varfromdate then (CASE WHEN dr_cr = 1 THEN amount ELSE -amount END) else 0 end) 
-- 			as openingamount
-- 			,ledger_limit.user_balance 
-- 			- sum(case when a.voucher_date <= vartodate then (CASE WHEN dr_cr = 1 THEN amount ELSE -amount END) else 0 end) 
-- 			as closingamount
-- 		from ledger_limit
-- 		left join a on ledger_limit.user_id = varuser_id
-- 		and ledger_limit.record_status = 0
-- 		group by ledger_limit.user_balance    
-- 	),
-- 	final_ledger as 
-- 	(
-- 		SELECT 
-- 		 0 as orderflag
-- 		, null as voucher_id
-- 		, varfromdate as voucher_date
-- 		, null as parent_voucher_detail_id
-- 		, null as monday_final
-- 		, null as proof_image
-- 		, null as transaction_id
-- 		, null as reference_id
-- 		, null as is_processed
-- 		, null as description
-- 		, null as whitelabel_id
-- 		, varuser_id as user_id
-- 		, null as opposite_user_id
-- 		, null as role
-- 		, null as voucher_type
-- 		, null as voucher_detail_type
-- 		, openingamount as credit
-- 		, null as status
-- 		, null as method
-- 		, null as reference
-- 		, null as remarks
-- 		, null as remarks1
-- 		, null as remarks2
-- 		, null as remarks3
-- 		, null as event_type_id
-- 		, null as competition_id
-- 		, null as event_id
-- 		, null as market_id
-- 		, null as approved_by
-- 		, null as approved_date
-- 		, null as added_by
-- 		, null as added_date
-- 		, null as update_by
-- 		, null as update_date
-- 		, null as record_status
-- 		FROM user_opening
		
-- 		UNION all

-- 		SELECT 
-- 		 1 as orderflag
-- 		, (case when a.voucher_type = 1 then a.voucher_id else null end) as voucher_id
-- 		, a.voucher_date
-- 		, a.parent_voucher_detail_id
-- 		, a.monday_final
-- 		, a.proof_image
-- 		, a.transaction_id
-- 		, a.reference_id
-- 		, a.is_processed
-- 		, a.description
-- 		, a.whitelabel_id
-- 		, a.user_id
-- 		, a.opposite_user_id
-- 		, a.role
-- 		, a.voucher_type
-- 		, a.voucher_detail_type
-- 		, sum(CASE WHEN a.dr_cr = 1 THEN a.amount ELSE -a.amount END) as credit
-- 		, a.status
-- 		, a.method
-- 		, a.reference
-- 		, a.remarks
-- 		, a.remarks1
-- 		, a.remarks2
-- 		, a.remarks3
-- 		, a.event_type_id
-- 		, a.competition_id
-- 		, a.event_id
-- 		, a.market_id
-- 		, a.approved_by
-- 		, a.approved_date
-- 		, a.added_by
-- 		, a.added_date
-- 		, a.update_by
-- 		, a.update_date
-- 		, a.record_status
-- 		FROM a 
-- 		where a.voucher_date BETWEEN varfromdate and vartodate
-- 		group by 	
-- 		(case when a.voucher_type = 1 then a.voucher_id else null end) 
-- 		, a.parent_voucher_detail_id
-- 		, a.monday_final
-- 		, a.proof_image
-- 		, a.transaction_id
-- 		, a.reference_id
-- 		, a.is_processed
-- 		, a.description
-- 		, a.whitelabel_id
-- 		, a.user_id
-- 		, a.opposite_user_id
-- 		, a.role
-- 		, a.voucher_type
-- 		, a.voucher_detail_type
-- 		, a.status
-- 		, a.method
-- 		, a.reference
-- 		, a.remarks
-- 		, a.remarks1
-- 		, a.remarks2
-- 		, a.remarks3
-- 		, a.event_type_id
-- 		, a.competition_id
-- 		, a.event_id
-- 		, a.market_id
-- 		, a.approved_by
-- 		, a.approved_date
-- 		, a.voucher_date
-- 		, a.added_by
-- 		, a.added_date
-- 		, a.update_by
-- 		, a.update_date
-- 		, a.record_status
		
-- 		union all
		
-- 		select
-- 		 2 as orderflag
-- 		, null as voucher_id
-- 		, vartodate as voucher_date
-- 		, null as parent_voucher_detail_id
-- 		, null as monday_final
-- 		, null as proof_image
-- 		, null as transaction_id
-- 		, null as reference_id
-- 		, null as is_processed
-- 		, null as description
-- 		, null as whitelabel_id
-- 		, varuser_id as user_id
-- 		, null as opposite_user_id
-- 		, null as role
-- 		, null as voucher_type
-- 		, null as voucher_detail_type
-- 		, closingamount as credit
-- 		, null as status
-- 		, null as method
-- 		, null as reference
-- 		, null as remarks
-- 		, null as remarks1
-- 		, null as remarks2
-- 		, null as remarks3
-- 		, null as event_type_id
-- 		, null as competition_id
-- 		, null as event_id
-- 		, null as market_id
-- 		, null as approved_by
-- 		, null as approved_date
-- 		, null as added_by
-- 		, null as added_date
-- 		, null as update_by
-- 		, null as update_date
-- 		, null as record_status
-- 		FROM user_opening 
-- 	)
-- 	select 
-- 		  final_ledger.voucher_id
-- 		, final_ledger.voucher_date
-- 		, final_ledger.parent_voucher_detail_id
-- 		, final_ledger.monday_final
-- 		, final_ledger.proof_image
-- 		, final_ledger.transaction_id
-- 		, final_ledger.reference_id
-- 		, final_ledger.is_processed
-- 		, final_ledger.description
-- 		, final_ledger.whitelabel_id
-- 		, final_ledger.user_id
-- 		, final_ledger.opposite_user_id
-- 		, final_ledger.role
-- 		, final_ledger.voucher_type
-- 		, final_ledger.voucher_detail_type
-- 		, (CASE WHEN final_ledger.credit > 0 THEN final_ledger.credit ELSE 0 END) as credit
-- 		, (CASE WHEN final_ledger.credit <= 0 THEN 0 ELSE final_ledger.credit END) as debit
-- 		, final_ledger.status
-- 		, final_ledger.method
-- 		, final_ledger.reference
-- 		, final_ledger.remarks
-- 		, final_ledger.remarks1
-- 		, final_ledger.remarks2
-- 		, final_ledger.remarks3
-- 		, final_ledger.event_type_id
-- 		, final_ledger.competition_id
-- 		, final_ledger.event_id
-- 		, final_ledger.market_id
-- 		, final_ledger.approved_by
-- 		, final_ledger.approved_date
-- 		, final_ledger.added_by
-- 		, final_ledger.added_date
-- 		, final_ledger.update_by
-- 		, final_ledger.update_date
-- 		, final_ledger.record_status
-- 		FROM final_ledger 
-- 		order by final_ledger.orderflag,final_ledger.voucher_date,final_ledger.added_date
-- 	;
	
	
-- END;
-- $function$;



-- ALTER FUNCTION public.get_user_account_ledger_statement(
--     uuid,
--     date,
-- 	date
-- )
--     OWNER TO postgres;
/*
select * from get_user_account_ledger_statement('a1fb57ac-bca9-4160-85a8-95b2ac653006','04/01/2026','04/01/2026')
*/

CREATE OR REPLACE FUNCTION public.get_user_account_ledger_statement(
    varuser_id uuid,
    varfromdate date,
	vartodate date
)
RETURNS TABLE(voucher_id uuid
		, voucher_date DATE
		, parent_voucher_detail_id uuid
		, monday_final BOOLEAN
		, proof_image text
		, transaction_id uuid
		, reference_id varchar(200)
		, is_processed BOOLEAN
		, description varchar(200)
		, whitelabel_id uuid
		, user_id uuid
		, opposite_user_id uuid
		, role int
		, voucher_type int
		, voucher_detail_type int
		, credit NUMERIC
		, debit NUMERIC
		, status int
		, method varchar(200)
		, reference varchar(200)
		, remarks varchar(200)
		, remarks1 varchar(200)
		, remarks2 varchar(200)
		, remarks3 varchar(200)
		, event_type_id bigint
		, competition_id bigint
		, event_id bigint
		, market_id NUMERIC
		, approved_by uuid
		, approved_date date
		, added_by uuid
		, added_date timestamp with time zone
		, update_by uuid
		, update_date timestamp with time zone
		, record_status int
	)  
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
	with v as (
		SELECT 
		vouchers.id as voucher_id
		, vouchers.status
		, vouchers.method
		, vouchers.reference
		, vouchers.event_type_id
		, vouchers.competition_id
		, vouchers.event_id
		, vouchers.market_id
		, vouchers.approved_by
		, vouchers.approved_date
		, vouchers.voucher_date
		, vouchers.added_by
		, vouchers.added_date
		, vouchers.update_by
		, vouchers.update_date
		, vouchers.record_status
		FROM vouchers
		where vouchers.record_status = 0 
		and vouchers.type <> 2
	),
	vd as 
	(
		SELECT 
		voucher_details.voucher_id
		, voucher_details.user_id
		, voucher_details.opposite_user_id
		, voucher_details.role, amount
		, voucher_details.voucher_type
		, voucher_details.voucher_detail_type
		, voucher_details.dr_cr
		, voucher_details.parent_voucher_detail_id
		, voucher_details.monday_final
		, voucher_details.remarks
		, voucher_details.remarks1
		, voucher_details.remarks2
		, voucher_details.remarks3
		, voucher_details.proof_image
		, voucher_details.transaction_id
		, voucher_details.reference_id
		, voucher_details.is_processed
		, voucher_details.description
		, voucher_details.whitelabel_id
		FROM voucher_details
		where voucher_details.record_status = 0 
		and voucher_details.voucher_type <> 2
		and voucher_details.user_id = varuser_id
	),
	a as 
	(
		SELECT 
		vd.voucher_id
		, vd.parent_voucher_detail_id
		, vd.monday_final
		, vd.proof_image
		, vd.transaction_id
		, vd.reference_id
		, vd.is_processed
		, vd.description
		, vd.whitelabel_id
		, vd.user_id
		, vd.opposite_user_id
		, vd.role
		, vd.voucher_type
		, vd.voucher_detail_type
		, vd.amount
		, vd.dr_cr
		
		, v.status
		, v.method
		, v.reference
		, vd.remarks
		, vd.remarks1
		, vd.remarks2
		, vd.remarks3
		, v.event_type_id
		, v.competition_id
		, v.event_id
		, v.market_id
		, v.approved_by
		, v.approved_date
		, v.voucher_date
		, v.added_by
		, v.added_date
		, v.update_by
		, v.update_date
		, v.record_status
		FROM v join vd on v.voucher_id = vd.voucher_id
	),
	user_opening as 
	(
		select sum((CASE WHEN dr_cr = 1 THEN amount ELSE -amount END)) 
			as openingamount
		from a 
		where a.voucher_date < varfromdate
	),
	final_ledger as 
	(
		SELECT 
		 0 as orderflag
		, null as voucher_id
		, varfromdate as voucher_date
		, null as parent_voucher_detail_id
		, null as monday_final
		, null as proof_image
		, null as transaction_id
		, null as reference_id
		, null as is_processed
		, null as description
		, null as whitelabel_id
		, varuser_id as user_id
		, null as opposite_user_id
		, null as role
		, null as voucher_type
		, null as voucher_detail_type
		, openingamount as credit
		, null as status
		, null as method
		, null as reference
		, 'Opening' as remarks
		, null as remarks1
		, null as remarks2
		, null as remarks3
		, null as event_type_id
		, null as competition_id
		, null as event_id
		, null as market_id
		, null as approved_by
		, null as approved_date
		, null as added_by
		, null as added_date
		, null as update_by
		, null as update_date
		, null as record_status
		FROM user_opening
		
		UNION all

		SELECT 
		 1 as orderflag
		, (case when a.voucher_type = 1 then a.voucher_id else null end) as voucher_id
		, a.voucher_date
		, a.parent_voucher_detail_id
		, a.monday_final
		, a.proof_image
		, a.transaction_id
		, a.reference_id
		, a.is_processed
		, a.description
		, a.whitelabel_id
		, a.user_id
		, a.opposite_user_id
		, a.role
		, a.voucher_type
		, a.voucher_detail_type
		, sum(CASE WHEN a.dr_cr = 1 THEN a.amount ELSE -a.amount END) as credit
		, a.status
		, a.method
		, a.reference
		, a.remarks
		, a.remarks1
		, a.remarks2
		, a.remarks3
		, a.event_type_id
		, a.competition_id
		, a.event_id
		, a.market_id
		, a.approved_by
		, a.approved_date
		, a.added_by
		, a.added_date
		, a.update_by
		, a.update_date
		, a.record_status
		FROM a 
		where a.voucher_date BETWEEN varfromdate and vartodate
		group by 	
		(case when a.voucher_type = 1 then a.voucher_id else null end) 
		, a.parent_voucher_detail_id
		, a.monday_final
		, a.proof_image
		, a.transaction_id
		, a.reference_id
		, a.is_processed
		, a.description
		, a.whitelabel_id
		, a.user_id
		, a.opposite_user_id
		, a.role
		, a.voucher_type
		, a.voucher_detail_type
		, a.status
		, a.method
		, a.reference
		, a.remarks
		, a.remarks1
		, a.remarks2
		, a.remarks3
		, a.event_type_id
		, a.competition_id
		, a.event_id
		, a.market_id
		, a.approved_by
		, a.approved_date
		, a.voucher_date
		, a.added_by
		, a.added_date
		, a.update_by
		, a.update_date
		, a.record_status
		
	)
	select 
		  final_ledger.voucher_id
		, final_ledger.voucher_date
		, final_ledger.parent_voucher_detail_id
		, final_ledger.monday_final
		, final_ledger.proof_image
		, final_ledger.transaction_id
		, final_ledger.reference_id
		, final_ledger.is_processed
		, final_ledger.description
		, final_ledger.whitelabel_id
		, final_ledger.user_id
		, final_ledger.opposite_user_id
		, final_ledger.role
		, final_ledger.voucher_type
		, final_ledger.voucher_detail_type
		, (CASE WHEN final_ledger.credit > 0 THEN final_ledger.credit ELSE 0 END) as credit
		, (CASE WHEN final_ledger.credit <= 0 THEN -final_ledger.credit ELSE 0 END) as debit
		, final_ledger.status
		, final_ledger.method
		, final_ledger.reference
		, final_ledger.remarks
		, final_ledger.remarks1
		, final_ledger.remarks2
		, final_ledger.remarks3
		, final_ledger.event_type_id
		, final_ledger.competition_id
		, final_ledger.event_id
		, final_ledger.market_id
		, final_ledger.approved_by
		, final_ledger.approved_date
		, final_ledger.added_by
		, final_ledger.added_date
		, final_ledger.update_by
		, final_ledger.update_date
		, final_ledger.record_status
		FROM final_ledger 
		order by final_ledger.orderflag,final_ledger.voucher_date,final_ledger.added_date
	;
	
END;
$function$;


ALTER FUNCTION public.get_user_account_ledger_statement(
    uuid,
    date,
	date
)
    OWNER TO postgres;
/*
select * from get_user_account_ledger_statement('da9b7801-f0b8-4179-9acd-17d314450b2e','2026/04/01','2026/04/20')
*/