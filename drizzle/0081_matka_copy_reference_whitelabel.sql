-- Add copy_reference_shift_id and whitelabel_id to matka_transactions
ALTER TABLE "matka_transactions"
  ADD COLUMN IF NOT EXISTS "copy_reference_shift_id" uuid REFERENCES "matka_shifts"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "whitelabel_id" uuid;
