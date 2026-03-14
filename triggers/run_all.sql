-- ─────────────────────────────────────────────────────────────────────────────
-- Run all triggers in order. Execute this file directly in PostgreSQL:
--
--   psql -U <user> -d <database> -f triggers/run_all.sql
--
-- Or copy-paste each section into your DB client (pgAdmin, DBeaver, etc.)
-- ─────────────────────────────────────────────────────────────────────────────

\echo '=== Step 1: Drop old voucher trigger ==='
\i 01_drop_old_voucher_trigger.sql

\echo '=== Step 2: Create voucher_detail ledger trigger ==='
\i 02_voucher_detail_ledger_trigger.sql

\echo '=== Step 3: Create voucher approve trigger ==='
\i 03_voucher_approve_trigger.sql

\echo '=== Step 4: Create settlement voucher trigger ==='
\i 04_settlement_voucher_trigger.sql

\echo '=== All triggers installed successfully ==='
