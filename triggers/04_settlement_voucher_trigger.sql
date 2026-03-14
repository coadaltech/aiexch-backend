-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: Settlement voucher creation with commission distribution
--
-- Fires AFTER bet settlement (when transactions.status changes from 'matched').
-- This runs AFTER trg_ledger_limit_on_settle (alphabetical: "l" < "s").
--
-- The existing trg_recalc_ledger_on_settle handles the USER's ledger_limit
-- (balance + exposure recalc). This trigger ONLY:
--   1. Creates a settlement voucher (metadata, no amount)
--   2. Creates voucher_detail rows for:
--      - User (audit trail only — ledger already updated by settle trigger)
--      - Agent, Master, Super, Admin, Owner (commission shares)
--      - Capital account (remainder)
--   3. The voucher_detail trigger (02) updates ledger_limit for hierarchy
--
-- Commission flow (user loses 1000, agent=55%, master=65%, super=75%, admin=85%):
--   User:    DEBIT  1000  (audit only — settle trigger already applied)
--   Agent:   CREDIT 550   (55% of 1000)
--   Master:  CREDIT 100   (65% - 55% = 10% of 1000)
--   Super:   CREDIT 100   (75% - 65% = 10% of 1000)
--   Admin:   CREDIT 100   (85% - 75% = 10% of 1000)
--   Capital: CREDIT 150   (100% - 85% = 15% of 1000)
--
-- When user wins, it reverses (user CREDIT, all others DEBIT).
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_settlement_voucher()
RETURNS TRIGGER AS $$
DECLARE
  v_stake            DECIMAL(15,2);
  v_potential_return DECIMAL(15,2);
  v_pnl              DECIMAL(15,2);  -- positive = user profit, negative = user loss
  v_abs_pnl          DECIMAL(15,2);
  v_voucher_id       UUID;
  v_user_role        VARCHAR(20);
  v_user_group_id    INTEGER;
  v_whitelabel_id    UUID;
  v_user_balance     DECIMAL(15,2);
  v_bet_type         VARCHAR(10);
  v_snapshot         RECORD;
  v_prev_pct         DECIMAL(5,2);
  v_curr_pct         DECIMAL(5,2);
  v_share            DECIMAL(15,2);
  v_ancestor_balance DECIMAL(15,2);
  v_total_distributed DECIMAL(15,2) := 0;
  v_capital_share    DECIMAL(15,2);
  v_capital_user_id  UUID;
  v_capital_balance  DECIMAL(15,2);
