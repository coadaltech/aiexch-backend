-- fn_list_user_children(p_parent_user_id uuid)
--
-- Powers the owner-side "drill into a user's downline" modal. Returns the
-- direct children of the given user (i.e. accounts whose created_by points at
-- this user, or — for legacy rows where created_by is null — accounts whose
-- added_by points at them), enriched with the same profile / ledger fields
-- that fn_list_owner_users returns. Output shape is intentionally identical
-- to fn_list_owner_users so the frontend can render the same row template
-- without branching on data source.
--
-- Index usage: the WHERE clause is split into two equality checks so the
-- existing idx_users_created_by index can be used. No COALESCE wrapping the
-- column — that would force a sequential scan.
--
-- Scope is intentionally narrow: this function does NOT enforce whitelabel
-- visibility or role hierarchy. The caller (the owner-users route) has
-- already verified the current user can see `p_parent_user_id`; the children
-- of that user are by definition reachable.

/* ─────────────────────────────────────────────────────────────────────────
   OLD VERSION — kept for reference. Replaced by the version below which
   adds the per-whitelabel `totalpnl` aggregate, matching fn_list_owner_users.

CREATE OR REPLACE FUNCTION fn_list_user_children(
  p_parent_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH visible AS (
    SELECT u.*
    FROM users u
    WHERE u.created_by = p_parent_user_id
       OR (u.created_by IS NULL AND u.added_by = p_parent_user_id)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                   u.id,
        'username',             u.username,
        'email',                u.email,
        'role',                 u.role,
        'groupId',              u.group_id,
        'whitelabelId',         u.whitelabel_id,
        'accountStatus',        u.account_status,
        'parentAccountStatus',  u.parent_account_status,
        'createdBy',            u.created_by,
        'addedBy',              u.added_by,
        'addedDate',            u.added_date,
        'updateDate',           u.update_date,
        'recordStatus',         u.record_status,
        'membership',           COALESCE(p.membership,         0),
        'betStatus',            COALESCE(p.bet_status,         true),
        'parentBetStatus',      COALESCE(p.parent_bet_status,  true),
        'upline',               COALESCE(p.upline,             '0.00'),
        'downline',             COALESCE(p.downline,           '0.00'),
        'currencyId',           p.currency_id,
        'firstName',            NULLIF(p.first_name, ''),
        'lastName',             NULLIF(p.last_name,  ''),
        'phone',                NULLIF(p.phone,      ''),
        'country',              NULLIF(p.country,    ''),
        'balance',              COALESCE(TRUNC(l.user_balance)::text,      '0'),
        'userLimit',            COALESCE(TRUNC(l.user_limit)::text,        '0'),
        'limitConsumed',        COALESCE(TRUNC(l.limit_consumed)::text,    '0'),
        'fixLimit',             COALESCE(TRUNC(l.fix_limit)::text,         '0'),
        'finalLimit',           COALESCE(TRUNC(l.final_limit)::text,       '0'),
        'transactionLimit',     COALESCE(TRUNC(l.transaction_limit)::text, '0')
      )
      ORDER BY u.added_date DESC
    ),
    '[]'::jsonb
  )
  FROM visible u
  LEFT JOIN profiles      p ON p.user_id = u.id
  LEFT JOIN ledger_limit  l ON l.user_id = u.id;
$$;
   ───────────────────────────────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION fn_list_user_children(
  p_parent_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  -- No record_status filter here, mirroring fn_list_owner_users — soft-delete
  -- semantics aren't enforced at the SQL layer for this listing.
  WITH visible AS (
    SELECT u.*
    FROM users u
    WHERE u.created_by = p_parent_user_id
       OR (u.created_by IS NULL AND u.added_by = p_parent_user_id)
  ),
  vd AS (
    SELECT whitelabel_id,
           SUM(CASE WHEN voucher_details.dr_cr = 0
                    THEN -voucher_details.amount
                    ELSE  voucher_details.amount END) AS totalpnl
    FROM voucher_details
    WHERE voucher_type = 6
      AND record_status = 0
    GROUP BY whitelabel_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        -- ── users columns ──
        'id',                   u.id,
        'username',             u.username,
        'email',                u.email,
        'role',                 u.role,
        'groupId',              u.group_id,
        'whitelabelId',         u.whitelabel_id,
        'accountStatus',        u.account_status,
        'parentAccountStatus',  u.parent_account_status,
        'createdBy',            u.created_by,
        'addedBy',              u.added_by,
        'addedDate',            u.added_date,
        'updateDate',           u.update_date,
        'recordStatus',         u.record_status,
        -- ── profile fields (fallback to defaults when no profile row) ──
        'membership',           COALESCE(p.membership,         0),
        'betStatus',            COALESCE(p.bet_status,         true),
        'parentBetStatus',      COALESCE(p.parent_bet_status,  true),
        'upline',               COALESCE(p.upline,             '0.00'),
        'downline',             COALESCE(p.downline,           '0.00'),
        'currencyId',           p.currency_id,
        'firstName',            NULLIF(p.first_name, ''),
        'lastName',             NULLIF(p.last_name,  ''),
        'phone',                NULLIF(p.phone,      ''),
        'country',              NULLIF(p.country,    ''),
        -- ── ledger (truncated to whole rupees — UI shows no decimals) ──
        'balance',              COALESCE(TRUNC(l.user_balance)::text,      '0'),
        'userLimit',            COALESCE(TRUNC(l.user_limit)::text,        '0'),
        'limitConsumed',        COALESCE(TRUNC(l.limit_consumed)::text,    '0'),
        'fixLimit',             COALESCE(TRUNC(l.fix_limit)::text,         '0'),
        'finalLimit',           COALESCE(TRUNC(l.final_limit)::text,       '0'),
        'transactionLimit',     COALESCE(TRUNC(l.transaction_limit)::text, '0'),
        'totalpnl',             COALESCE(TRUNC(vd.totalpnl)::text,         '0')
      )
      ORDER BY u.added_date DESC
    ),
    '[]'::jsonb
  )
  FROM visible u
  LEFT JOIN profiles      p  ON p.user_id       = u.id
  LEFT JOIN ledger_limit  l  ON l.user_id       = u.id
  LEFT JOIN vd               ON vd.whitelabel_id = u.whitelabel_id;
$$;
