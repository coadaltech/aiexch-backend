-- ══════════════════════════════════════════════════════════════════════
-- transactions.market_type  varchar → integer
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE "transactions" ALTER COLUMN "market_type" SET DATA TYPE integer
  USING CASE LOWER(market_type)
    WHEN 'bookmaker'  THEN 1
    WHEN 'bookmakers'  THEN 1
    WHEN 'line'        THEN 2
    WHEN 'sessions'    THEN 2
    ELSE 0
  END;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "market_type" SET NOT NULL;--> statement-breakpoint

-- ══════════════════════════════════════════════════════════════════════
-- voucher_details
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE "voucher_details" ALTER COLUMN "role" SET DATA TYPE integer
  USING CASE LOWER(role::text)
    WHEN 'owner'       THEN 0
    WHEN 'super_admin' THEN 1
    WHEN 'admin'       THEN 2
    WHEN 'super_master' THEN 3
    WHEN 'master'      THEN 4
    WHEN 'agent'       THEN 5
    WHEN 'user'        THEN 6
    ELSE 6
  END;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "dr_cr" SET DATA TYPE integer
  USING CASE LOWER(dr_cr::text)
    WHEN 'debit'  THEN 0
    WHEN 'dr'     THEN 0
    WHEN 'credit' THEN 1
    WHEN 'cr'     THEN 1
    ELSE 0
  END;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "added_by" SET DATA TYPE uuid
  USING CASE WHEN added_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN added_by::uuid ELSE NULL END;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "added_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "added_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "added_date" SET DATA TYPE date USING added_date::date;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "update_by" SET DATA TYPE uuid
  USING CASE WHEN update_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN update_by::uuid ELSE NULL END;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "update_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "update_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "update_date" SET DATA TYPE date USING update_date::date;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "update_date" SET DEFAULT now();--> statement-breakpoint

-- ══════════════════════════════════════════════════════════════════════
-- vouchers
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE "vouchers" ALTER COLUMN "type" SET DATA TYPE integer
  USING CASE LOWER(type::text)
    WHEN 'credit'     THEN 0
    WHEN 'debit'      THEN 1
    WHEN 'limit'      THEN 2
    WHEN 'deposit'    THEN 3
    WHEN 'withdraw'   THEN 4
    WHEN 'bonus'      THEN 5
    WHEN 'settlement' THEN 6
    ELSE 0
  END;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "status" SET DATA TYPE integer
  USING CASE LOWER(status::text)
    WHEN 'pending'  THEN 0
    WHEN 'approved' THEN 1
    WHEN 'rejected' THEN 2
    ELSE 0
  END;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "remarks" SET DATA TYPE varchar(200) USING LEFT(remarks, 200);--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "added_by" SET DATA TYPE uuid
  USING CASE WHEN added_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN added_by::uuid ELSE NULL END;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "added_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "added_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "added_date" SET DATA TYPE date USING added_date::date;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "update_by" SET DATA TYPE uuid
  USING CASE WHEN update_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN update_by::uuid ELSE NULL END;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "update_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "update_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "update_date" SET DATA TYPE date USING update_date::date;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "update_date" SET DEFAULT now();--> statement-breakpoint

-- New columns
ALTER TABLE "voucher_details" ADD COLUMN IF NOT EXISTS "opposite_user_id" uuid;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN IF NOT EXISTS "remarks" varchar(200);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN IF NOT EXISTS "remarks1" varchar(200);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN IF NOT EXISTS "remarks2" varchar(200);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN IF NOT EXISTS "remarks3" varchar(200);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "remarks1" varchar(200);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "remarks2" varchar(200);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "remarks3" varchar(200);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "approved_date" date;--> statement-breakpoint

-- Drop old columns
ALTER TABLE "voucher_details" DROP COLUMN IF EXISTS "user_group_id";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN IF EXISTS "opposite_ledger_id";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "user_group_id";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "approved_at";--> statement-breakpoint

-- ══════════════════════════════════════════════════════════════════════
-- market_settings.betting_type  varchar → integer
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE "market_settings" ALTER COLUMN "betting_type" SET DATA TYPE integer
  USING CASE UPPER(betting_type)
    WHEN 'BOOKMAKER'  THEN 1
    WHEN 'BOOKMAKERS' THEN 1
    WHEN 'LINE'       THEN 2
    WHEN 'SESSIONS'   THEN 2
    ELSE 0
  END;--> statement-breakpoint
ALTER TABLE "market_settings" ALTER COLUMN "betting_type" SET DEFAULT 0;
