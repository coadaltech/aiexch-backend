-- ============================================================================
-- Migration: Schema type changes
-- - record_status: varchar(1) -> integer across ALL tables
-- - transactions & transaction_details: column type changes
-- - Drop bet-placement and settlement triggers (will be recreated later)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 0: Drop triggers FIRST (they reference old column types)
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_ledger_limit_on_bet ON transaction_details;
DROP FUNCTION IF EXISTS trg_recalc_ledger_on_bet();

DROP TRIGGER IF EXISTS trg_ledger_limit_on_settle ON transactions;
DROP FUNCTION IF EXISTS trg_recalc_ledger_on_settle();

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: Convert record_status from varchar(1) to integer in ALL tables
--   'A' -> 0 (Active), 'D' -> 1 (Deleted), 'S' -> 2 (Suspended)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'users', 'casino_games', 'otps', 'refresh_tokens',
    'promotions', 'promocodes', 'banners', 'popups',
    'whitelabels', 'vouchers', 'voucher_details',
    'kyc_documents', 'profiles', 'settings', 'ledger_groups',
    'notifications', 'user_read_notifications', 'qr_codes',
    'transactions', 'transaction_details', 'account_statements',
    'sports_games', 'home_sections', 'domains', 'home_section_games',
    'withdrawal_methods', 'sports', 'competitions', 'currencies',
    'currency_value_history', 'user_login_logs', 'transaction_logs',
    'ledger_limit', 'events', 'market_settings', 'runner_settings',
    'custom_market_odds', 'market_odds_history', 'bet_commission_snapshot'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Add temp column, convert values, drop old, rename
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN record_status_new INTEGER NOT NULL DEFAULT 0', tbl
    );
    EXECUTE format(
      'UPDATE %I SET record_status_new = CASE record_status
        WHEN ''A'' THEN 0
        WHEN ''D'' THEN 1
        WHEN ''S'' THEN 2
        ELSE 0
      END', tbl
    );
    EXECUTE format('ALTER TABLE %I DROP COLUMN record_status', tbl);
    EXECUTE format('ALTER TABLE %I RENAME COLUMN record_status_new TO record_status', tbl);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: transactions table — column type changes
-- ────────────────────────────────────────────────────────────────────────────

-- event_type_id: varchar(50) -> bigint
ALTER TABLE transactions ADD COLUMN event_type_id_new BIGINT;
UPDATE transactions SET event_type_id_new = event_type_id::BIGINT;
ALTER TABLE transactions DROP COLUMN event_type_id;
ALTER TABLE transactions RENAME COLUMN event_type_id_new TO event_type_id;
ALTER TABLE transactions ALTER COLUMN event_type_id SET NOT NULL;

-- competition_id: NEW column (bigint) after event_type_id
ALTER TABLE transactions ADD COLUMN competition_id BIGINT;

-- match_id: varchar(100) -> bigint
ALTER TABLE transactions ADD COLUMN match_id_new BIGINT;
UPDATE transactions SET match_id_new = match_id::BIGINT;
ALTER TABLE transactions DROP COLUMN match_id;
ALTER TABLE transactions RENAME COLUMN match_id_new TO match_id;
ALTER TABLE transactions ALTER COLUMN match_id SET NOT NULL;

-- market_id: varchar(100) -> numeric (no precision)
ALTER TABLE transactions ADD COLUMN market_id_new NUMERIC;
UPDATE transactions SET market_id_new = market_id::NUMERIC;
ALTER TABLE transactions DROP COLUMN market_id;
ALTER TABLE transactions RENAME COLUMN market_id_new TO market_id;
ALTER TABLE transactions ALTER COLUMN market_id SET NOT NULL;

-- selection_id: varchar(100) -> bigint
ALTER TABLE transactions ADD COLUMN selection_id_new BIGINT;
UPDATE transactions SET selection_id_new = selection_id::BIGINT;
ALTER TABLE transactions DROP COLUMN selection_id;
ALTER TABLE transactions RENAME COLUMN selection_id_new TO selection_id;
ALTER TABLE transactions ALTER COLUMN selection_id SET NOT NULL;

-- bet_type: varchar(10) -> integer (0=back, 1=lay)
ALTER TABLE transactions ADD COLUMN bet_type_new INTEGER;
UPDATE transactions SET bet_type_new = CASE
  WHEN LOWER(bet_type) = 'back' THEN 0
  WHEN LOWER(bet_type) = 'lay' THEN 1
  ELSE 0
