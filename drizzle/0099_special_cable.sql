CREATE TABLE "casino_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"whitelabel_id" uuid,
	"provider" varchar(20) NOT NULL,
	"provider_bet_id" varchar(100) NOT NULL,
	"provider_round_id" varchar(100),
	"provider_transaction_id" varchar(100),
	"game_id" varchar(100),
	"game_name" varchar(100),
	"selection_id" varchar(100),
	"selection_name" varchar(255),
	"bet_type" varchar(10),
	"stake" numeric(15, 2) NOT NULL,
	"odds" numeric(10, 4),
	"exposure" numeric(15, 2),
	"currency" varchar(3),
	"status" varchar(20) DEFAULT 'matched' NOT NULL,
	"settled_amount" numeric(15, 2),
	"ip_address" varchar(45),
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"raw_payload" jsonb,
	"added_by" uuid NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "casino_bets_provider_bet_uniq" UNIQUE("provider","provider_bet_id")
);
--> statement-breakpoint
CREATE TABLE "casino_transaction_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"casino_bet_id" uuid NOT NULL,
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
CREATE TABLE "casino_transaction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"casino_bet_id" uuid NOT NULL,
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
DROP TABLE "casino_transactions" CASCADE;--> statement-breakpoint
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;