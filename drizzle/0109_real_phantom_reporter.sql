ALTER TABLE "users" ADD COLUMN "current_refresh_jti" varchar(36);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "prev_refresh_jti" varchar(36);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "refresh_rotated_at" timestamp;