END;
ALTER TABLE transactions DROP COLUMN bet_type;
ALTER TABLE transactions RENAME COLUMN bet_type_new TO bet_type;
ALTER TABLE transactions ALTER COLUMN bet_type SET NOT NULL;

-- added_by: varchar(50) -> uuid
ALTER TABLE transactions ADD COLUMN added_by_new UUID;
UPDATE transactions SET added_by_new = added_by::UUID;
ALTER TABLE transactions DROP COLUMN added_by;
ALTER TABLE transactions RENAME COLUMN added_by_new TO added_by;
ALTER TABLE transactions ALTER COLUMN added_by SET NOT NULL;

-- update_by: varchar(50) -> uuid
ALTER TABLE transactions ADD COLUMN update_by_new UUID;
UPDATE transactions SET update_by_new = update_by::UUID;
ALTER TABLE transactions DROP COLUMN update_by;
ALTER TABLE transactions RENAME COLUMN update_by_new TO update_by;
ALTER TABLE transactions ALTER COLUMN update_by SET NOT NULL;

-- Timestamp columns -> date (strip time component)
ALTER TABLE transactions
  ALTER COLUMN matched_at     TYPE DATE USING matched_at::DATE,
  ALTER COLUMN settled_at     TYPE DATE USING settled_at::DATE,
  ALTER COLUMN cancelled_at   TYPE DATE USING cancelled_at::DATE,
  ALTER COLUMN result_checked_at TYPE DATE USING result_checked_at::DATE,
  ALTER COLUMN added_date     TYPE DATE USING added_date::DATE,
  ALTER COLUMN update_date    TYPE DATE USING update_date::DATE;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3: transaction_details table — column type changes
-- ────────────────────────────────────────────────────────────────────────────

-- runner_id: varchar(100) -> bigint
ALTER TABLE transaction_details ADD COLUMN runner_id_new BIGINT;
UPDATE transaction_details SET runner_id_new = runner_id::BIGINT;
ALTER TABLE transaction_details DROP COLUMN runner_id;
ALTER TABLE transaction_details RENAME COLUMN runner_id_new TO runner_id;
ALTER TABLE transaction_details ALTER COLUMN runner_id SET NOT NULL;

-- bet_type: varchar(10) -> integer (0=back, 1=lay)
ALTER TABLE transaction_details ADD COLUMN bet_type_new INTEGER;
UPDATE transaction_details SET bet_type_new = CASE
  WHEN LOWER(bet_type) = 'back' THEN 0
  WHEN LOWER(bet_type) = 'lay' THEN 1
  ELSE 0
END;
ALTER TABLE transaction_details DROP COLUMN bet_type;
ALTER TABLE transaction_details RENAME COLUMN bet_type_new TO bet_type;

-- run: decimal(10,2) -> integer
ALTER TABLE transaction_details ADD COLUMN run_new INTEGER DEFAULT 0;
UPDATE transaction_details SET run_new = ROUND(run)::INTEGER;
ALTER TABLE transaction_details DROP COLUMN run;
ALTER TABLE transaction_details RENAME COLUMN run_new TO run;

-- added_by: varchar(50) -> uuid
ALTER TABLE transaction_details ADD COLUMN added_by_new UUID;
UPDATE transaction_details SET added_by_new = added_by::UUID;
ALTER TABLE transaction_details DROP COLUMN added_by;
ALTER TABLE transaction_details RENAME COLUMN added_by_new TO added_by;
ALTER TABLE transaction_details ALTER COLUMN added_by SET NOT NULL;

-- update_by: varchar(50) -> uuid
ALTER TABLE transaction_details ADD COLUMN update_by_new UUID;
UPDATE transaction_details SET update_by_new = update_by::UUID;
ALTER TABLE transaction_details DROP COLUMN update_by;
ALTER TABLE transaction_details RENAME COLUMN update_by_new TO update_by;
ALTER TABLE transaction_details ALTER COLUMN update_by SET NOT NULL;

-- Timestamp columns -> date
ALTER TABLE transaction_details
  ALTER COLUMN added_date  TYPE DATE USING added_date::DATE,
  ALTER COLUMN update_date TYPE DATE USING update_date::DATE;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 4: users.role — varchar(20) -> integer
--   'owner' -> 0, 'admin' -> 3, 'super' -> 4,
--   'master' -> 5, 'agent' -> 6, 'user' -> 7
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN role_new INTEGER NOT NULL DEFAULT 7;
UPDATE users SET role_new = CASE LOWER(role)
  WHEN 'owner' THEN 0
  WHEN 'admin' THEN 3
  WHEN 'super' THEN 4
  WHEN 'master' THEN 5
  WHEN 'agent' THEN 6
  WHEN 'user' THEN 7
  ELSE 7
