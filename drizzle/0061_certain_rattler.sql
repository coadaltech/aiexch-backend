ALTER TABLE "account_statements" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "banners" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "casino_games" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "competition_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "sport_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "currencies" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "currency_value_history" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ALTER COLUMN "market_id" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ALTER COLUMN "selection_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "domains" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "event_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "competition_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "sport_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "home_section_games" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "home_sections" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "kyc_documents" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "ledger_groups" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "ledger_limit" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "market_odds_history" ALTER COLUMN "market_id" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "market_odds_history" ALTER COLUMN "event_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "market_odds_history" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "market_settings" ALTER COLUMN "market_id" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "market_settings" ALTER COLUMN "event_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "market_settings" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "otps" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "popups" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "membership" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "membership" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "promocodes" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "qr_codes" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "runner_settings" ALTER COLUMN "selection_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "runner_settings" ALTER COLUMN "market_id" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "runner_settings" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "sports" ALTER COLUMN "sport_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sports" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "sports_games" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "runner_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "bet_type" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "run" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "added_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "added_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "added_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "update_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "update_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "update_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "update_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transaction_details" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "transaction_logs" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "event_type_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "match_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "market_id" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "selection_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "bet_type" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "matched_at" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "settled_at" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "cancelled_at" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "result_checked_at" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "added_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "added_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "added_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "update_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "update_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "update_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "update_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "user_login_logs" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "user_read_notifications" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 7;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "event_type_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "competition_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "event_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "market_id" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "whitelabels" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "withdrawal_methods" ALTER COLUMN "record_status" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "competition_id" bigint;