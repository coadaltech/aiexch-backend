-- CREATE OR REPLACE FUNCTION public.get_user_matka_jantri(
--     varuser_id uuid,
--     varshift_id uuid
-- )
-- RETURNS TABLE(shift_id uuid, nums integer,amount numeric, profit numeric)  -- added 'run' column
-- LANGUAGE plpgsql
-- AS $function$
-- BEGIN
--     RETURN QUERY
--     WITH table_num AS (
--         SELECT generate_series AS nums
--         FROM generate_series(1, 100)
--     )
--     SELECT varshift_id as shift_id, table_num.nums
-- 	,sum((case when number_type = 1 then 
-- 		(case when matka_transaction_details.number::integer = table_num.nums then amount else 0 end)
-- 	when number_type = 2 then
-- 		(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then amount/10 else 0 end)
-- 	when number_type = 3 then
-- 		(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then amount/10 else 0 end)
-- 	else 0 end)) as amount
-- 	,sum((case when number_type = 1 then 
-- 		(case when matka_transaction_details.number::integer = table_num.nums then amount * rate else - amount end)
-- 	when number_type = 2 then
-- 		(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then amount * rate else - amount end)
-- 	when number_type = 3 then
-- 		(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then amount * rate else - amount end)
-- 	else 0 end)) as profit
-- 	FROM table_num 
-- 	join matka_transactions mt on matka_transactions.user_id = varuser_id
-- 		and matka_transactions.shift_id = varshift_id
-- 		and mt.record_status = 0
-- 	join matka_transaction_details on matka_transactions.id = matka_transaction_details.transaction_id
-- 		and matka_transaction_details.record_status = 0
-- 	order by table_num.nums
-- 	;
-- END;
-- $function$;

-- ALTER function public.get_user_matka_jantri(uuid,uuid)
--     OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.get_user_matka_jantri_of_group(
    varuser_id uuid,
    varshift_id uuid, 
	varuser_group_type int
	
)
RETURNS TABLE(shift_id uuid, nums integer,amount numeric, profit numeric)  -- added 'run' column
LANGUAGE plpgsql
AS $function$
BEGIN
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
	join matka_transaction_details on matka_transactions.id = matka_transaction_details.transaction_id
		and matka_transaction_details.record_status = 0
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
		,sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount else 0 end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then matka_transaction_details.amount/10 else 0 end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then matka_transaction_details.amount/10 else 0 end)
		else 0 end)) as amount
	
		,- round((sum((case when number_type = 1 then 
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) * 111 then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (round((table_num.nums / 10),0)) * 1111 then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		else 0 end) 
	  	* (
			mtc.owner_percent
		/ 100)
		)),2) as profit
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