-- -- -- fn_list_owner_users(
-- -- --     p_current_user_id      uuid,
-- -- --     p_current_user_role    int,        -- UserRole: 0=Owner, 3=Admin, 4=Super, 5=Master, 6=Agent, 7=User
-- -- --     p_scope_whitelabel_id  uuid        -- NULL when owner is not operating on a specific whitelabel
-- -- -- )
-- -- --
-- -- -- Powers the admin page /owner/users (GET /owner/users). Returns the
-- -- -- downline the logged-in panel user is allowed to see, enriched with profile,
-- -- -- ledger, creator username, and whitelabel name.
-- -- --
-- -- -- Visibility rules — kept 1:1 with the old TS logic:
-- -- --
-- -- --   A) p_current_user_role = 0 (Owner) AND p_scope_whitelabel_id IS NULL
-- -- --      => all users except self, group_id >= 3
-- -- --         (excludes Owner-role and system group_id 0/1/2 accounts)
-- -- --
-- -- --   B) p_current_user_role != 0 AND p_scope_whitelabel_id IS NULL
-- -- --      => empty result (non-owner must be on a whitelabel)
-- -- --
-- -- --   C) p_scope_whitelabel_id IS NOT NULL
-- -- --      => users in that whitelabel, except self, group_id >= 3
-- -- --         Additional role-hierarchy filter when caller is NOT Owner or Admin:
-- -- --            super (4)  => group_id > 4  (sees master, agent, user)
-- -- --            master (5) => group_id > 5  (sees agent, user)
-- -- --            agent (6)  => group_id > 6  (sees user only)
-- -- --
-- -- -- Output — camelCase to match what the old Drizzle-based route returned.
-- -- -- Each row includes:
-- -- --   id, username, email, password (kept for parity with the old `SELECT *`),
-- -- --   role, groupId, whitelabelId, accountStatus, parentAccountStatus,
-- -- --   emailVerified, sessionToken, createdBy, addedBy, addedDate, updateBy,
-- -- --   updateDate, recordStatus,
-- -- --   membership, betStatus, parentBetStatus, upline, downline, currencyId,
-- -- --   lastLoginIp, lastLoginAt, firstName, lastName, phone, country,
-- -- --   addedByUsername, whitelabelName,
-- -- --   balance, userLimit, limitConsumed, fixLimit, finalLimit,
-- -- --   transactionLimit

