-- ═══════════════════════════════════════════════════════════════════════════
-- Voucher Detail → Ledger Limit triggers
-- Functions MUST be created before the triggers that reference them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. AFTER INSERT OR UPDATE ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_voucher_detail_ledger_after_insert_update()
    RETURNS trigger
    LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
    UPDATE ledger_limit
       SET user_balance = user_balance + (CASE WHEN NEW.record_status <> 1 THEN (CASE WHEN NEW.dr_cr = 1 THEN NEW.amount ELSE -NEW.amount END) ELSE 0 END)
           ,user_limit   = user_limit + (CASE WHEN NEW.record_status <> 1 THEN (CASE WHEN NEW.voucher_type = 2 THEN (CASE WHEN NEW.dr_cr=1 THEN NEW.amount ELSE -NEW.amount END) ELSE 0 END) ELSE 0 END)
           ,final_limit  = user_limit + (CASE WHEN NEW.record_status <> 1 THEN (CASE WHEN NEW.dr_cr = 1 THEN NEW.amount ELSE -NEW.amount END) ELSE 0 END) - limit_consumed
     WHERE user_id = NEW.user_id
	 ;
  RETURN NEW;
END;
$BODY$;

ALTER FUNCTION public.trg_voucher_detail_ledger_after_insert_update()
    OWNER TO postgres;

CREATE OR REPLACE TRIGGER trg_voucher_detail_ledger_after_insert_update
    AFTER INSERT OR UPDATE
    ON public.voucher_details
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_voucher_detail_ledger_after_insert_update();


-- ── 2. BEFORE UPDATE ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_voucher_detail_ledger_before_update()
    RETURNS trigger
    LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
    UPDATE ledger_limit
       SET user_balance = user_balance - (CASE WHEN OLD.record_status <> 1 THEN (CASE WHEN OLD.dr_cr = 1 THEN OLD.amount ELSE -OLD.amount END) ELSE 0 END)
           ,user_limit   = user_limit - (CASE WHEN OLD.record_status <> 1 THEN (CASE WHEN OLD.voucher_type = 2 THEN (CASE WHEN OLD.dr_cr=1 THEN OLD.amount ELSE -OLD.amount END) ELSE 0 END) ELSE 0 END)
           ,final_limit  = user_limit - (CASE WHEN OLD.record_status <> 1 THEN (CASE WHEN OLD.dr_cr = 1 THEN OLD.amount ELSE -OLD.amount END) ELSE 0 END) - limit_consumed
     WHERE user_id = OLD.user_id
	 ;
  RETURN NEW;
END;
$BODY$;

ALTER FUNCTION public.trg_voucher_detail_ledger_before_update()
    OWNER TO postgres;

CREATE OR REPLACE TRIGGER trg_voucher_detail_ledger_before_update
    BEFORE UPDATE
    ON public.voucher_details
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_voucher_detail_ledger_before_update();


-- ── 3. BEFORE DELETE ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_voucher_detail_ledger_before_delete()
    RETURNS trigger
    LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
    UPDATE ledger_limit
       SET user_balance = user_balance - (CASE WHEN OLD.record_status <> 1 THEN (CASE WHEN OLD.dr_cr = 1 THEN OLD.amount ELSE -OLD.amount END) ELSE 0 END)
           ,user_limit   = user_limit - (CASE WHEN OLD.record_status <> 1 THEN (CASE WHEN OLD.voucher_type = 2 THEN (CASE WHEN OLD.dr_cr=1 THEN OLD.amount ELSE -OLD.amount END) ELSE 0 END) ELSE 0 END)
           ,final_limit  = user_limit - (CASE WHEN OLD.record_status <> 1 THEN (CASE WHEN OLD.dr_cr = 1 THEN OLD.amount ELSE -OLD.amount END) ELSE 0 END) - limit_consumed
     WHERE user_id = OLD.user_id
	 ;
  RETURN OLD;
END;
$BODY$;

ALTER FUNCTION public.trg_voucher_detail_ledger_before_delete()
    OWNER TO postgres;

CREATE OR REPLACE TRIGGER trg_voucher_detail_ledger_before_delete
    BEFORE DELETE
    ON public.voucher_details
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_voucher_detail_ledger_before_delete();
