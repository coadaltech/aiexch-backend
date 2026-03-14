CREATE TABLE "bet_commission_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid,
	"agent_percent" numeric(5, 2) DEFAULT '0',
	"master_id" uuid,
	"master_percent" numeric(5, 2) DEFAULT '0',
	"super_id" uuid,
	"super_percent" numeric(5, 2) DEFAULT '0',
	"admin_id" uuid,
	"admin_percent" numeric(5, 2) DEFAULT '0',
	"owner_id" uuid,
	"owner_percent" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "dr_cr" varchar(10);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "balance_before" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "balance_after" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "role" varchar(20);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "event_id" varchar(100);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "market_id" varchar(100);--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "bet_id" uuid;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "whitelabel_id" uuid;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "reference_id" varchar(255);--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ADD CONSTRAINT "bet_commission_snapshot_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_commission_snapshot" ADD CONSTRAINT "bet_commission_snapshot_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;