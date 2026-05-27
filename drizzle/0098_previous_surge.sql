CREATE TABLE "casino_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"user_id" uuid NOT NULL,
	"round_id" varchar(100),
	"game_id" integer,
	"game_name" varchar(100),
	"game_type" varchar(50),
	"currency" varchar(3),
	"amount" numeric(20, 4) NOT NULL,
	"sw_bet_transaction_id" varchar(100),
	"balance_before" numeric(15, 2),
	"balance_after" numeric(15, 2),
	"request_id" varchar(100),
	"status" varchar(20) DEFAULT 'applied' NOT NULL,
	"raw_payload" jsonb,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "casino_transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
ALTER TABLE "casino_transactions" ADD CONSTRAINT "casino_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;