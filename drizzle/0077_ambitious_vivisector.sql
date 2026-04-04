CREATE TABLE "matka_transaction_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matka_transaction_id" uuid NOT NULL,
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
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_transaction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matka_transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"browser" varchar(100),
	"browser_version" varchar(50),
	"os" varchar(100),
	"os_version" varchar(50),
	"device_type" varchar(20),
	"device_brand" varchar(100),
	"device_model" varchar(100),
	"country" varchar(100),
	"city" varchar(100),
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_results" ADD COLUMN "runs" integer;--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" ADD CONSTRAINT "matka_transaction_commissions_matka_transaction_id_matka_transactions_id_fk" FOREIGN KEY ("matka_transaction_id") REFERENCES "public"."matka_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" ADD CONSTRAINT "matka_transaction_commissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" ADD CONSTRAINT "matka_transaction_logs_matka_transaction_id_matka_transactions_id_fk" FOREIGN KEY ("matka_transaction_id") REFERENCES "public"."matka_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" ADD CONSTRAINT "matka_transaction_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_shifts" DROP COLUMN "result";