-- Make users.email optional. Accounts can now be created without an email.
-- The UNIQUE constraint is kept (Postgres treats NULLs as distinct, so multiple
-- email-less accounts are allowed while real emails remain unique).
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
