CREATE TABLE "currencies" (
	"id" bigint PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"country_name" varchar(100) NOT NULL,
	"value" numeric(18, 6) DEFAULT '1' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "currencies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "currency_value_history" (
	"id" bigint PRIMARY KEY NOT NULL,
	"currency_id" bigint NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "currency_value_history" ADD CONSTRAINT "currency_value_history_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "status";