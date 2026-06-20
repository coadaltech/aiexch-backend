CREATE OR REPLACE PROCEDURE public.clean_data_of_all_whitelabel(
	)
LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
	
	
	delete from public.casino_settlements;
	delete from public.casino_transaction_commissions;
	delete from public.casino_transaction_logs;
	delete from public.casino_transactions;

	delete from public.declare_result;
	delete from public.declared_events;

	delete from public.matka_transaction_commissions;
	delete from public.matka_transaction_commissions_declare;
	delete from public.matka_transaction_details;
	delete from public.matka_transaction_details_declare;
	delete from public.matka_transaction_logs;
	delete from public.matka_transaction_logs_declare;
	delete from public.matka_transactions;
	delete from public.matka_transactions_declare;

	delete from public.transaction_commissions;
	delete from public.transaction_commissions_declare;
	delete from public.transaction_details;
	delete from public.transaction_details_declare;
	delete from public.transaction_logs;
    delete from public.transaction_logs_declare;
	delete from public.transactions;
	delete from public.transactions_declare;

	delete from public.vouchers;
	delete from public.voucher_details;

	update public.ledger_limit set user_limit = 0
	,user_balance = 0
	,limit_consumed = 0
	,fix_limit = 0
	,final_limit = 0
	;

END;
$BODY$;
ALTER PROCEDURE public.clean_data_of_all_whitelabel()
    OWNER TO postgres;