END;
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users RENAME COLUMN role_new TO role;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 5: profiles.membership — varchar(20) -> integer
--   'bronze' -> 0, 'silver' -> 1, 'gold' -> 2, 'platinum' -> 3
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN membership_new INTEGER NOT NULL DEFAULT 0;
UPDATE profiles SET membership_new = CASE LOWER(membership)
  WHEN 'bronze' THEN 0
  WHEN 'silver' THEN 1
  WHEN 'gold' THEN 2
  WHEN 'platinum' THEN 3
  ELSE 0
END;
ALTER TABLE profiles DROP COLUMN membership;
ALTER TABLE profiles RENAME COLUMN membership_new TO membership;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 6: sports table — sport_id: varchar(50) -> bigint
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE sports ADD COLUMN sport_id_new BIGINT;
UPDATE sports SET sport_id_new = sport_id::BIGINT;
ALTER TABLE sports DROP COLUMN sport_id;
ALTER TABLE sports RENAME COLUMN sport_id_new TO sport_id;
ALTER TABLE sports ALTER COLUMN sport_id SET NOT NULL;
ALTER TABLE sports ADD CONSTRAINT sports_sport_id_unique UNIQUE (sport_id);

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 7: competitions table — competition_id, sport_id: varchar -> bigint
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE competitions ADD COLUMN competition_id_new BIGINT;
UPDATE competitions SET competition_id_new = competition_id::BIGINT;
ALTER TABLE competitions DROP COLUMN competition_id;
ALTER TABLE competitions RENAME COLUMN competition_id_new TO competition_id;
ALTER TABLE competitions ALTER COLUMN competition_id SET NOT NULL;
ALTER TABLE competitions ADD CONSTRAINT competitions_competition_id_unique UNIQUE (competition_id);

ALTER TABLE competitions ADD COLUMN sport_id_new BIGINT;
UPDATE competitions SET sport_id_new = sport_id::BIGINT;
ALTER TABLE competitions DROP COLUMN sport_id;
ALTER TABLE competitions RENAME COLUMN sport_id_new TO sport_id;
ALTER TABLE competitions ALTER COLUMN sport_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 8: events table — event_id, competition_id, sport_id: varchar -> bigint
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE events ADD COLUMN event_id_new BIGINT;
UPDATE events SET event_id_new = event_id::BIGINT;
ALTER TABLE events DROP COLUMN event_id;
ALTER TABLE events RENAME COLUMN event_id_new TO event_id;
ALTER TABLE events ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE events ADD CONSTRAINT events_event_id_unique UNIQUE (event_id);

ALTER TABLE events ADD COLUMN competition_id_new BIGINT;
UPDATE events SET competition_id_new = competition_id::BIGINT;
ALTER TABLE events DROP COLUMN competition_id;
ALTER TABLE events RENAME COLUMN competition_id_new TO competition_id;
ALTER TABLE events ALTER COLUMN competition_id SET NOT NULL;

ALTER TABLE events ADD COLUMN sport_id_new BIGINT;
UPDATE events SET sport_id_new = sport_id::BIGINT;
ALTER TABLE events DROP COLUMN sport_id;
ALTER TABLE events RENAME COLUMN sport_id_new TO sport_id;
ALTER TABLE events ALTER COLUMN sport_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 9: market_settings — market_id: varchar -> numeric, event_id: varchar -> bigint
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE market_settings ADD COLUMN market_id_new NUMERIC;
UPDATE market_settings SET market_id_new = market_id::NUMERIC;
ALTER TABLE market_settings DROP COLUMN market_id;
ALTER TABLE market_settings RENAME COLUMN market_id_new TO market_id;
ALTER TABLE market_settings ALTER COLUMN market_id SET NOT NULL;
ALTER TABLE market_settings ADD CONSTRAINT market_settings_market_id_unique UNIQUE (market_id);

