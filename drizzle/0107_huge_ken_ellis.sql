CREATE TABLE "casino_pinned_categories" (
	"category_key" varchar(64) PRIMARY KEY NOT NULL,
	"is_pinned" boolean DEFAULT true NOT NULL,
	"added_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"added_date" timestamp DEFAULT now() NOT NULL,
	"update_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"record_status" integer DEFAULT 0 NOT NULL
);
