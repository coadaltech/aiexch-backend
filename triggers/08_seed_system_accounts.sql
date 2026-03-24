-- ---------------------------------------------------------------------------
-- Seed: System accounts for double-entry accounting
--
-- Eight system accounts with fixed UUIDs:
--   - Capital        (group_id=1): Owner's final commission from bet settlement
--   - P&L            (group_id=2): Counterparty in bet settlement
--   - Limit          (group_id=0): Debit source when owner creates vouchers
--   - Match P&L      (group_id=0): P&L account for MatchOdds
--   - Tie P&L        (group_id=0): P&L account for TieOdds
--   - Comp Match P&L (group_id=0): P&L account for Complete Match
--   - BookMaker P&L  (group_id=0): P&L account for Bookmaker
--   - Fancy P&L      (group_id=0): P&L account for Fancy
--
-- Schema uses integer enums:
--   role: 0=Owner  |  record_status: 0=Active  |  membership: 0=Bronze
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- Capital Account (group_id=1)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '__CAPITAL_ACCOUNT__',
  'capital@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 1, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Profit & Loss Account (group_id=2)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '__PROFIT_LOSS_ACCOUNT__',
  'pnl@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 2, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Limit Account (group_id=0)
-- When OWNER creates vouchers, amount debits from this account.
-- Other roles (admin/super/master/agent) debit from their own account.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '__LIMIT_ACCOUNT__',
  'limit@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 0, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Match P&L Account (group_id=0) — for MatchOdds
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  '__MATCH_PNL_ACCOUNT__',
  'match-pnl@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 0, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tie P&L Account (group_id=0) — for TieOdds
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000005',
  '__TIE_PNL_ACCOUNT__',
  'tie-pnl@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 0, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000005',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000005',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Comp Match P&L Account (group_id=0) — for Complete Match
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000006',
  '__COMP_MATCH_PNL_ACCOUNT__',
  'comp-match-pnl@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 0, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000006',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000006',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- BookMaker P&L Account (group_id=0) — for Bookmaker
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000007',
  '__BOOKMAKER_PNL_ACCOUNT__',
  'bookmaker-pnl@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 0, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000007',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000007',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fancy P&L Account (group_id=0) — for Fancy
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, username, email, password, role, account_status, parent_account_status, group_id, email_verified, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000008',
  '__FANCY_PNL_ACCOUNT__',
  'fancy-pnl@system.internal',
  '__SYSTEM_ACCOUNT_NO_LOGIN__',
  0, false, false, 0, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO profiles (user_id, membership, bet_status, parent_bet_status, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000008',
  0, false, false,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_limit (user_id, user_balance, user_limit, limit_consumed, limit_consumed_after_declare, final_limit, added_by, added_date, update_by, update_date, record_status)
VALUES (
  '00000000-0000-0000-0000-000000000008',
  0, 0, 0, 0, 0,
  'system', NOW(), 'system', NOW(), 0
)
ON CONFLICT (user_id) DO NOTHING;
