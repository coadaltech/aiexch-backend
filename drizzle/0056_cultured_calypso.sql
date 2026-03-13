ALTER TABLE "custom_market_odds" ADD COLUMN "back_prices" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "custom_market_odds" ADD COLUMN "lay_prices" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "whitelabel_id" uuid;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "whitelabel_id" uuid;--> statement-breakpoint
ALTER TABLE "custom_market_odds" DROP COLUMN "back_price";--> statement-breakpoint
ALTER TABLE "custom_market_odds" DROP COLUMN "back_size";--> statement-breakpoint
ALTER TABLE "custom_market_odds" DROP COLUMN "lay_price";--> statement-breakpoint
ALTER TABLE "custom_market_odds" DROP COLUMN "lay_size";