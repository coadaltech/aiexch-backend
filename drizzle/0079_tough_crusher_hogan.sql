CREATE TABLE "transaction_commissions_declare" (
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
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_details_declare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"runner_id" bigint NOT NULL,
	"runner_name" varchar(255),
	"is_user_selection" boolean DEFAULT false NOT NULL,
	"bet_type" integer,
	"price" numeric(10, 4) NOT NULL,
	"run" integer DEFAULT 0,
	"stake" numeric(15, 2) NOT NULL,
	"potential_return" numeric(15, 2) NOT NULL,
	"added_by" uuid NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_logs_declare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
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
CREATE TABLE "transactions_declare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"whitelabel_id" uuid,
	"event_type_id" bigint NOT NULL,
	"competition_id" bigint,
	"match_id" bigint NOT NULL,
	"market_id" numeric NOT NULL,
	"market_name" varchar(255),
	"market_type" integer DEFAULT 0 NOT NULL,
	"selection_id" bigint NOT NULL,
	"selection_name" varchar(255),
	"bet_type" integer NOT NULL,
	"stake" numeric(15, 2) NOT NULL,
	"odds" numeric(10, 4) NOT NULL,
	"status" varchar(20) DEFAULT 'matched',
	"settled_amount" numeric(15, 2),
	"ip_address" varchar(45),
	"matched_at" timestamp,
	"settled_at" timestamp,
	"cancelled_at" timestamp,
	"result_checked_at" timestamp,
	"added_by" uuid NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" DROP CONSTRAINT "matka_transaction_commissions_matka_transaction_id_matka_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" DROP CONSTRAINT "matka_transaction_commissions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transaction_details" DROP CONSTRAINT "matka_transaction_details_transaction_id_matka_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" DROP CONSTRAINT "matka_transaction_logs_matka_transaction_id_matka_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" DROP CONSTRAINT "matka_transaction_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transactions" DROP CONSTRAINT "matka_transactions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transactions" DROP CONSTRAINT "matka_transactions_shift_id_matka_shifts_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transactions" ALTER COLUMN "shift_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" ADD CONSTRAINT "matka_transaction_commissions_matka_transaction_id_matka_transactions_id_fk" FOREIGN KEY ("matka_transaction_id") REFERENCES "public"."matka_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" ADD CONSTRAINT "matka_transaction_commissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transaction_details" ADD CONSTRAINT "matka_transaction_details_transaction_id_matka_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."matka_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" ADD CONSTRAINT "matka_transaction_logs_matka_transaction_id_matka_transactions_id_fk" FOREIGN KEY ("matka_transaction_id") REFERENCES "public"."matka_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" ADD CONSTRAINT "matka_transaction_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transactions" ADD CONSTRAINT "matka_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transactions" ADD CONSTRAINT "matka_transactions_shift_id_matka_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."matka_shifts"("id") ON DELETE set null ON UPDATE no action;