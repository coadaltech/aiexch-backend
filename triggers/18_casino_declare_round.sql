-- ─────────────────────────────────────────────────────────────────────────────
-- Procedure: casino_declare_round
--
-- Called by the Ace /accounts/settlement handler (and QT CREDIT later) once
-- per (provider, round, player) when a result arrives. Mirrors sports'
-- `declare_process` 1:1 in structure: a single voucher row + paired
-- voucher_details for each hierarchy level (user → agent → master → super →
-- admin → owner), each direction (dr/cr).
--
-- Idempotency: skips if (provider, provider_transaction_id) already exists in
-- casino_settlements. Safe to retry on Ace retries.
--
-- Inputs:
--   var_user_id                  uuid     — the player (our user id)
--   var_provider                 varchar  — 'ace' | 'qtech'
--   var_provider_round_id        varchar  — provider's round id
--   var_provider_transaction_id  varchar  — Ace settlement.transaction_id (idempotency key)
--   var_total_exposure_released  numeric  — Ace settlement.exposure (null for QT)
--   var_bets                     jsonb    — [{provider_bet_id, outcome, pl}, ...]
--   var_raw_payload              jsonb    — original settlement item, for audit
--
-- Per-bet effect on casino_transactions:
--   WON       → status='won',       payout = exposure + pl, settled_amount = pl
--   LOST      → status='lost',      payout = 0,             settled_amount = pl  (negative)
--   VOIDED    → status='void',      payout = exposure,      settled_amount = 0
--   CANCELLED → status='cancelled', payout = exposure,      settled_amount = 0
--
-- ledger_limit.user_balance is updated AUTOMATICALLY by the
-- trg_voucher_detail_ledger_after_insert_update trigger on voucher_details
-- (see triggers/06_voucher_functions.sql). The user-row voucher detail we
-- insert below carries amount=ABS(net_pl) and dr_cr=1 (win) / 0 (loss);
-- the trigger flips user_balance accordingly. We must NOT update
-- user_balance ourselves or the money gets applied twice (one of the
-- earlier bugs we hit). This matches how sports' declare_process works.
--
-- After the updates, set_limit_used_of_user is re-called so limit_consumed
-- drops to reflect that these bets are no longer 'matched'.
-- ─────────────────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS public.casino_declare_round(uuid, varchar, varchar, varchar, numeric, jsonb, jsonb);

CREATE OR REPLACE PROCEDURE public.casino_declare_round(
    IN var_user_id uuid,
    IN var_provider varchar,
    IN var_provider_round_id varchar,
    IN var_provider_transaction_id varchar,
    IN var_total_exposure_released numeric,
    IN var_bets jsonb,
    IN var_raw_payload jsonb
)
LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
    varVoucherId UUID;
    varSystemUserId UUID := '00000000-0000-0000-0000-000000000000';
    varCompanyId UUID := '00000000-0000-0000-0000-000000000001';
    varVoucherType INT := 6;          -- VoucherType.Settlement
    varVoucherDetailType INT := 6;
    varWhitelabelId UUID;
    varTotalPl NUMERIC(15,2);
    varGameName VARCHAR(100);
    varVoucherReference VARCHAR(255);
