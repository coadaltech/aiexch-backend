ALTER TABLE "user_favorite_matches" RENAME TO "user_multimarkets";--> statement-breakpoint
ALTER TABLE "user_multimarkets" DROP CONSTRAINT "uq_user_favorite_match";--> statement-breakpoint
ALTER TABLE "user_multimarkets" DROP CONSTRAINT "user_favorite_matches_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "sport_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "sport_name" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "competition_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "competition_name" varchar(200) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "event_name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "open_date" timestamp;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "market_id" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "market_name" varchar(200) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD COLUMN "market_type" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD CONSTRAINT "user_multimarkets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_multimarkets" ADD CONSTRAINT "uq_user_multimarket" UNIQUE("user_id","market_id");