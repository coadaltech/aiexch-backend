-- ============================================================
-- 0084 — Remove foreign keys, drop redundant unique constraints,
--         add performance indexes, and minor structural changes.
--
-- Safe to re-run: every statement uses IF EXISTS / IF NOT EXISTS.
-- ============================================================

-- ── 2. casino_games — remove unique on uuid ─────────────────
ALTER TABLE casino_games DROP CONSTRAINT IF EXISTS casino_games_uuid_unique;

-- ── 3. competition_whitelabel_overrides ──────────────────────
-- drop compound unique, add composite index
ALTER TABLE competition_whitelabel_overrides DROP CONSTRAINT IF EXISTS uq_competition_whitelabel;

CREATE INDEX IF NOT EXISTS idx_comp_wl_overrides_comp_id_wl_id
    ON competition_whitelabel_overrides (competition_id, whitelabel_id);

-- ── 4. competitions — remove unique on competition_id ────────
-- (sport_id index already created in 0083)
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_competition_id_unique;

-- ── 5. currencies — remove unique on code ───────────────────
ALTER TABLE currencies DROP CONSTRAINT IF EXISTS currencies_code_unique;

-- ── 6. currency_value_history — remove FK, ensure index ──────
-- The index may already exist from 0036; IF NOT EXISTS guards it.
ALTER TABLE currency_value_history
    DROP CONSTRAINT IF EXISTS currency_value_history_currency_id_currencies_id_fk;
ALTER TABLE currency_value_history
    DROP CONSTRAINT IF EXISTS currency_value_history_currency_id_fkey;  -- postgres auto-name fallback

CREATE INDEX IF NOT EXISTS idx_currency_value_history_currency_id
    ON currency_value_history (currency_id);

-- ── 7. custom_market_odds — composite index ──────────────────
CREATE INDEX IF NOT EXISTS idx_custom_market_odds_market_sel
    ON custom_market_odds (market_id, selection_id);

-- ── 8. event_whitelabel_overrides ───────────────────────────
-- drop compound unique, add composite index
ALTER TABLE event_whitelabel_overrides DROP CONSTRAINT IF EXISTS uq_event_whitelabel;

CREATE INDEX IF NOT EXISTS idx_event_wl_overrides_event_id_wl_id
    ON event_whitelabel_overrides (event_id, whitelabel_id);

-- ── 9. events — remove unique on event_id, add event_id index
-- (competition_id index already created in 0083)
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_id_unique;

CREATE INDEX IF NOT EXISTS idx_events_event_id
    ON events (event_id);

-- ── 10. home_section_games — remove FK, add section_id index ─
ALTER TABLE home_section_games
    DROP CONSTRAINT IF EXISTS home_section_games_section_id_home_sections_id_fk;

CREATE INDEX IF NOT EXISTS idx_home_section_games_section_id
    ON home_section_games (section_id);

-- ── 12. kyc_documents — remove FK, add user_id index ─────────
ALTER TABLE kyc_documents
    DROP CONSTRAINT IF EXISTS kyc_documents_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id
    ON kyc_documents (user_id);

-- ── 14. ledger_limit ─────────────────────────────────────────
-- Add id column, change primary key from user_id → id, remove FK, add user_id index.
--
-- The current PK is user_id (one row per user).  We:
--   1. add the new id column and populate it
--   2. swap the primary key
--   3. drop the FK
--   4. index user_id so lookups remain fast
DO $$
BEGIN
    -- Add id column only if it doesn't exist yet
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ledger_limit' AND column_name = 'id'
    ) THEN
        ALTER TABLE ledger_limit ADD COLUMN id uuid DEFAULT gen_random_uuid() NOT NULL;
    END IF;

    -- Swap primary key if user_id is still the PK
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'ledger_limit'
          AND tc.constraint_type = 'PRIMARY KEY'
          AND kcu.column_name = 'user_id'
    ) THEN
        ALTER TABLE ledger_limit DROP CONSTRAINT ledger_limit_pkey;
        ALTER TABLE ledger_limit ADD PRIMARY KEY (id);
    END IF;
END $$;

ALTER TABLE ledger_limit
    DROP CONSTRAINT IF EXISTS ledger_limit_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_ledger_limit_user_id
    ON ledger_limit (user_id);

