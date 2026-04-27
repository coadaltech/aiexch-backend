DROP function get_limituse_of_user_detail;

CREATE OR REPLACE FUNCTION public.get_limituse_of_user_detail(
	varuser_id uuid)
    RETURNS TABLE(market_id numeric
      ,shift_id uuid
      ,intFlag INTEGER
      ,limit_use numeric
      ,sportName varchar
	  ,market_name varchar
      ,competitionName varchar
      ,eventName varchar
	  ,ShiftName varchar)
 LANGUAGE plpgsql
AS $function$
BEGIN
RETURN QUERY
WITH trans as  
	(	
		select t.id,t.market_id,t.market_type
		,t.event_type_id
		,t.competition_id
		,t.match_id
		,t.market_name
		FROM transactions t
		WHERE t.status = 'matched'
		AND t.user_id = varuser_id
		and t.record_status = 0
	),
	trans_det as  
	(	
		select t.market_id,t.market_type,td.bet_type,td.runner_id
		,td.potential_return,td.stake,td.run,td.is_user_selection
		,t.event_type_id
		,t.competition_id
		,t.match_id
		,t.market_name
		FROM trans t
		join transaction_details td on t.id = td.transaction_id
		and td.record_status = 0
	),
	market_profit AS 
	(
	SELECT
	  td.market_id
	  ,sum(td.potential_return) as runner_profit 
	  ,td.event_type_id
	  ,td.competition_id
	  ,td.match_id
	  ,td.market_name
    FROM trans_det as td
    WHERE td.market_type in (0,1,2,3)
    group by td.market_id, td.runner_id
	  ,td.event_type_id
	  ,td.competition_id
	  ,td.match_id
	  ,td.market_name
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
	  ,td.event_type_id
	  ,td.competition_id
	  ,td.match_id
	  ,td.market_name
    FROM trans_det as td
	join (
		SELECT distinct td2.market_id
		,(case when td2.bet_type = 1 then td2.run else td2.run - 1 end) as run
		FROM trans_det as td2
		  where td2.market_type = 4
	) as market_id_runs on market_id_runs.market_id = td.market_id 
    WHERE td.market_type = 4
	group by td.market_id,market_id_runs.run
	  ,td.event_type_id
	  ,td.competition_id
	  ,td.match_id
	  ,td.market_name
	),
	minlimit_marketid AS 
    (SELECT
	  COALESCE(min((case when mp.runner_profit <= 0 then mp.runner_profit else 0 end)),0) as limit_use
	  ,mp.market_id
	  ,'00000000-0000-0000-0000-000000000000' shift_id
	  ,0 as intFlag
	  ,mp.event_type_id
	  ,mp.competition_id
	  ,mp.match_id
	  ,mp.market_name
      FROM market_profit mp
      GROUP BY mp.market_id
	  ,mp.event_type_id
	  ,mp.competition_id
	  ,mp.match_id
	  ,mp.market_name
	  UNION ALL
	  select -sum(matka_transactions.total_amount) as limit_use
	  ,0 as market_id
	  ,matka_transactions.shift_id
	  ,1 as intFlag 
	  ,0 event_type_id
	  ,0 competition_id
	  ,0 match_id
	  ,'' market_name
	  from matka_transactions
	  where matka_transactions.user_id = varuser_id and matka_transactions.record_status = 0
	  group by matka_transactions.shift_id
	)

	SELECT
	  (case when t.intFlag = 0 then t.market_id else 0 end) as market_id
      ,(case when t.intFlag = 1 then t.shift_id else '00000000-0000-0000-0000-000000000000' end) as shift_id
      ,t.intFlag
      ,-t.limit_use as limit_use
      ,(case when t.intFlag = 0 then s.name else '' end) as sportName
	  ,(case when t.intFlag = 0 then t.market_name else '' end) as market_name
      ,(case when t.intFlag = 0 then c.name else '' end) as competitionName
      ,(case when t.intFlag = 0 then e.name else '' end) as eventName
	  ,(case when t.intFlag = 1 then matka_shifts.name else '' end) as ShiftName
    FROM minlimit_marketid t
    LEFT JOIN sports       s ON s.sport_id        = t.event_type_id
	LEFT JOIN competitions c ON c.competition_id  = t.competition_id
	LEFT JOIN events       e ON e.event_id        = t.match_id
	LEFT JOIN matka_shifts   ON matka_shifts.id   = t.shift_id
	;
	
END;
$function$
;

ALTER FUNCTION public.get_limituse_of_user_detail(uuid)
    OWNER TO postgres;