-- Drop existing functions and procedure before recreating
DROP FUNCTION IF EXISTS public.get_limituse_of_user_market(uuid, numeric);
DROP FUNCTION IF EXISTS public.get_limituse_of_user_market_fancy(uuid, numeric);
DROP PROCEDURE IF EXISTS set_limit_used_of_user(uuid);

-- Procedure: Recalculates and updates limit_consumed and final_limit in ledger_limit for a user.
-- Call after every bet placement, cancellation, or settlement.
-- Handles both regular markets (market_type <> 4) and fancy/session markets (market_type = 4).

CREATE OR REPLACE PROCEDURE public.set_limit_used_of_user(
	IN varuser_id uuid)
LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
WITH market_profit AS 
	(
	SELECT
	  t.market_id
      --,market_id_runners.runner_id
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
	group by t.market_id, market_id_runners.runner_id

	union ALL
	SELECT
	  t.market_id
      --,td.runner_id
	  --,td.run
	  --,td.bet_type
	  --,market_id_runs.run
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
	  	  --and (t2.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	) as market_id_runs on market_id_runs.market_id = t.market_id 
    
	WHERE t.status = 'matched'
      AND t.market_type = 4
      AND t.user_id = varuser_id
	  --and (t.market_id = varmarket_id or COALESCE(varmarket_id,0) = 0) 
	group by t.market_id,market_id_runs.run
	),
	minlimit_marketid AS 
    (SELECT
	  mp.market_id
	  ,COALESCE(min((case when mp.runner_profit <= 0 then mp.runner_profit else 0 end)),0) as limit_use
      FROM market_profit mp
      GROUP BY mp.market_id
	)
	update ledger_limit set limit_consumed = COALESCE((select -sum(limit_use) from minlimit_marketid),0)
	where user_id = varuser_id 
	; 
	update ledger_limit set final_limit = COALESCE(user_limit,0) - COALESCE(limit_consumed,0)
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