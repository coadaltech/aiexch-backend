-- ---------------------------------------------------------------------------
-- Run all triggers + seed data in order.
--
-- Execute this file directly in PostgreSQL:
--   psql -U <user> -d <database> -f triggers/run_all.sql
--
-- Or copy-paste each section into your DB client (pgAdmin, DBeaver, etc.)
--
-- Prerequisites: Tables must already exist (run drizzle migrations first).
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: SEED DATA  (run first — triggers depend on these rows)
-- ═══════════════════════════════════════════════════════════════════════════

\echo '=== Step 1: Seed ledger groups ==='
\i 07_seed_ledger_groups.sql

\echo '=== Step 2: Seed system accounts (Capital, P&L, Limit) ==='
\i 08_seed_system_accounts.sql

\echo '=== Step 3: Seed withdrawal methods ==='
\i 09_seed_withdrawal_methods.sql

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: TRIGGERS  (order matters — later triggers depend on earlier ones)
-- ═══════════════════════════════════════════════════════════════════════════

\echo '=== Step 4: Drop old voucher trigger ==='
\i 01_drop_old_voucher_trigger.sql

\echo '=== Step 5: Create voucher_detail ledger trigger ==='
\i 02_voucher_detail_ledger_trigger.sql

\echo '=== Step 6: Create voucher approve trigger ==='
\i 03_voucher_approve_trigger.sql

\echo '=== Step 7: Create settlement voucher trigger ==='
\i 04_settlement_voucher_trigger.sql

\echo '=== Step 8: Create bet exposure trigger ==='
\i 05_bet_exposure_trigger.sql

\echo '=== Step 9: Create settle trigger ==='
\i 06_settle_trigger.sql

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== All seed data + triggers installed successfully ==='
\echo ''
\echo 'Triggers installed:'
\echo '  - trg_voucher_detail_ledger    (BEFORE INSERT on voucher_details)'
\echo '  - trg_voucher_approve          (AFTER UPDATE on vouchers)'
\echo '  - trg_settlement_voucher       (AFTER UPDATE on transactions)'
\echo '  - trg_ledger_limit_on_bet      (AFTER INSERT on transaction_details)'
\echo '  - trg_ledger_limit_on_settle   (AFTER UPDATE on transactions)'
\echo ''
\echo 'Seed data:'
\echo '  - 8 ledger groups (owner/capital/pnl/admin/super/master/agent/user)'
\echo '  - 3 system accounts (Capital/P&L/Limit)'
\echo '  - 5 withdrawal methods (Bank/BTC/ETH/USDT/UPI)'
