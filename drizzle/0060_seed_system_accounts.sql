-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0060: Seed system accounts
--
-- Three system accounts for double-entry accounting:
--   - Capital (group_id=1): Owner's final commission from settlement goes here
--   - Profit & Loss (group_id=2): Used in bet settlement
--   - Limit (group_id=0): Owner debits from here when creating vouchers
--
-- RUN VIA: drizzle-kit push (or manually)
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- Capital Account (group_id=1)
-- Owner's final commission from bet settlement goes here.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '__CAPITAL_ACCOUNT__',
  'capital@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  'owner',
  false, false, 1, false, NOW(), NOW()
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'bronze', false, false, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 0, 0, 0, 0, 0, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Profit & Loss Account (group_id=2)
-- Used in bet settlement as counterparty.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '__PROFIT_LOSS_ACCOUNT__',
  'pnl@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  'owner',
  false, false, 2, false, NOW(), NOW()
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', 'bronze', false, false, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', 0, 0, 0, 0, 0, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Limit Account (group_id=0, same as owner)
-- When OWNER creates vouchers, amount debits from this account.
-- Other roles (admin/super/master/agent) debit from their own account.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '__LIMIT_ACCOUNT__',
  'limit@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  'owner',
  false, false, 0, false, NOW(), NOW()
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000003', 'bronze', false, false, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000003', 0, 0, 0, 0, 0, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;
