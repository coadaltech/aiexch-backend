-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0059: Double-Entry Accounting — Schema Only
--
-- Run via: drizzle-kit push / generate
-- Triggers must be created manually — see triggers/ folder
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Remove amount NOT NULL from vouchers (amounts live in voucher_details only)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "vouchers"
  ALTER COLUMN "amount" DROP NOT NULL;

ALTER TABLE "vouchers"
  ALTER COLUMN "amount" SET DEFAULT 0;

-- Add reference_id for linking to market/bet
ALTER TABLE "vouchers"
  ADD COLUMN IF NOT EXISTS "reference_id" VARCHAR(255);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Add double-entry columns to voucher_details
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "voucher_details"
  ADD COLUMN IF NOT EXISTS "dr_cr" VARCHAR(10),              -- DEBIT | CREDIT
  ADD COLUMN IF NOT EXISTS "balance_before" DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "balance_after" DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "event_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "market_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "bet_id" UUID,
  ADD COLUMN IF NOT EXISTS "whitelabel_id" UUID,
  ADD COLUMN IF NOT EXISTS "role" VARCHAR(20);               -- owner|admin|super|master|agent|user|capital|pnl

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Create bet_commission_snapshot table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "bet_commission_snapshot" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transaction_id"  UUID NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
  "user_id"         UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "agent_id"        UUID,
  "agent_percent"   DECIMAL(5,2) DEFAULT 0,
  "master_id"       UUID,
  "master_percent"  DECIMAL(5,2) DEFAULT 0,
  "super_id"        UUID,
  "super_percent"   DECIMAL(5,2) DEFAULT 0,
  "admin_id"        UUID,
  "admin_percent"   DECIMAL(5,2) DEFAULT 0,
  "owner_id"        UUID,
  "owner_percent"   DECIMAL(5,2) DEFAULT 0,
  "created_at"      TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Indexes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_bet_commission_snapshot_txn
  ON bet_commission_snapshot(transaction_id);
CREATE INDEX IF NOT EXISTS idx_bet_commission_snapshot_user
  ON bet_commission_snapshot(user_id);
CREATE INDEX IF NOT EXISTS idx_voucher_details_voucher_id ON voucher_details(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_details_user_id ON voucher_details(user_id);
CREATE INDEX IF NOT EXISTS idx_voucher_details_bet_id ON voucher_details(bet_id);
CREATE INDEX IF NOT EXISTS idx_voucher_details_market_id ON voucher_details(market_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_reference_id ON vouchers(reference_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_user_id ON vouchers(user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
