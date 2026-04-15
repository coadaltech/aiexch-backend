-- ============================================================
-- Performance indexes for most-used tables
-- Run: psql -d <your_db> -f 0083_add_performance_indexes.sql
-- Each CREATE INDEX uses IF NOT EXISTS so it is safe to re-run.
-- ============================================================

-- ── competitions ────────────────────────────────────────────
-- getSeriesList filters by (sport_id, is_active)
CREATE INDEX IF NOT EXISTS idx_competitions_sport_id
    ON competitions (sport_id);

CREATE INDEX IF NOT EXISTS idx_competitions_sport_id_is_active
    ON competitions (sport_id, is_active)
    WHERE is_active = true;

-- ── events ──────────────────────────────────────────────────
-- getEventsFromDb filters by (competition_id, is_active) and sorts/filters by open_date
CREATE INDEX IF NOT EXISTS idx_events_competition_id
    ON events (competition_id);

CREATE INDEX IF NOT EXISTS idx_events_competition_id_is_active
    ON events (competition_id, is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_events_open_date
    ON events (open_date);

CREATE INDEX IF NOT EXISTS idx_events_sport_id
    ON events (sport_id);

-- ── event_whitelabel_overrides ───────────────────────────────
-- Joined in getEventsFromDb by (event_id, whitelabel_id)
-- (already covered by the unique constraint, but explicit index for visibility)
CREATE INDEX IF NOT EXISTS idx_event_wl_overrides_event_id
    ON event_whitelabel_overrides (event_id);

-- ── competition_whitelabel_overrides ────────────────────────
CREATE INDEX IF NOT EXISTS idx_competition_wl_overrides_competition_id
    ON competition_whitelabel_overrides (competition_id);

-- ── transactions (bets) ─────────────────────────────────────
-- bet-counts query: WHERE match_id IN (...) AND user_id = ?  GROUP BY match_id
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
    ON transactions (user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_match_id
    ON transactions (match_id);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id_match_id
    ON transactions (user_id, match_id);

-- Settlement / result queries filter by status
CREATE INDEX IF NOT EXISTS idx_transactions_status
    ON transactions (status)
    WHERE status NOT IN ('won', 'lost', 'cancelled', 'void');

CREATE INDEX IF NOT EXISTS idx_transactions_event_type_id
    ON transactions (event_type_id);

-- ── transaction_details ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transaction_details_transaction_id
    ON transaction_details (transaction_id);

-- ── market_settings ─────────────────────────────────────────
-- Queried by event_id to load markets for a match
CREATE INDEX IF NOT EXISTS idx_market_settings_event_id
    ON market_settings (event_id);

CREATE INDEX IF NOT EXISTS idx_market_settings_event_id_is_active
    ON market_settings (event_id, is_active)
    WHERE is_active = true;

-- ── vouchers ────────────────────────────────────────────────
-- Queried by user_id, status, added_date for ledger/reports
CREATE INDEX IF NOT EXISTS idx_vouchers_user_id
    ON vouchers (user_id);

CREATE INDEX IF NOT EXISTS idx_vouchers_user_id_status
    ON vouchers (user_id, status);

CREATE INDEX IF NOT EXISTS idx_vouchers_added_date
    ON vouchers (added_date DESC);

-- ── voucher_details ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_voucher_details_user_id
    ON voucher_details (user_id);

CREATE INDEX IF NOT EXISTS idx_voucher_details_voucher_id
    ON voucher_details (voucher_id);

CREATE INDEX IF NOT EXISTS idx_voucher_details_added_date
    ON voucher_details (added_date DESC);

-- ── users ───────────────────────────────────────────────────
-- Admin hierarchy queries filter by whitelabel_id + role + record_status
CREATE INDEX IF NOT EXISTS idx_users_whitelabel_id
    ON users (whitelabel_id);

CREATE INDEX IF NOT EXISTS idx_users_whitelabel_id_role
    ON users (whitelabel_id, role);

CREATE INDEX IF NOT EXISTS idx_users_created_by
    ON users (created_by);

-- ── user_login_logs ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_login_logs_user_id
    ON user_login_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_user_login_logs_login_at
    ON user_login_logs (login_at DESC);

-- ── matka_transactions ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_matka_transactions_user_id
    ON matka_transactions (user_id);

CREATE INDEX IF NOT EXISTS idx_matka_transactions_shift_id
    ON matka_transactions (shift_id);

CREATE INDEX IF NOT EXISTS idx_matka_transactions_transaction_date
    ON matka_transactions (transaction_date DESC);

-- ── matka_shifts ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_matka_shifts_shift_date
    ON matka_shifts (shift_date DESC);

-- ── market_odds_history ─────────────────────────────────────
-- Time-series table — queried by (market_id, captured_at)
CREATE INDEX IF NOT EXISTS idx_market_odds_history_market_id
    ON market_odds_history (market_id);

CREATE INDEX IF NOT EXISTS idx_market_odds_history_event_id_captured_at
    ON market_odds_history (event_id, captured_at DESC);

-- ── transactions_declare ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transactions_declare_user_id
    ON transactions_declare (user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_declare_match_id
    ON transactions_declare (match_id);
