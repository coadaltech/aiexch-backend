ALTER TABLE "ledger_limit" ALTER COLUMN "added_by" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "ledger_limit" ALTER COLUMN "added_by" SET DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "ledger_limit" ALTER COLUMN "added_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account_statements" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_statements" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "account_statements" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_statements" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "account_statements" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "currency_value_history" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "currency_value_history" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "currency_value_history" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "currency_value_history" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "currency_value_history" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_section_games" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_section_games" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "home_section_games" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_section_games" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "home_section_games" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_sections" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_sections" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "home_sections" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_sections" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "home_sections" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_groups" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_groups" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_groups" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_groups" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_groups" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_limit" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_limit" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_limit" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_limit" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_odds_history" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_odds_history" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "market_odds_history" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_odds_history" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "market_odds_history" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "otps" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "otps" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "otps" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "otps" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "otps" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "popups" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "popups" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "popups" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "popups" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "popups" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "promocodes" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "promocodes" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "promocodes" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "promocodes" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "promocodes" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "sports" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "sports" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sports" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "sports" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sports" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_games" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_games" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_games" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_games" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sports_games" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_logs" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_logs" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_logs" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_logs" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_logs" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_login_logs" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_login_logs" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_login_logs" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_login_logs" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_login_logs" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_read_notifications" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_read_notifications" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_read_notifications" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_read_notifications" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_read_notifications" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "whitelabels" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "whitelabels" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "whitelabels" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "whitelabels" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "whitelabels" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_methods" ADD COLUMN "added_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_methods" ADD COLUMN "added_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_methods" ADD COLUMN "update_by" varchar(50) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_methods" ADD COLUMN "update_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_methods" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_statements" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "banners" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "banners" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "currencies" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "currencies" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "currency_value_history" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "custom_market_odds" DROP COLUMN "updated_by";--> statement-breakpoint
ALTER TABLE "custom_market_odds" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "domains" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "domains" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "home_section_games" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "home_section_games" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "home_sections" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "home_sections" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "kyc_documents" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "kyc_documents" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "ledger_groups" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "ledger_groups" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "ledger_groups" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "ledger_groups" DROP COLUMN "updated_by";--> statement-breakpoint
ALTER TABLE "ledger_limit" DROP COLUMN "added_at";--> statement-breakpoint
ALTER TABLE "ledger_limit" DROP COLUMN "updated_by";--> statement-breakpoint
ALTER TABLE "ledger_limit" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "market_odds_history" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "market_settings" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "market_settings" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "otps" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "popups" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "popups" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "promocodes" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "promocodes" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "promotions" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "promotions" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "qr_codes" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "qr_codes" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "runner_settings" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "runner_settings" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "sports" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "sports" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "sports_games" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "sports_games" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "transaction_logs" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "user_login_logs" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "user_read_notifications" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "whitelabels" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "whitelabels" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "withdrawal_methods" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "withdrawal_methods" DROP COLUMN "updated_at";