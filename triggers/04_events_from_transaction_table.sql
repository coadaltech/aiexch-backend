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
$function$;