ALTER TABLE market_settings ADD COLUMN event_id_new BIGINT;
UPDATE market_settings SET event_id_new = event_id::BIGINT;
ALTER TABLE market_settings DROP COLUMN event_id;
ALTER TABLE market_settings RENAME COLUMN event_id_new TO event_id;
ALTER TABLE market_settings ALTER COLUMN event_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 10: runner_settings — selection_id: varchar -> bigint, market_id: varchar -> numeric
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE runner_settings ADD COLUMN selection_id_new BIGINT;
UPDATE runner_settings SET selection_id_new = selection_id::BIGINT;
ALTER TABLE runner_settings DROP COLUMN selection_id;
ALTER TABLE runner_settings RENAME COLUMN selection_id_new TO selection_id;
ALTER TABLE runner_settings ALTER COLUMN selection_id SET NOT NULL;

ALTER TABLE runner_settings ADD COLUMN market_id_new NUMERIC;
UPDATE runner_settings SET market_id_new = market_id::NUMERIC;
ALTER TABLE runner_settings DROP COLUMN market_id;
ALTER TABLE runner_settings RENAME COLUMN market_id_new TO market_id;
ALTER TABLE runner_settings ALTER COLUMN market_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 11: custom_market_odds — market_id: varchar -> numeric, selection_id: varchar -> bigint
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE custom_market_odds ADD COLUMN market_id_new NUMERIC;
UPDATE custom_market_odds SET market_id_new = market_id::NUMERIC;
ALTER TABLE custom_market_odds DROP COLUMN market_id;
ALTER TABLE custom_market_odds RENAME COLUMN market_id_new TO market_id;
ALTER TABLE custom_market_odds ALTER COLUMN market_id SET NOT NULL;

ALTER TABLE custom_market_odds ADD COLUMN selection_id_new BIGINT;
UPDATE custom_market_odds SET selection_id_new = selection_id::BIGINT;
ALTER TABLE custom_market_odds DROP COLUMN selection_id;
ALTER TABLE custom_market_odds RENAME COLUMN selection_id_new TO selection_id;
ALTER TABLE custom_market_odds ALTER COLUMN selection_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 12: market_odds_history — market_id: varchar -> numeric, event_id: varchar -> bigint
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE market_odds_history ADD COLUMN market_id_new NUMERIC;
UPDATE market_odds_history SET market_id_new = market_id::NUMERIC;
ALTER TABLE market_odds_history DROP COLUMN market_id;
ALTER TABLE market_odds_history RENAME COLUMN market_id_new TO market_id;
ALTER TABLE market_odds_history ALTER COLUMN market_id SET NOT NULL;

ALTER TABLE market_odds_history ADD COLUMN event_id_new BIGINT;
UPDATE market_odds_history SET event_id_new = event_id::BIGINT;
ALTER TABLE market_odds_history DROP COLUMN event_id;
ALTER TABLE market_odds_history RENAME COLUMN event_id_new TO event_id;
ALTER TABLE market_odds_history ALTER COLUMN event_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 13: vouchers — event_type_id, competition_id, event_id: varchar -> bigint
--                      market_id: varchar -> numeric
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE vouchers ADD COLUMN event_type_id_new BIGINT;
UPDATE vouchers SET event_type_id_new = event_type_id::BIGINT WHERE event_type_id IS NOT NULL AND event_type_id ~ '^\d+$';
ALTER TABLE vouchers DROP COLUMN event_type_id;
ALTER TABLE vouchers RENAME COLUMN event_type_id_new TO event_type_id;

ALTER TABLE vouchers ADD COLUMN competition_id_new BIGINT;
UPDATE vouchers SET competition_id_new = competition_id::BIGINT WHERE competition_id IS NOT NULL AND competition_id ~ '^\d+$';
ALTER TABLE vouchers DROP COLUMN competition_id;
ALTER TABLE vouchers RENAME COLUMN competition_id_new TO competition_id;

ALTER TABLE vouchers ADD COLUMN event_id_new BIGINT;
UPDATE vouchers SET event_id_new = event_id::BIGINT WHERE event_id IS NOT NULL AND event_id ~ '^\d+$';
ALTER TABLE vouchers DROP COLUMN event_id;
ALTER TABLE vouchers RENAME COLUMN event_id_new TO event_id;

ALTER TABLE vouchers ADD COLUMN market_id_new NUMERIC;
UPDATE vouchers SET market_id_new = market_id::NUMERIC WHERE market_id IS NOT NULL AND market_id ~ '^\d+\.?\d*$';
ALTER TABLE vouchers DROP COLUMN market_id;
ALTER TABLE vouchers RENAME COLUMN market_id_new TO market_id;

-- ────────────────────────────────────────────────────────────────────────────
-- DONE. Triggers were dropped in Step 0 — recreate them when ready.
-- ────────────────────────────────────────────────────────────────────────────