-- ── 15. market_odds_history — indexes already in 0083 ────────

-- ── 16. market_results ───────────────────────────────────────
-- remove unique on market_id (declared_at is used as result date)
-- add composite index on market_type + declared_at
ALTER TABLE market_results DROP CONSTRAINT IF EXISTS market_results_market_id_unique;

CREATE INDEX IF NOT EXISTS idx_market_results_market_type_declared_at
    ON market_results (market_type, declared_at DESC);

-- ── 17. market_settings — remove unique on market_id, add market_id index ──
ALTER TABLE market_settings DROP CONSTRAINT IF EXISTS market_settings_market_id_unique;

CREATE INDEX IF NOT EXISTS idx_market_settings_market_id
    ON market_settings (market_id);

-- ── 19. matka_transaction_commissions ────────────────────────
-- remove both FKs, add index, drop redundant user_id column
ALTER TABLE matka_transaction_commissions
    DROP CONSTRAINT IF EXISTS matka_transaction_commissions_matka_transaction_id_matka_transactions_id_fk;
ALTER TABLE matka_transaction_commissions
    DROP CONSTRAINT IF EXISTS matka_transaction_commissions_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_matka_tc_matka_tx_id
    ON matka_transaction_commissions (matka_transaction_id);

ALTER TABLE matka_transaction_commissions DROP COLUMN IF EXISTS user_id;

-- ── 20. matka_transaction_details ────────────────────────────
-- remove FK on transaction_id, add index
ALTER TABLE matka_transaction_details
    DROP CONSTRAINT IF EXISTS matka_transaction_details_transaction_id_matka_transactions_id_fk;

CREATE INDEX IF NOT EXISTS idx_matka_td_transaction_id
    ON matka_transaction_details (transaction_id);

-- ── 21. matka_transaction_logs ───────────────────────────────
-- remove both FKs, add index, drop redundant user_id column
ALTER TABLE matka_transaction_logs
    DROP CONSTRAINT IF EXISTS matka_transaction_logs_matka_transaction_id_matka_transactions_id_fk;
ALTER TABLE matka_transaction_logs
    DROP CONSTRAINT IF EXISTS matka_transaction_logs_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_matka_tl_matka_tx_id
    ON matka_transaction_logs (matka_transaction_id);

ALTER TABLE matka_transaction_logs DROP COLUMN IF EXISTS user_id;

-- ── 22. matka_transactions ───────────────────────────────────
-- remove FKs on user_id, shift_id, copy_reference_shift_id
ALTER TABLE matka_transactions
    DROP CONSTRAINT IF EXISTS matka_transactions_user_id_users_id_fk;
ALTER TABLE matka_transactions
    DROP CONSTRAINT IF EXISTS matka_transactions_shift_id_matka_shifts_id_fk;
-- copy_reference_shift_id was added via inline REFERENCES in 0081
ALTER TABLE matka_transactions
    DROP CONSTRAINT IF EXISTS matka_transactions_copy_reference_shift_id_matka_shifts_id_fk;
ALTER TABLE matka_transactions
    DROP CONSTRAINT IF EXISTS matka_transactions_copy_reference_shift_id_fkey;  -- postgres auto-name fallback

CREATE INDEX IF NOT EXISTS idx_matka_tx_user_shift_date
    ON matka_transactions (user_id, shift_id, transaction_date DESC);

-- ── 26. profiles ─────────────────────────────────────────────
-- Add id column, change primary key from user_id → id, remove FK, add user_id index.
DO $$
BEGIN
    -- Add id column only if it doesn't exist yet
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'profiles' AND column_name = 'id'
    ) THEN
        ALTER TABLE profiles ADD COLUMN id uuid DEFAULT gen_random_uuid() NOT NULL;
    END IF;

    -- Swap primary key if user_id is still the PK
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'profiles'
          AND tc.constraint_type = 'PRIMARY KEY'
          AND kcu.column_name = 'user_id'
    ) THEN
        ALTER TABLE profiles DROP CONSTRAINT profiles_pkey;
        ALTER TABLE profiles ADD PRIMARY KEY (id);
    END IF;
