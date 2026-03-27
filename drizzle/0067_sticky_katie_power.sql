CREATE TABLE "matka_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"shift_date" date NOT NULL,
	"end_time" varchar(30) NOT NULL,
	"shift_order" integer DEFAULT 0 NOT NULL,
	"dara_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
	"dara_commission" numeric(10, 2) DEFAULT '0' NOT NULL,
	"akhar_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
	"akhar_commission" numeric(10, 2) DEFAULT '0' NOT NULL,
	"main_jantri_time" varchar(30),
	"result" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"added_by" varchar(50) DEFAULT 'system' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" varchar(50) DEFAULT 'system' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_transaction_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"number_type" integer NOT NULL,
	"number" varchar(4) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"rate" numeric(10, 2) NOT NULL,
	"commission" numeric(10, 2) DEFAULT '0' NOT NULL,
	"final_amount" numeric(15, 2) NOT NULL,
	"order_number" integer DEFAULT 0 NOT NULL,
	"added_by" varchar(50) DEFAULT 'system' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" varchar(50) DEFAULT 'system' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matka_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"transaction_date" date NOT NULL,
	"dara_rate" numeric(10, 2) NOT NULL,
	"dara_commission" numeric(10, 2) NOT NULL,
	"akhar_rate" numeric(10, 2) NOT NULL,
	"akhar_commission" numeric(10, 2) NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_commission" numeric(15, 2) DEFAULT '0' NOT NULL,
	"final_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"device_type" varchar(10) DEFAULT 'WEB' NOT NULL,
	"added_by" varchar(50) DEFAULT 'system' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" varchar(50) DEFAULT 'system' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matka_transaction_details" ADD CONSTRAINT "matka_transaction_details_transaction_id_matka_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."matka_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transactions" ADD CONSTRAINT "matka_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matka_transactions" ADD CONSTRAINT "matka_transactions_shift_id_matka_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."matka_shifts"("id") ON DELETE cascade ON UPDATE no action;