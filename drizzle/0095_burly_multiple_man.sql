ALTER TABLE "users" ADD COLUMN "parent_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_staff" boolean DEFAULT false NOT NULL;