END $$;

ALTER TABLE profiles
    DROP CONSTRAINT IF EXISTS profiles_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_profiles_user_id
    ON profiles (user_id);

-- ── 34. transaction_commissions ──────────────────────────────
-- remove both FKs, add index on transaction_id, drop user_id column
ALTER TABLE transaction_commissions
    DROP CONSTRAINT IF EXISTS transaction_commissions_transaction_id_transactions_id_fk;
ALTER TABLE transaction_commissions
    DROP CONSTRAINT IF EXISTS transaction_commissions_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_tc_transaction_id
    ON transaction_commissions (transaction_id);

ALTER TABLE transaction_commissions DROP COLUMN IF EXISTS user_id;

-- ── 35. transaction_commissions_declare — index on transaction_id ──
CREATE INDEX IF NOT EXISTS idx_tcd_transaction_id
    ON transaction_commissions_declare (transaction_id);

-- ── 36. transaction_details ──────────────────────────────────
-- remove FK on transaction_id (index already in 0083)
ALTER TABLE transaction_details
    DROP CONSTRAINT IF EXISTS transaction_details_transaction_id_transactions_id_fk;

-- ── 37. transaction_logs ─────────────────────────────────────
-- remove both FKs, add index on transaction_id, drop user_id column
ALTER TABLE transaction_logs
    DROP CONSTRAINT IF EXISTS transaction_logs_transaction_id_transactions_id_fk;
ALTER TABLE transaction_logs
    DROP CONSTRAINT IF EXISTS transaction_logs_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_tl_transaction_id
    ON transaction_logs (transaction_id);

ALTER TABLE transaction_logs DROP COLUMN IF EXISTS user_id;

-- ── 38. transaction_logs_declare — index on transaction_id ───
CREATE INDEX IF NOT EXISTS idx_tld_transaction_id
    ON transaction_logs_declare (transaction_id);

-- ── 39. transactions — remove FK, composite index ────────────
-- (user_id and match_id indexes already in 0083)
ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS transactions_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_transactions_user_id_market_id
    ON transactions (user_id, market_id);

-- ── 39b. transactions_declare — composite indexes ─────────────
CREATE INDEX IF NOT EXISTS idx_transactions_declare_user_id_market_id
    ON transactions_declare (user_id, market_id);

-- ── 40. user_login_logs — remove FK ──────────────────────────
-- (user_id index already in 0083)
ALTER TABLE user_login_logs
    DROP CONSTRAINT IF EXISTS user_login_logs_user_id_users_id_fk;

-- ── 41. user_read_notifications ─────────────────────────────
-- remove both FKs, add composite index
ALTER TABLE user_read_notifications
    DROP CONSTRAINT IF EXISTS user_read_notifications_user_id_users_id_fk;
ALTER TABLE user_read_notifications
    DROP CONSTRAINT IF EXISTS user_read_notifications_notification_id_notifications_id_fk;

CREATE INDEX IF NOT EXISTS idx_urn_user_id_notification_id
    ON user_read_notifications (user_id, notification_id);

-- ── 43. voucher_details — remove both FKs, composite index ───
ALTER TABLE voucher_details
    DROP CONSTRAINT IF EXISTS voucher_details_voucher_id_vouchers_id_fk;
ALTER TABLE voucher_details
    DROP CONSTRAINT IF EXISTS voucher_details_user_id_users_id_fk;

CREATE INDEX IF NOT EXISTS idx_vd_user_id_voucher_id_date
    ON voucher_details (user_id, voucher_id, voucher_date DESC);

-- ── 44. vouchers — remove FK on user_id ─────────────────────
ALTER TABLE vouchers
    DROP CONSTRAINT IF EXISTS vouchers_user_id_users_id_fk;

-- ── 45. whitelabels — remove FK, remove unique on domain, add user_id index ──
ALTER TABLE whitelabels
    DROP CONSTRAINT IF EXISTS whitelabels_user_id_users_id_fk;
ALTER TABLE whitelabels
    DROP CONSTRAINT IF EXISTS whitelabels_domain_unique;

CREATE INDEX IF NOT EXISTS idx_whitelabels_user_id
    ON whitelabels (user_id);
