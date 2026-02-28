CREATE TABLE "ledger_groups" (
	"ledger_group_id" serial PRIMARY KEY NOT NULL,
	"ledger_group_name" varchar(100) NOT NULL,
	"created_by" varchar(50) DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"updated_by" varchar(50) DEFAULT 'system' NOT NULL
);
