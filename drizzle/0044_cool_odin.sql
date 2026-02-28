CREATE TABLE "transaction_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"runner_id" varchar(100) NOT NULL,
	"runner_name" varchar(255),
	"is_user_selection" boolean DEFAULT false NOT NULL,
	"price" numeric(10, 4) NOT NULL,
	"stake" numeric(15, 2) NOT NULL,
	"potential_return" numeric(15, 2) NOT NULL,
	"actual_return" numeric(15, 2)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"whitelabel_id" uuid,
	"event_type_id" varchar(50) NOT NULL,
	"match_id" varchar(100) NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"market_name" varchar(255),
	"market_type" varchar(20) DEFAULT 'odds',
	"selection_id" varchar(100) NOT NULL,
	"selection_name" varchar(255),
	"bet_type" varchar(10) NOT NULL,
	"stake" numeric(15, 2) NOT NULL,
	"odds" numeric(10, 4) NOT NULL,
	"potential_payout" numeric(15, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'matched',
	"settled_amount" numeric(15, 2),
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now(),
	"matched_at" timestamp,
	"settled_at" timestamp,
	"cancelled_at" timestamp,
	"result_checked_at" timestamp
);
--> statement-breakpoint
DROP TABLE "bets" CASCADE;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD CONSTRAINT "transaction_details_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;