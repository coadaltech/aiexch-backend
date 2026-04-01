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
      ,td.runner_id
	  ,- round((sum((case when td.bet_type = 0 then 1 else -1 end) 
	  	*
		  (case when market_id_runners.runner_id = td.runner_id then 
		  		(case when td.is_user_selection = TRUE then
					td.potential_return - td.stake
				  else
					0
				  end)
			else
				(case when td.is_user_selection = TRUE then
					0
				  else
					- td.stake
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
		)),2) 
		as runner_profit 
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id 
	  and COALESCE(t.record_status,0) = 0 
	  and COALESCE(td.record_status,0) = 0 
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
	group by t.market_id, td.runner_id
	;
	
END;
$function$;

/*
drop FUNCTION public.get_hissa_of_group_fancy
*/

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
$function$;