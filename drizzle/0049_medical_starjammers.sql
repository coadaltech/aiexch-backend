CREATE TABLE "voucher_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_group_id" integer,
	"amount" numeric(15, 2) NOT NULL,
	"commission_percent" numeric(5, 2),
	"account_type" varchar(20),
	"description" varchar(255),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "type" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 2);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "user_group_id" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "ledger_field" varchar(20);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "withdrawal_address" text;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD CONSTRAINT "voucher_details_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_details" ADD CONSTRAINT "voucher_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "txn_hash";--> statement-breakpoint
ALTER TABLE "vouchers" DROP COLUMN "withdrawl_address";