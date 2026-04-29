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
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 100) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 100) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 100)::int % 10) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
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
			(case when matka_transaction_details.number::integer = table_num.nums then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 1 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 100) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 2 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 100) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 3 then
			(case when matka_transaction_details.number::integer = (table_num.nums % 10) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 4 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 100)::int % 10) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
		when number_type = 5 then
			(case when matka_transaction_details.number::integer = (FLOOR(table_num.nums / 10)::int % 10) then matka_transaction_details.amount * rate else - matka_transaction_details.amount end)
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