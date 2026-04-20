CREATE TABLE "declare_result" (
	"declare_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"declare_date" date NOT NULL,
	"declare_number" integer NOT NULL,
	"is_needed" integer DEFAULT 0,
	"redeclare_nos" integer DEFAULT 0,
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_transaction_commissions_declare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matka_transaction_id" uuid NOT NULL,
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
CREATE TABLE "matka_transaction_details_declare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"number_type" integer NOT NULL,
	"number" varchar(4) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"rate" numeric(10, 2) NOT NULL,
	"commission" numeric(10, 2) DEFAULT '0' NOT NULL,
	"final_amount" numeric(15, 2) NOT NULL,
	"order_number" integer DEFAULT 0 NOT NULL,
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_transaction_logs_declare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matka_transaction_id" uuid NOT NULL,
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
CREATE TABLE "matka_transactions_declare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid,
	"transaction_date" date NOT NULL,
	"dara_rate" numeric(10, 2) NOT NULL,
	"dara_commission" numeric(10, 2) NOT NULL,
	"akhar_rate" numeric(10, 2) NOT NULL,
	"akhar_commission" numeric(10, 2) NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_commission" numeric(15, 2) DEFAULT '0' NOT NULL,
	"final_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"device_type" varchar(10) DEFAULT 'WEB' NOT NULL,
	"copy_reference_shift_id" uuid,
	"whitelabel_id" uuid,
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" DROP CONSTRAINT "matka_transaction_commissions_matka_transaction_id_matka_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" DROP CONSTRAINT "matka_transaction_commissions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" DROP CONSTRAINT "matka_transaction_logs_matka_transaction_id_matka_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" DROP CONSTRAINT "matka_transaction_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction_commissions" DROP CONSTRAINT "transaction_commissions_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction_commissions" DROP CONSTRAINT "transaction_commissions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction_logs" DROP CONSTRAINT "transaction_logs_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction_logs" DROP CONSTRAINT "transaction_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "shift_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000';--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "shift_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000';--> statement-breakpoint
ALTER TABLE "matka_transaction_commissions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "matka_transaction_logs" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "transaction_commissions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "transaction_commissions_declare" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "transaction_logs" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "transaction_logs_declare" DROP COLUMN "user_id";