-- -- CREATE OR REPLACE FUNCTION fn_list_owner_users(
-- --   p_current_user_id      uuid,
-- --   p_current_user_role    int,
-- --   p_scope_whitelabel_id  uuid DEFAULT NULL
-- -- )
-- -- RETURNS jsonb
-- -- LANGUAGE sql
-- -- STABLE
-- -- AS $$
-- --   WITH visible AS (
-- --     SELECT u.*
-- --     FROM users u
-- --     WHERE u.id <> p_current_user_id
-- --       AND COALESCE(u.group_id, -1) >= 3
-- --       AND CASE
-- --             -- Case C: scoped to a whitelabel
-- --             WHEN p_scope_whitelabel_id IS NOT NULL THEN
-- --               u.whitelabel_id = p_scope_whitelabel_id
-- --               AND (
-- --                 -- Owner (0) / Admin (3): no hierarchy filter
-- --                 p_current_user_role IN (0, 3)
-- --                 -- everyone else: only deeper ranks
-- --                 OR u.group_id > p_current_user_role
-- --               )
-- --             -- Case A: owner with no whitelabel scope
-- --             WHEN p_current_user_role = 0 THEN
-- --               TRUE
-- --             -- Case B: non-owner with no scope => nothing
-- --             ELSE
-- --               FALSE
-- --           END
-- --   )
-- --   SELECT COALESCE(
-- --     jsonb_agg(
-- --       jsonb_build_object(
-- --         -- ── users columns (camelCase, matching Drizzle's mapping) ──
-- --         'id',                   u.id,
-- --         'username',             u.username,
-- --         'email',                u.email,
-- --         'password',             u.password,
-- --         'role',                 u.role,
-- --         'groupId',              u.group_id,
-- --         'whitelabelId',         u.whitelabel_id,
-- --         'accountStatus',        u.account_status,
-- --         'parentAccountStatus',  u.parent_account_status,
-- --         'emailVerified',        u.email_verified,
-- --         'sessionToken',         u.session_token,
-- --         'createdBy',            u.created_by,
-- --         'addedBy',              u.added_by,
-- --         'addedDate',            u.added_date,
-- --         'updateBy',             u.update_by,
-- --         'updateDate',           u.update_date,
-- --         'recordStatus',         u.record_status,
-- --         -- ── profile fields (fallback to defaults when no profile row) ──
-- --         'membership',           COALESCE(p.membership,         0),      -- MembershipType.Bronze
-- --         'betStatus',            COALESCE(p.bet_status,         true),
-- --         'parentBetStatus',      COALESCE(p.parent_bet_status,  true),
-- --         'upline',               COALESCE(p.upline,             '0.00'),
-- --         'downline',             COALESCE(p.downline,           '0.00'),
-- --         'currencyId',           p.currency_id,
-- --         'lastLoginIp',          p.last_login_ip,
-- --         'lastLoginAt',          p.last_login_at,
-- --         'firstName',            NULLIF(p.first_name, ''),
-- --         'lastName',             NULLIF(p.last_name,  ''),
-- --         'phone',                NULLIF(p.phone,      ''),
-- --         'country',              NULLIF(p.country,    ''),
-- --         -- ── enrichment ──
-- --         'addedByUsername',      CASE
-- --                                   WHEN COALESCE(u.created_by, u.added_by) IS NULL
-- --                                     OR COALESCE(u.created_by, u.added_by)
-- --                                        = '00000000-0000-0000-0000-000000000000'::uuid
-- --                                     THEN 'System'
-- --                                   ELSE COALESCE(c.username, 'System')
-- --                                 END,
-- --         'whitelabelName',       w.name,
-- --         -- ── ledger (truncated to whole rupees — UI shows no decimals) ──
-- --         'balance',              COALESCE(TRUNC(l.user_balance)::text,      '0'),
-- --         'userLimit',            COALESCE(TRUNC(l.user_limit)::text,        '0'),
-- --         'limitConsumed',        COALESCE(TRUNC(l.limit_consumed)::text,    '0'),
-- --         'fixLimit',             COALESCE(TRUNC(l.fix_limit)::text,         '0'),
-- --         'finalLimit',           COALESCE(TRUNC(l.final_limit)::text,       '0'),
-- --         'transactionLimit',     COALESCE(TRUNC(l.transaction_limit)::text, '0')
-- --       )
-- --       ORDER BY u.added_date DESC
-- --     ),
-- --     '[]'::jsonb
-- --   )
-- --   FROM visible u
-- --   LEFT JOIN profiles      p ON p.user_id = u.id
-- --   LEFT JOIN ledger_limit  l ON l.user_id = u.id
-- --   LEFT JOIN users         c ON c.id      = COALESCE(u.created_by, u.added_by)
-- --   LEFT JOIN whitelabels   w ON w.id      = u.whitelabel_id;
-- -- $$;




-- -- FUNCTION: public.fn_list_owner_users(uuid, integer, uuid)

-- -- DROP FUNCTION IF EXISTS public.fn_list_owner_users(uuid, integer, uuid);

-- CREATE OR REPLACE FUNCTION public.fn_list_owner_users(
-- 	p_current_user_id uuid,
-- 	p_current_user_role integer,
-- 	p_scope_whitelabel_id uuid DEFAULT NULL::uuid)
--     RETURNS jsonb
--     LANGUAGE 'sql'
--     COST 100
--     STABLE PARALLEL UNSAFE
-- AS $BODY$
--   WITH visible AS (
--     SELECT u.*
--     FROM users u
--     WHERE u.id <> p_current_user_id
--       AND COALESCE(u.group_id, -1) >= 3
--       AND CASE
--             -- Case C: scoped to a whitelabel
--             WHEN p_scope_whitelabel_id IS NOT NULL THEN
--               u.whitelabel_id = p_scope_whitelabel_id
--               AND (
--                 -- Owner (0) / Admin (3): no hierarchy filter
--                 p_current_user_role IN (0, 3)
--                 -- everyone else: only deeper ranks
--                 OR u.group_id > p_current_user_role
--               )
--             -- Case A: owner with no whitelabel scope
--             WHEN p_current_user_role = 0 THEN
--               TRUE
--             -- Case B: non-owner with no scope => nothing
--             ELSE
--               FALSE
--           END
--   ),
--    vd as (
-- 		select whitelabel_id,sum(case when voucher_details.dr_cr = 0 then - voucher_details.amount else voucher_details.amount end) as totalpnl
-- 		from voucher_details
-- 		where voucher_type = 6
-- 		and record_status = 0
-- 		group by whitelabel_id
-- 	)
--   SELECT COALESCE(
--     jsonb_agg(
--       jsonb_build_object(
--         -- ── users columns (camelCase, matching Drizzle's mapping) ──
--         'id',                   u.id,
--         'username',             u.username,
--         'email',                u.email,
--         'password',             u.password,
--         'role',                 u.role,
--         'groupId',              u.group_id,
--         'whitelabelId',         u.whitelabel_id,
--         'accountStatus',        u.account_status,
--         'parentAccountStatus',  u.parent_account_status,
--         'emailVerified',        u.email_verified,
--         'sessionToken',         u.session_token,
--         'createdBy',            u.created_by,
--         'addedBy',              u.added_by,
--         'addedDate',            u.added_date,
--         'updateBy',             u.update_by,
--         'updateDate',           u.update_date,
--         'recordStatus',         u.record_status,
--         -- ── profile fields (fallback to defaults when no profile row) ──
--         'membership',           COALESCE(p.membership,         0),      -- MembershipType.Bronze
--         'betStatus',            COALESCE(p.bet_status,         true),
--         'parentBetStatus',      COALESCE(p.parent_bet_status,  true),
--         'upline',               COALESCE(p.upline,             '0.00'),
--         'downline',             COALESCE(p.downline,           '0.00'),
--         'currencyId',           p.currency_id,
--         'lastLoginIp',          p.last_login_ip,
--         'lastLoginAt',          p.last_login_at,
--         'firstName',            NULLIF(p.first_name, ''),
--         'lastName',             NULLIF(p.last_name,  ''),
--         'phone',                NULLIF(p.phone,      ''),
--         'country',              NULLIF(p.country,    ''),
--         -- ── enrichment ──
--         'addedByUsername',      CASE
--                                   WHEN COALESCE(u.created_by, u.added_by) IS NULL
--                                     OR COALESCE(u.created_by, u.added_by)
--                                        = '00000000-0000-0000-0000-000000000000'::uuid
--                                     THEN 'System'
--                                   ELSE COALESCE(c.username, 'System')
--                                 END,
--         'whitelabelName',       w.name,
--         -- ── ledger (truncated to whole rupees — UI shows no decimals) ──
--         'balance',              COALESCE(TRUNC(l.user_balance)::text,      '0'),
--         'userLimit',            COALESCE(TRUNC(l.user_limit)::text,        '0'),
--         'limitConsumed',        COALESCE(TRUNC(l.limit_consumed)::text,    '0'),
--         'fixLimit',             COALESCE(TRUNC(l.fix_limit)::text,         '0'),
--         'finalLimit',           COALESCE(TRUNC(l.final_limit)::text,       '0'),
--         'transactionLimit',     COALESCE(TRUNC(l.transaction_limit)::text, '0'),
--         'totalpnl',     COALESCE(TRUNC(vd.totalpnl)::text, '0')
      
-- 	  )
--       ORDER BY u.added_date DESC
--     ),
--     '[]'::jsonb
--   )
--   FROM visible u
--   LEFT JOIN profiles      p ON p.user_id = u.id
--   LEFT JOIN ledger_limit  l ON l.user_id = u.id
--   LEFT JOIN users         c ON c.id      = COALESCE(u.created_by, u.added_by)
--   LEFT JOIN whitelabels   w ON w.id      = u.whitelabel_id
--   left join vd 	on vd.whitelabel_id = u.whitelabel_id			
--   ;
-- $BODY$;

-- ALTER FUNCTION public.fn_list_owner_users(uuid, integer, uuid)
--     OWNER TO postgres;




-- FUNCTION: public.fn_list_owner_users(uuid, integer, uuid)

-- DROP FUNCTION IF EXISTS public.fn_list_owner_users(uuid, integer, uuid);

CREATE OR REPLACE FUNCTION public.fn_list_owner_users(
	p_current_user_id uuid,
	p_current_user_role integer,
	p_scope_whitelabel_id uuid DEFAULT NULL::uuid)
    RETURNS jsonb
    LANGUAGE 'sql'
    COST 100
    STABLE PARALLEL UNSAFE
AS $BODY$
  WITH visible AS (
    SELECT u.*
    FROM users u
    WHERE u.created_by = p_current_user_id
	/*
		u.id <> p_current_user_id
      AND COALESCE(u.group_id, -1) >= 3
      AND CASE
            -- Case C: scoped to a whitelabel
            WHEN p_scope_whitelabel_id IS NOT NULL THEN
              u.whitelabel_id = p_scope_whitelabel_id
              AND (
                -- Owner (0) / Admin (3): no hierarchy filter
                p_current_user_role IN (0, 3)
                -- everyone else: only deeper ranks
                OR u.group_id > p_current_user_role
              )
            -- Case A: owner with no whitelabel scope
            WHEN p_current_user_role = 0 THEN
              TRUE
            -- Case B: non-owner with no scope => nothing
            ELSE
              FALSE
          END
	*/
  ),
   vd as (
		select voucher_details.opposite_user_id ,sum(case when voucher_details.dr_cr = 0 then - voucher_details.amount else voucher_details.amount end) as totalpnl
		from voucher_details
		where voucher_details.voucher_type <> 2
		and voucher_details.record_status = 0
		and voucher_details.user_id = p_current_user_id
		group by voucher_details.opposite_user_id 
	)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        -- ── users columns (camelCase, matching Drizzle's mapping) ──
        'id',                   u.id,
        'username',             u.username,
        'email',                u.email,
        'password',             u.password,
        'role',                 u.role,
        'groupId',              u.group_id,
        'whitelabelId',         u.whitelabel_id,
        'accountStatus',        u.account_status,
        'parentAccountStatus',  u.parent_account_status,
        'emailVerified',        u.email_verified,
        'sessionToken',         u.session_token,
        'createdBy',            u.created_by,
        'addedBy',              u.added_by,
        'addedDate',            u.added_date,
        'updateBy',             u.update_by,
        'updateDate',           u.update_date,
        'recordStatus',         u.record_status,
        -- ── profile fields (fallback to defaults when no profile row) ──
        'membership',           COALESCE(p.membership,         0),      -- MembershipType.Bronze
        'betStatus',            COALESCE(p.bet_status,         true),
        'parentBetStatus',      COALESCE(p.parent_bet_status,  true),
        'upline',               COALESCE(p.upline,             '0.00'),
        'downline',             COALESCE(p.downline,           '0.00'),
        'currencyId',           p.currency_id,
        'lastLoginIp',          p.last_login_ip,
        'lastLoginAt',          p.last_login_at,
        'firstName',            NULLIF(p.first_name, ''),
        'lastName',             NULLIF(p.last_name,  ''),
        'phone',                NULLIF(p.phone,      ''),
        'country',              NULLIF(p.country,    ''),
        -- ── enrichment ──
        'addedByUsername',      CASE
                                  WHEN COALESCE(u.created_by, u.added_by) IS NULL
                                    OR COALESCE(u.created_by, u.added_by)
                                       = '00000000-0000-0000-0000-000000000000'::uuid
                                    THEN 'System'
                                  ELSE COALESCE(c.username, 'System')
                                END,
        'whitelabelName',       w.name,
        -- ── ledger (truncated to whole rupees — UI shows no decimals) ──
        'balance',              COALESCE(TRUNC(l.user_balance)::text,      '0'),
        'userLimit',            COALESCE(TRUNC(l.user_limit)::text,        '0'),
        'limitConsumed',        COALESCE(TRUNC(l.limit_consumed)::text,    '0'),
        'fixLimit',             COALESCE(TRUNC(l.fix_limit)::text,         '0'),
        'finalLimit',           COALESCE(TRUNC(l.final_limit)::text,       '0'),
        'transactionLimit',     COALESCE(TRUNC(l.transaction_limit)::text, '0'),
        'totalpnl',     COALESCE(TRUNC(vd.totalpnl)::text, '0')
      
	  )
      ORDER BY u.added_date DESC
    ),
    '[]'::jsonb
  )
  FROM visible u
  LEFT JOIN profiles      p ON p.user_id = u.id
  LEFT JOIN ledger_limit  l ON l.user_id = u.id
  LEFT JOIN users         c ON c.id      = COALESCE(u.created_by, u.added_by)
  LEFT JOIN whitelabels   w ON w.id      = u.whitelabel_id
  left join vd 	on vd.opposite_user_id = u.id			
  ;
$BODY$;

ALTER FUNCTION public.fn_list_owner_users(uuid, integer, uuid)
    OWNER TO postgres;