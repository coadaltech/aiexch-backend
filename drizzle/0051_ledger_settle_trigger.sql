-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: update ledger when a bet is settled (status leaves 'matched').
--
-- Fires AFTER UPDATE OF status ON transactions FOR EACH ROW.
--
-- On settlement the trigger:
--   1. Snapshots the current limitConsumed → limitConsumedAfterDeclare
--   2. Recalculates exposure across remaining active bets (excludes this bet,
--      which is no longer 'matched')
--   3. Updates limitConsumed and finalLimit
--   4. Adjusts userBalance:
--        won  → add net profit  (potentialReturn - stake)
--        lost → deduct stake    (cash loss realised)
--        cancelled/void → no balance change
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_recalc_ledger_on_settle()
RETURNS TRIGGER AS $$
DECLARE
  v_total_exposure   NUMERIC(15,2);
  v_prev_consumed    NUMERIC(15,2);
  v_user_limit       NUMERIC(15,2);
  v_potential_return NUMERIC(15,2);
  v_stake            NUMERIC(15,2);
BEGIN
  -- Only act when status moves away from 'matched'
  IF OLD.status <> 'matched' OR NEW.status = 'matched' THEN
    RETURN NEW;
  END IF;

  -- Load current ledger state
  SELECT limit_consumed, user_limit
    INTO v_prev_consumed, v_user_limit
    FROM ledger_limit
   WHERE user_id = NEW.user_id;

  -- No ledger record → nothing to do
  IF v_user_limit IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch stake and potential return for this bet's selected runner
  SELECT td.stake::NUMERIC, td.potential_return::NUMERIC
    INTO v_stake, v_potential_return
    FROM transaction_details td
   WHERE td.transaction_id = NEW.id
     AND td.is_user_selection = TRUE
   LIMIT 1;

  -- Recalculate exposure using only still-active (matched) bets
  WITH active_bets AS (
    SELECT
      t.market_id,
      t.market_type,
      td.bet_type,
      td.stake::NUMERIC            AS stake,
      td.runner_id                 AS selected_runner_id,
      td.potential_return::NUMERIC AS potential_return
    FROM transactions t
    JOIN transaction_details td
      ON td.transaction_id = t.id
     AND td.is_user_selection = TRUE
    WHERE t.user_id = NEW.user_id
      AND t.status  = 'matched'
  ),
  market_outcomes AS (
    SELECT DISTINCT t.market_id, td.runner_id AS outcome_id
      FROM transactions t
      JOIN transaction_details td ON td.transaction_id = t.id
     WHERE t.user_id     = NEW.user_id
       AND t.status       = 'matched'
       AND t.market_type <> 'sessions'
    UNION
    SELECT DISTINCT market_id, selected_runner_id AS outcome_id
      FROM active_bets WHERE market_type = 'sessions'
    UNION
    SELECT DISTINCT market_id, '__NO__' AS outcome_id
      FROM active_bets WHERE market_type = 'sessions'
  ),
  market_pnl AS (
    SELECT
      mo.market_id,
      mo.outcome_id,
      SUM(
        CASE ab.bet_type
          WHEN 'back' THEN
            CASE WHEN ab.selected_runner_id = mo.outcome_id
                 THEN ab.potential_return - ab.stake
                 ELSE -ab.stake
            END
          ELSE
            CASE WHEN ab.selected_runner_id = mo.outcome_id
                 THEN ab.stake - ab.potential_return
                 ELSE ab.stake
            END
        END
      ) AS pnl
    FROM market_outcomes mo
    JOIN active_bets ab ON ab.market_id = mo.market_id
    GROUP BY mo.market_id, mo.outcome_id
  ),
  market_worst AS (
    SELECT market_id, MIN(pnl) AS worst_pnl FROM market_pnl GROUP BY market_id
  )
  SELECT COALESCE(SUM(ABS(worst_pnl)), 0)
    INTO v_total_exposure
    FROM market_worst
   WHERE worst_pnl < 0;

  -- Apply all updates in one pass
  UPDATE ledger_limit
     SET limit_consumed_after_declare = v_prev_consumed,
         limit_consumed               = v_total_exposure,
         final_limit                  = user_limit - v_total_exposure,
         user_balance = CASE
           WHEN NEW.status = 'won'  THEN user_balance + (v_potential_return - v_stake)
           WHEN NEW.status = 'lost' THEN user_balance - v_stake
           ELSE user_balance  -- cancelled / void: no cash movement
         END,
         updated_at = NOW()
   WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_limit_on_settle ON transactions;

CREATE TRIGGER trg_ledger_limit_on_settle
AFTER UPDATE OF status ON transactions
FOR EACH ROW
EXECUTE FUNCTION trg_recalc_ledger_on_settle();
