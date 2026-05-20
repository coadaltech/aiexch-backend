ALTER TABLE "casino_games" DROP CONSTRAINT "casino_games_uuid_unique";--> statement-breakpoint
ALTER TABLE "casino_games" ALTER COLUMN "name" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "external_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "slug" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "lang" varchar(10) DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "currency" varchar(3) NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "special_note" varchar(50);--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "uuid";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "image";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "technology";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "label";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "has_lobby";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "is_mobile";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "has_freespins";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "has_tables";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "casino_games" DROP COLUMN "freespin_valid_until_full_day";--> statement-breakpoint
ALTER TABLE "casino_games" ADD CONSTRAINT "casino_games_external_id_unique" UNIQUE("external_id");