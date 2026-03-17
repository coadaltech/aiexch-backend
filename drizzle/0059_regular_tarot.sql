ALTER TABLE "voucher_details" ADD COLUMN "opposite_ledger_id" integer;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "parent_voucher_detail_id" uuid;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "proof_image" text;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "reference_id" varchar(255);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "record_status" varchar(1) DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "monday_final" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "is_processed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "event_id" varchar(100);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "market_id" varchar(100);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "event_type_id" varchar(100);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "competition_id" varchar(100);--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "commission_percent";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "balance_before";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "balance_after";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "account_type";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "event_id";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "market_id";--> statement-breakpoint
ALTER TABLE "voucher_details" DROP COLUMN "bet_id";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "ledger_field";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "proof_image";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "withdrawal_address";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "transaction_id";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "reference_id";