CREATE TABLE "ledger_limit" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"user_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"user_limit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"limit_consumed" numeric(15, 2) DEFAULT '0' NOT NULL,
	"limit_consumed_after_declare" numeric(15, 2) DEFAULT '0' NOT NULL,
	"final_limit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"added_by" uuid,
	"added_at" timestamp DEFAULT now(),
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ledger_limit" ADD CONSTRAINT "ledger_limit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;