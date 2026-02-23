-- Add whitelabel reference to users: which whitelabel this user belongs to
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whitelabel_id" bigint;

-- FK: user's whitelabel_id references whitelabels(id); SET NULL when whitelabel is deleted
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_whitelabel_id_fk'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_whitelabel_id_fk"
      FOREIGN KEY ("whitelabel_id") REFERENCES "whitelabels"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Index for filtering users by whitelabel
CREATE INDEX IF NOT EXISTS "users_whitelabel_id_idx" ON "users" ("whitelabel_id");