BEGIN
    -- ── Idempotency: skip if this settlement was already processed.
    IF EXISTS (
        SELECT 1 FROM casino_settlements
         WHERE provider = var_provider
           AND provider_transaction_id = var_provider_transaction_id
    ) THEN
        RETURN;
    END IF;

    -- ── Snapshot whitelabel (for vouchers + voucher_details).
    SELECT whitelabel_id INTO varWhitelabelId
      FROM users
     WHERE id = var_user_id;

    -- ── 1. Update casino_transactions per bet outcome. Payout is computed from
    -- exposure (the worst-case liability we held on placement), not stake.
    UPDATE casino_transactions cb
       SET status = (CASE upper(b.outcome)
                        WHEN 'WON' THEN 'won'
                        WHEN 'LOST' THEN 'lost'
                        WHEN 'VOIDED' THEN 'void'
                        WHEN 'CANCELLED' THEN 'cancelled'
                        WHEN 'DELETED' THEN 'void'
                        ELSE 'void'
                     END),
           outcome = upper(b.outcome),
           settled_amount = b.pl,
           payout = (CASE upper(b.outcome)
                        WHEN 'WON' THEN COALESCE(cb.exposure, cb.stake) + b.pl
                        WHEN 'LOST' THEN 0
                        ELSE COALESCE(cb.exposure, cb.stake)
                     END),
           settled_at = CURRENT_TIMESTAMP,
           settled_by = varSystemUserId,
           update_by = varSystemUserId,
           update_date = CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(var_bets)
              AS b(provider_bet_id varchar, outcome varchar, pl numeric)
     WHERE cb.provider = var_provider
       AND cb.provider_bet_id = b.provider_bet_id
       AND cb.user_id = var_user_id
       AND cb.status = 'matched';

    -- ── 2. Compute total P/L + grab one of the game names for the voucher label.
    SELECT
        COALESCE(SUM(b.pl), 0),
        MAX(cb.game_name)
      INTO varTotalPl, varGameName
      FROM casino_transactions cb
      JOIN jsonb_to_recordset(var_bets)
            AS b(provider_bet_id varchar, outcome varchar, pl numeric)
        ON cb.provider_bet_id = b.provider_bet_id
     WHERE cb.provider = var_provider
       AND cb.user_id = var_user_id;

    varVoucherReference := COALESCE(varGameName, 'Casino') || ' R' || var_provider_round_id;

    -- ── 3. (Removed.) user_balance is no longer updated manually here —
    -- the voucher_details insert below triggers
    -- trg_voucher_detail_ledger_after_insert_update which updates
    -- user_balance + final_limit automatically. Doing both caused a
    -- double-credit (pl applied twice).

    -- ── 4. Audit row in casino_settlements (also dedup key going forward).
    INSERT INTO casino_settlements (
        id, provider, provider_transaction_id, provider_round_id, user_id,
        total_pl, total_exposure_released, raw_payload, status,
        added_date, update_date, record_status
    ) VALUES (
        gen_random_uuid(), var_provider, var_provider_transaction_id, var_provider_round_id, var_user_id,
        varTotalPl, var_total_exposure_released, var_raw_payload, 'applied',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
    );

    -- ── 5. Voucher header (same shape as sports declare_process).
    varVoucherId := gen_random_uuid();
    INSERT INTO public.vouchers (
        id, user_id, type, status, method, reference,
        remarks, remarks1, remarks2, remarks3,
        event_type_id, competition_id, event_id, market_id,
        approved_by, approved_date, voucher_date,
        added_by, added_date, update_by, update_date, record_status
    ) VALUES (
        varVoucherId, varSystemUserId, varVoucherType,
        1, 'CASINO_DECLARE', varVoucherReference,
        'Casino', var_provider, var_provider_round_id, NULL,
        NULL, NULL, NULL, NULL,
        varSystemUserId, CURRENT_TIMESTAMP, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
    );

    -- ── 6. Build per-user aggregated P/L + commission shares.
    --    bet_net_pl = Ace's per-bet `pl` (the realized P/L for the bet).
    --    For BACK won  it's +winnings; for LAY won it's +stake;
    --    for BACK lost it's -stake;    for LAY lost it's -liability.
    --    This is the only definition that gives correct totals for both
    --    bet types — taking (payout - stake) over-counts LAY wins/losses
    --    by (exposure - stake).
    CREATE TEMP TABLE casino_base_data ON COMMIT DROP AS
    WITH settled_bets AS (
        SELECT cb.id, cb.user_id, cb.whitelabel_id,
               b.pl AS bet_net_pl,
               ctc.agent_id, ctc.master_id, ctc.super_id, ctc.admin_id, ctc.owner_id,
               COALESCE(ctc.agent_percent, 0)  AS agent_percent,
               COALESCE(ctc.master_percent, 0) AS master_percent,
               COALESCE(ctc.super_percent, 0)  AS super_percent,
               COALESCE(ctc.admin_percent, 0)  AS admin_percent,
               COALESCE(ctc.owner_percent, 0)  AS owner_percent
          FROM casino_transactions cb
          JOIN casino_transaction_commissions ctc
            ON ctc.casino_bet_id = cb.id
           AND COALESCE(ctc.record_status, 0) = 0
          JOIN jsonb_to_recordset(var_bets)
                AS b(provider_bet_id varchar, outcome varchar, pl numeric)
            ON cb.provider_bet_id = b.provider_bet_id
         WHERE cb.provider = var_provider
           AND cb.user_id = var_user_id
           AND COALESCE(cb.record_status, 0) = 0
    )
    SELECT
        user_id,
        whitelabel_id,
        SUM(bet_net_pl)                                      AS net_pl,
        SUM(bet_net_pl * agent_percent  / 100.0)             AS agent_commission,
        SUM(bet_net_pl * master_percent / 100.0)             AS master_commission,
        SUM(bet_net_pl * super_percent  / 100.0)             AS super_commission,
        SUM(bet_net_pl * admin_percent  / 100.0)             AS admin_commission,
        SUM(bet_net_pl * owner_percent  / 100.0)             AS owner_commission,
        -- Postgres has no MAX(uuid). All bets for a single user share the
        -- same hierarchy, so picking any element via array_agg is correct.
        (array_agg(agent_id))[1]  AS agent_id,
        (array_agg(master_id))[1] AS master_id,
        (array_agg(super_id))[1]  AS super_id,
        (array_agg(admin_id))[1]  AS admin_id,
        (array_agg(owner_id))[1]  AS owner_id
      FROM settled_bets
     GROUP BY user_id, whitelabel_id;

    -- ── 7. voucher_details: User ↔ Parent (role 7).
    --    net_pl > 0 → user gets credited (dr_cr=1 on user row); net_pl < 0 → user is debited.
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        user_id,
        (CASE WHEN agent_id  IS NOT NULL THEN agent_id
              WHEN master_id IS NOT NULL THEN master_id
              WHEN super_id  IS NOT NULL THEN super_id
              WHEN admin_id  IS NOT NULL THEN admin_id
              WHEN owner_id  IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        7,
        varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl), 2),
        (CASE WHEN net_pl > 0 THEN 1 ELSE 0 END),  -- user won → credit user
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(net_pl, 0), 2) <> 0
       AND user_id IS NOT NULL;

    -- ── 8. Parent ↔ User (opposite direction of 7).
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(),
        varVoucherId,
        (CASE WHEN agent_id  IS NOT NULL THEN agent_id
              WHEN master_id IS NOT NULL THEN master_id
              WHEN super_id  IS NOT NULL THEN super_id
              WHEN admin_id  IS NOT NULL THEN admin_id
              WHEN owner_id  IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        user_id,
        7,
        varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl), 2),
        (CASE WHEN net_pl > 0 THEN 0 ELSE 1 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(net_pl, 0), 2) <> 0
       AND user_id IS NOT NULL;

    -- ── 9. Agent layer (role 6) — uses (net_pl - agent_commission). Same dr/cr
    -- semantics as sports declare_process steps 5/6.
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        agent_id,
        (CASE WHEN master_id IS NOT NULL THEN master_id
              WHEN super_id  IS NOT NULL THEN super_id
              WHEN admin_id  IS NOT NULL THEN admin_id
              WHEN owner_id  IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        6, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission), 2),
        (CASE WHEN (net_pl - agent_commission) > 0 THEN 1 ELSE 0 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(agent_commission, 0), 2) <> 0
       AND agent_id IS NOT NULL;

    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        (CASE WHEN master_id IS NOT NULL THEN master_id
              WHEN super_id  IS NOT NULL THEN super_id
              WHEN admin_id  IS NOT NULL THEN admin_id
              WHEN owner_id  IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        agent_id,
        6, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission), 2),
        (CASE WHEN (net_pl - agent_commission) > 0 THEN 0 ELSE 1 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(agent_commission, 0), 2) <> 0
       AND agent_id IS NOT NULL;

    -- ── 10. Master layer (role 5) — uses (net_pl - agent - master).
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        master_id,
        (CASE WHEN super_id IS NOT NULL THEN super_id
              WHEN admin_id IS NOT NULL THEN admin_id
              WHEN owner_id IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        5, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission - master_commission), 2),
        (CASE WHEN (net_pl - agent_commission - master_commission) > 0 THEN 1 ELSE 0 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(master_commission, 0), 2) <> 0
       AND master_id IS NOT NULL;

    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        (CASE WHEN super_id IS NOT NULL THEN super_id
              WHEN admin_id IS NOT NULL THEN admin_id
              WHEN owner_id IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        master_id,
        5, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission - master_commission), 2),
        (CASE WHEN (net_pl - agent_commission - master_commission) > 0 THEN 0 ELSE 1 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(master_commission, 0), 2) <> 0
       AND master_id IS NOT NULL;

    -- ── 11. Super layer (role 4) — uses (net_pl - agent - master - super).
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        super_id,
        (CASE WHEN admin_id IS NOT NULL THEN admin_id
              WHEN owner_id IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        4, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission - master_commission - super_commission), 2),
        (CASE WHEN (net_pl - agent_commission - master_commission - super_commission) > 0 THEN 1 ELSE 0 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(super_commission, 0), 2) <> 0
       AND super_id IS NOT NULL;

    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        (CASE WHEN admin_id IS NOT NULL THEN admin_id
              WHEN owner_id IS NOT NULL THEN owner_id
              ELSE varCompanyId END),
        super_id,
        4, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission - master_commission - super_commission), 2),
        (CASE WHEN (net_pl - agent_commission - master_commission - super_commission) > 0 THEN 0 ELSE 1 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(super_commission, 0), 2) <> 0
       AND super_id IS NOT NULL;

    -- ── 12. Admin layer (role 3) — uses (net_pl - agent - master - super - admin).
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        admin_id,
        (CASE WHEN owner_id IS NOT NULL THEN owner_id ELSE varCompanyId END),
        3, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission - master_commission - super_commission - admin_commission), 2),
        (CASE WHEN (net_pl - agent_commission - master_commission - super_commission - admin_commission) > 0 THEN 1 ELSE 0 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(admin_commission, 0), 2) <> 0
       AND admin_id IS NOT NULL;

    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        (CASE WHEN owner_id IS NOT NULL THEN owner_id ELSE varCompanyId END),
        admin_id,
        3, varVoucherType, varVoucherDetailType,
        ROUND(ABS(net_pl - agent_commission - master_commission - super_commission - admin_commission), 2),
        (CASE WHEN (net_pl - agent_commission - master_commission - super_commission - admin_commission) > 0 THEN 0 ELSE 1 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(admin_commission, 0), 2) <> 0
       AND admin_id IS NOT NULL;

    -- ── 13. Owner layer (role 0). Owner takes the residual P/L.
    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        owner_id, varCompanyId,
        0, varVoucherType, varVoucherDetailType,
        ROUND(ABS(owner_commission), 2),
        (CASE WHEN owner_commission > 0 THEN 1 ELSE 0 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(owner_commission, 0), 2) <> 0
       AND owner_id IS NOT NULL;

    INSERT INTO public.voucher_details (
        id, voucher_id, user_id, opposite_user_id, role,
        voucher_type, voucher_detail_type, amount, dr_cr, parent_voucher_detail_id,
        monday_final, remarks, remarks1, remarks2, remarks3, proof_image,
        transaction_id, reference_id, is_processed, description,
        whitelabel_id, voucher_date, added_by, added_date, update_by, update_date, record_status
    )
    SELECT
        gen_random_uuid(), varVoucherId,
        varCompanyId, owner_id,
        0, varVoucherType, varVoucherDetailType,
        ROUND(ABS(owner_commission), 2),
        (CASE WHEN owner_commission > 0 THEN 0 ELSE 1 END),
        NULL, FALSE,
        'Casino', var_provider, var_provider_round_id, varGameName,
        NULL,
        NULL, var_provider_transaction_id, FALSE, 'casino-declare-voucher',
        whitelabel_id, CURRENT_DATE,
        varSystemUserId, CURRENT_TIMESTAMP, varSystemUserId, CURRENT_TIMESTAMP, 0
      FROM casino_base_data
     WHERE ROUND(COALESCE(owner_commission, 0), 2) <> 0
       AND owner_id IS NOT NULL;

    -- ── 14. Recalc limit_consumed now that these bets are no longer 'matched'.
    CALL public.set_limit_used_of_user(var_user_id);

END;
$BODY$;

ALTER PROCEDURE public.casino_declare_round(uuid, varchar, varchar, varchar, numeric, jsonb, jsonb)
    OWNER TO postgres;
