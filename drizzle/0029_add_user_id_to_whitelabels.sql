ALTER TABLE "whitelabels" ADD COLUMN "user_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE;