BEGIN
  -- Only act when status moves away from 'matched'
  IF OLD.status <> 'matched' OR NEW.status = 'matched' THEN
    RETURN NEW;
  END IF;

  -- Only process won/lost (not cancelled/void)
  IF NEW.status NOT IN ('won', 'lost') THEN
    RETURN NEW;
  END IF;

  -- Get bet details
  SELECT td.stake::DECIMAL, td.potential_return::DECIMAL, t.bet_type
    INTO v_stake, v_potential_return, v_bet_type
    FROM transaction_details td
    JOIN transactions t ON t.id = td.transaction_id
   WHERE td.transaction_id = NEW.id
     AND td.is_user_selection = TRUE
   LIMIT 1;

  IF v_stake IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calculate P&L from USER perspective
  IF NEW.status = 'won' THEN
    IF v_bet_type = 'back' THEN
      v_pnl := v_potential_return - v_stake;  -- user wins profit
    ELSE -- lay
      v_pnl := v_stake;  -- lay won: user keeps stake
    END IF;
  ELSE -- lost
    IF v_bet_type = 'back' THEN
      v_pnl := -v_stake;  -- user loses stake
    ELSE -- lay
      v_pnl := -(v_potential_return - v_stake);  -- lay lost: user pays difference
    END IF;
  END IF;

  v_abs_pnl := ABS(v_pnl);

  -- Skip zero P&L
  IF v_abs_pnl = 0 THEN
    RETURN NEW;
  END IF;

  -- Get user info
  SELECT role, group_id, whitelabel_id
    INTO v_user_role, v_user_group_id, v_whitelabel_id
    FROM users WHERE id = NEW.user_id;

  -- Get user balance AFTER the settle trigger already ran.
  -- Reverse the P&L to get the true balance_before for the audit trail.
  SELECT COALESCE(user_balance, 0) INTO v_user_balance
    FROM ledger_limit WHERE user_id = NEW.user_id;

  IF v_pnl > 0 THEN
    v_user_balance := v_user_balance - v_pnl;     -- undo the credit
  ELSIF v_pnl < 0 THEN
    v_user_balance := v_user_balance + v_abs_pnl;  -- undo the debit
  END IF;

  -- Create settlement voucher (no amount — amounts are in voucher_details)
  INSERT INTO vouchers (
    user_id, user_group_id, type, status, reference_id,
    remarks, created_at, updated_at
  ) VALUES (
    NEW.user_id, v_user_group_id, 'settlement', 'approved',
    NEW.market_id,
    'Bet settlement: ' || NEW.status || ' on market ' || NEW.market_id,
    NOW(), NOW()
  )
  RETURNING id INTO v_voucher_id;

  -- ── User voucher_detail row (AUDIT ONLY — ledger already updated by settle trigger)
  -- We insert with balance_before/after pre-filled so the voucher_detail trigger
  -- recognizes it's already processed (balance_after IS NOT NULL → skip).
  INSERT INTO voucher_details (
    voucher_id, user_id, user_group_id, amount, dr_cr,
    balance_before, balance_after,
    account_type, role, event_id, market_id, bet_id, whitelabel_id,
    description, created_at
  ) VALUES (
    v_voucher_id, NEW.user_id, v_user_group_id, v_abs_pnl,
    CASE WHEN v_pnl > 0 THEN 'CREDIT' ELSE 'DEBIT' END,
    v_user_balance,
    CASE WHEN v_pnl > 0 THEN v_user_balance + v_abs_pnl
         ELSE v_user_balance - v_abs_pnl END,
    'ledger', v_user_role,
    NEW.event_type_id, NEW.market_id, NEW.id, v_whitelabel_id,
    'User ' || CASE WHEN v_pnl > 0 THEN 'won' ELSE 'lost' END || ' ' || v_abs_pnl::TEXT,
    NOW()
  );

  -- ── Commission distribution through hierarchy ──
  SELECT * INTO v_snapshot
    FROM bet_commission_snapshot
   WHERE transaction_id = NEW.id
   LIMIT 1;

  v_prev_pct := 0;
  v_total_distributed := 0;

  IF v_snapshot.id IS NOT NULL THEN

    -- ─── Agent ───
    IF v_snapshot.agent_id IS NOT NULL AND v_snapshot.agent_percent > 0 THEN
      v_curr_pct := v_snapshot.agent_percent;
      v_share := ROUND((v_curr_pct - v_prev_pct) / 100.0 * v_abs_pnl, 2);
      IF v_share > 0 THEN
        -- Insert voucher_detail — trigger 02 will update agent's ledger_limit
        INSERT INTO voucher_details (
          voucher_id, user_id, user_group_id, amount, dr_cr, commission_percent,
          account_type, role, event_id, market_id, bet_id, whitelabel_id,
          description, created_at
        ) VALUES (
          v_voucher_id, v_snapshot.agent_id, 6, v_share,
          CASE WHEN v_pnl < 0 THEN 'CREDIT' ELSE 'DEBIT' END,
          v_curr_pct, 'ledger', 'agent',
          NEW.event_type_id, NEW.market_id, NEW.id, v_whitelabel_id,
          'Agent commission ' || v_curr_pct || '% = ' || v_share::TEXT, NOW()
        );
        v_total_distributed := v_total_distributed + v_share;
        v_prev_pct := v_curr_pct;
      END IF;
    END IF;

    -- ─── Master ───
    IF v_snapshot.master_id IS NOT NULL AND v_snapshot.master_percent > v_prev_pct THEN
      v_curr_pct := v_snapshot.master_percent;
      v_share := ROUND((v_curr_pct - v_prev_pct) / 100.0 * v_abs_pnl, 2);
      IF v_share > 0 THEN
        INSERT INTO voucher_details (
          voucher_id, user_id, user_group_id, amount, dr_cr, commission_percent,
          account_type, role, event_id, market_id, bet_id, whitelabel_id,
          description, created_at
        ) VALUES (
          v_voucher_id, v_snapshot.master_id, 5, v_share,
          CASE WHEN v_pnl < 0 THEN 'CREDIT' ELSE 'DEBIT' END,
          v_curr_pct, 'ledger', 'master',
          NEW.event_type_id, NEW.market_id, NEW.id, v_whitelabel_id,
          'Master commission ' || v_curr_pct || '% = ' || v_share::TEXT, NOW()
        );
        v_total_distributed := v_total_distributed + v_share;
        v_prev_pct := v_curr_pct;
      END IF;
    END IF;

    -- ─── Super ───
    IF v_snapshot.super_id IS NOT NULL AND v_snapshot.super_percent > v_prev_pct THEN
      v_curr_pct := v_snapshot.super_percent;
      v_share := ROUND((v_curr_pct - v_prev_pct) / 100.0 * v_abs_pnl, 2);
      IF v_share > 0 THEN
        INSERT INTO voucher_details (
          voucher_id, user_id, user_group_id, amount, dr_cr, commission_percent,
          account_type, role, event_id, market_id, bet_id, whitelabel_id,
          description, created_at
        ) VALUES (
          v_voucher_id, v_snapshot.super_id, 4, v_share,
          CASE WHEN v_pnl < 0 THEN 'CREDIT' ELSE 'DEBIT' END,
          v_curr_pct, 'ledger', 'super',
          NEW.event_type_id, NEW.market_id, NEW.id, v_whitelabel_id,
          'Super commission ' || v_curr_pct || '% = ' || v_share::TEXT, NOW()
        );
        v_total_distributed := v_total_distributed + v_share;
        v_prev_pct := v_curr_pct;
      END IF;
    END IF;

    -- ─── Admin ───
    IF v_snapshot.admin_id IS NOT NULL AND v_snapshot.admin_percent > v_prev_pct THEN
      v_curr_pct := v_snapshot.admin_percent;
      v_share := ROUND((v_curr_pct - v_prev_pct) / 100.0 * v_abs_pnl, 2);
      IF v_share > 0 THEN
        INSERT INTO voucher_details (
          voucher_id, user_id, user_group_id, amount, dr_cr, commission_percent,
          account_type, role, event_id, market_id, bet_id, whitelabel_id,
          description, created_at
        ) VALUES (
          v_voucher_id, v_snapshot.admin_id, 3, v_share,
          CASE WHEN v_pnl < 0 THEN 'CREDIT' ELSE 'DEBIT' END,
          v_curr_pct, 'ledger', 'admin',
          NEW.event_type_id, NEW.market_id, NEW.id, v_whitelabel_id,
          'Admin commission ' || v_curr_pct || '% = ' || v_share::TEXT, NOW()
        );
        v_total_distributed := v_total_distributed + v_share;
        v_prev_pct := v_curr_pct;
      END IF;
    END IF;

    -- ─── Capital account (owner commission + remainder all go to capital) ───
    -- Owner's final commission from settlement goes into the capital account,
    -- NOT the owner's personal account. The remainder also goes to capital.
    v_capital_share := v_abs_pnl - v_total_distributed;
    IF v_capital_share > 0 THEN
      SELECT id INTO v_capital_user_id
        FROM users WHERE group_id = 1 LIMIT 1;

      IF v_capital_user_id IS NOT NULL THEN
        INSERT INTO voucher_details (
          voucher_id, user_id, user_group_id, amount, dr_cr, commission_percent,
          account_type, role, event_id, market_id, bet_id, whitelabel_id,
          description, created_at
        ) VALUES (
          v_voucher_id, v_capital_user_id, 1, v_capital_share,
          CASE WHEN v_pnl < 0 THEN 'CREDIT' ELSE 'DEBIT' END,
          100.00, 'capital', 'capital',
          NEW.event_type_id, NEW.market_id, NEW.id, v_whitelabel_id,
          'Capital account (owner commission + remainder) = ' || v_capital_share::TEXT, NOW()
        );
      END IF;
    END IF;

  ELSE
    -- No snapshot: send everything to capital account
    SELECT id INTO v_capital_user_id
      FROM users WHERE group_id = 1 LIMIT 1;

    IF v_capital_user_id IS NOT NULL THEN
      INSERT INTO voucher_details (
        voucher_id, user_id, user_group_id, amount, dr_cr, commission_percent,
        account_type, role, event_id, market_id, bet_id, whitelabel_id,
        description, created_at
      ) VALUES (
        v_voucher_id, v_capital_user_id, 1, v_abs_pnl,
        CASE WHEN v_pnl < 0 THEN 'CREDIT' ELSE 'DEBIT' END,
        100.00, 'capital', 'capital',
        NEW.event_type_id, NEW.market_id, NEW.id, v_whitelabel_id,
        'Capital account - full amount (no snapshot)', NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settlement_voucher ON transactions;

CREATE TRIGGER trg_settlement_voucher
AFTER UPDATE OF status ON transactions
FOR EACH ROW
EXECUTE FUNCTION trg_settlement_voucher();
