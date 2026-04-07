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