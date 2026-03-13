CREATE TABLE "custom_market_odds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"selection_id" varchar(100) NOT NULL,
	"back_price" numeric(10, 4),
	"back_size" numeric(15, 2) DEFAULT '0',
	"lay_price" numeric(10, 4),
	"lay_size" numeric(15, 2) DEFAULT '0',
	"line" numeric(10, 2),
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(100) NOT NULL,
	"competition_id" varchar(50) NOT NULL,
	"sport_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"open_date" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"bet_delay" integer DEFAULT 0 NOT NULL,
	"max_market_profit" numeric(15, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "market_odds_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"event_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"captured_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"event_id" varchar(100) NOT NULL,
	"market_name" varchar(255) NOT NULL,
	"market_type" varchar(50) NOT NULL,
	"betting_type" varchar(20) NOT NULL,
	"provider" varchar(50) DEFAULT 'API',
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"bet_lock" boolean DEFAULT false NOT NULL,
	"bet_delay" integer,
	"min_bet" numeric(15, 2),
	"max_bet" numeric(15, 2),
	"max_profit" numeric(15, 2),
	"sort_priority" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "market_settings_market_id_unique" UNIQUE("market_id")
);
--> statement-breakpoint
CREATE TABLE "runner_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"selection_id" varchar(100) NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"sort_priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
