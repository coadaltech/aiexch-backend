CREATE TABLE "casino_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_transaction_id" varchar(100) NOT NULL,
	"provider_round_id" varchar(100),
	"user_id" uuid NOT NULL,
	"total_pl" numeric(15, 2),
	"total_exposure_released" numeric(15, 2),
	"raw_payload" jsonb,
	"status" varchar(20) DEFAULT 'applied' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "casino_settlements_provider_txn_uniq" UNIQUE("provider","provider_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "casino_bets" ADD COLUMN "payout" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "casino_bets" ADD COLUMN "outcome" varchar(20);--> statement-breakpoint
ALTER TABLE "casino_bets" ADD COLUMN "settled_by" uuid;--> statement-breakpoint
ALTER TABLE "casino_settlements" ADD CONSTRAINT "casino_settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;