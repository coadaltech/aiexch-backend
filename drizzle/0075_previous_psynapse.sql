CREATE TABLE "event_whitelabel_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" bigint NOT NULL,
	"whitelabel_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_event_whitelabel" UNIQUE("event_id","whitelabel_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "default_market_id" varchar(50);