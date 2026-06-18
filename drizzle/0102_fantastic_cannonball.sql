ALTER TABLE "casino_transactions" ADD COLUMN "round_exposure" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "pin_label" varchar(120);