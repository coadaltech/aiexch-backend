-- Drop existing functions and procedure before recreating
DROP FUNCTION IF EXISTS public.get_limituse_of_user_market(uuid, numeric);
DROP FUNCTION IF EXISTS public.get_limituse_of_user_market_fancy(uuid, numeric);
DROP PROCEDURE IF EXISTS set_limit_used_of_user(uuid);

-- Procedure: Recalculates and updates limit_consumed and final_limit in ledger_limit for a user.
-- Call after every bet placement, cancellation, or settlement.
-- Handles both regular markets (market_type <> 4) and fancy/session markets (market_type = 4).

-- CREATE OR REPLACE PROCEDURE public.set_limit_used_of_user(
-- 	IN varuser_id uuid)
-- LANGUAGE 'plpgsql'
-- AS $BODY$
-- BEGIN
-- WITH market_profit AS 
-- 	(
-- 	SELECT
-- 	  t.market_id
--       --,market_id_runners.runner_id
-- 	  ,sum((case when td.bet_type = 0 then 1 else -1 end) 
-- 	  	*
-- 		  (case when market_id_runners.runner_id = td.runner_id then 
-- 		  		td.potential_return - td.stake
-- 			else
-- 				- td.stake
-- 			end) 
-- 	  	) as runner_profit 
--     FROM transactions t
--     JOIN transaction_details td
--       ON td.transaction_id = t.id 
-- 	  and COALESCE(t.record_status,0) = 0 
-- 	  and COALESCE(td.record_status,0) = 0 
-- 	  and td.is_user_selection = TRUE 
-- 	left join (SELECT
--       t2.market_id
--       ,td2.runner_id
-- 		FROM transactions t2
-- 	    JOIN transaction_details td2
-- 	      ON td2.transaction_id = t2.id 
-- 		  and COALESCE(t2.record_status,0) = 0 
-- 		  and COALESCE(td2.record_status,0) = 0       	  
-- 		group by t2.market_id, td2.runner_id
-- 	) as market_id_runners on market_id_runners.market_id = t.market_id 
--     WHERE t.status = 'matched'
--       AND t.market_type <> 4
--       AND t.user_id = varuser_id
-- 	group by t.market_id, market_id_runners.runner_id

-- 	union ALL
-- 	SELECT
-- 	  t.market_id
--       --,td.runner_id
-- 	  --,td.run
-- 	  --,td.bet_type
-- 	  --,market_id_runs.run
-- 	  ,sum((case when td.bet_type = 1 then 
-- 	  	  (case when td.run <= market_id_runs.run then 
-- 		  		- td.stake
-- 			else
-- 				+ td.potential_return
-- 			end) 
-- 		else
-- 	  	  (case when td.run > market_id_runs.run then 
-- 		  		- td.stake
-- 			else
-- 				+ td.potential_return
-- 			end) 
-- 		end)
-- 	  	)as runner_profit 
--     FROM transactions t
--     JOIN transaction_details td
--       ON td.transaction_id = t.id 
-- 	  and COALESCE(t.record_status,0) = 0 
-- 	  and COALESCE(td.record_status,0) = 0 
-- 	left join (
-- 		SELECT distinct t2.market_id
-- 		,(case when td2.bet_type = 1 then td2.run else td2.run - 1 end) as run
-- 		FROM transactions t2
-- 	    JOIN transaction_details td2
-- 	      ON td2.transaction_id = t2.id 
-- 		  and COALESCE(t2.record_status,0) = 0 
-- 		  and COALESCE(td2.record_status,0) = 0 
-- 		  where t2.market_type = 4
-- 	  	  --and (t2.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
-- 	) as market_id_runs on market_id_runs.market_id = t.market_id 
    
-- 	WHERE t.status = 'matched'
--       AND t.market_type = 4
--       AND t.user_id = varuser_id
-- 	  --and (t.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
-- 	group by t.market_id,market_id_runs.run
-- 	),
-- 	minlimit_marketid AS 
--     (SELECT
-- 	  mp.market_id
-- 	  ,COALESCE(min((case when mp.runner_profit <= 0 then mp.runner_profit else 0 end)),0) as limit_use
--       FROM market_profit mp
--       GROUP BY mp.market_id
-- 	)
-- 	update ledger_limit set limit_consumed = COALESCE((select -sum(limit_use) from minlimit_marketid),0)
-- 	where user_id = varuser_id 
-- 	; 
-- 	update ledger_limit set final_limit = COALESCE(user_limit,0) - COALESCE(limit_consumed,0)
-- 	where user_id = varuser_id 
-- 	;
-- END;
-- $BODY$;

-- ALTER PROCEDURE public.set_limit_used_of_user(uuid)
--     OWNER TO postgres;


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
	  ,sum(td.potential_return) as runner_profit 
    FROM trans_det as td
    WHERE td.market_type in (0,1,2,3)
    group by td.market_id, td.runner_id

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
	  select -sum(total_amount) from matka_transactions
	  where user_id = varuser_id and record_status = 0
	  UNION ALL
	  -- Casino bets: each matched bet's worst-case loss is its `exposure`
	  -- (Ace sets this per bet — for BACK it equals stake, for LAY it's the
	  -- liability = (odds-1)*stake). Helper guarantees exposure is populated
	  -- (falls back to stake for QT). Settled bets (status != 'matched') are
	  -- excluded automatically.
	  select -sum(coalesce(exposure, stake)) from casino_bets
	  where user_id = varuser_id and status = 'matched' and record_status = 0
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


/*
call set_limit_used_of_user('650513c6-2715-43f7-989d-bb2f66b90b83')
*/

/*drop function get_profit_of_user_market
;
*/
CREATE OR REPLACE FUNCTION public.get_limituse_of_user_market(varuser_id uuid, varmarket_id numeric)
 RETURNS TABLE(market_id numeric,runner_id bigint, runner_profit numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
RETURN QUERY
	SELECT
	  t.market_id
      ,market_id_runners.runner_id
	  ,sum((case when td.bet_type = 0 then 1 else -1 end) 
	  	*
		  (case when market_id_runners.runner_id = td.runner_id then 
		  		td.potential_return - td.stake
			else
				- td.stake
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
$function$;

/*
select * from get_limituse_of_user_market('650513c6-2715-43f7-989d-bb2f66b90b83',1.255200877)
;
*/


/*
drop function public.get_limituse_of_user_market_fancy
*/
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
		  		- td.stake
			else
				+ td.potential_return
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
$function$;