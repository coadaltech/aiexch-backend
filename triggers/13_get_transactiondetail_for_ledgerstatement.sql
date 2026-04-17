-- Return signature changed (added ip_address, record_status), so we must drop first.
DROP FUNCTION IF EXISTS public.get_user_account_ledger_statement_transaction_detail(uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION public.get_user_account_ledger_statement_transaction_detail(
    varuser_id uuid,
    varmarket_id numeric,
    varvoucher_id uuid
)
RETURNS TABLE(
    transaction_id       uuid,
    runner_id            bigint,
    runner_name          varchar(255),
    is_user_selection    boolean,
    bet_type             integer,
    price                numeric(10,4),
    run                  integer,
    stake                numeric(15,2),
    potential_return     numeric(15,2),
    settled_amount       numeric(15,2),   -- actual per-bet P&L from voucher_details

    added_by             uuid,
    added_date           timestamp without time zone,
    update_by            uuid,
    update_date          timestamp without time zone,

    agent_id             uuid,
    agent_percent        numeric(5,2),
    master_id            uuid,
    master_percent       numeric(5,2),
    super_id             uuid,
    super_percent        numeric(5,2),
    admin_id             uuid,
    admin_percent        numeric(5,2),
    owner_id             uuid,
    owner_percent        numeric(5,2),

    event_id             bigint,
    event_type_id        bigint,
    competition_id       bigint,
    market_id            numeric,
    market_type          integer,
    status               varchar(20),
    winner_id            bigint,
    winner_name          varchar(255),
    runners              jsonb,
    source               varchar(20),
    api_response         jsonb,
    settled_at           timestamp without time zone,
    declared_at          timestamp without time zone,
    runs                 integer,

    ip_address           varchar(45),
    user_agent           text,
    browser              varchar(100),
    browser_version      varchar(50),
    os                   varchar(100),
    os_version           varchar(50),
    device_type          varchar(20),
    device_brand         varchar(100),
    device_model         varchar(100),
    country              varchar(100),
    city                 varchar(100),
    record_status        integer
)
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH trans AS (
        -- Settled bets live in transactions_declare, not transactions.
        -- Also scope to the requesting user so we only return this user's bets.
        SELECT td.id, td.market_id
          FROM transactions_declare td
         WHERE td.record_status = 0
           AND td.market_id     = varmarket_id
           AND td.user_id       = varuser_id
    )
    SELECT
        tdd.transaction_id,
        tdd.runner_id,
        tdd.runner_name,
        tdd.is_user_selection,
        tdd.bet_type,
        tdd.price,
        tdd.run,
        tdd.stake,
        tdd.potential_return,

        -- Per-bet P&L from voucher_details, signed by dr_cr (1=credit, 0=debit).
        -- If the bet isn't settled yet, no voucher_details row exists → 0.
        COALESCE(
          (SELECT SUM(CASE WHEN vd.dr_cr = 1 THEN vd.amount ELSE -vd.amount END)
             FROM voucher_details vd
            WHERE vd.transaction_id = tdd.transaction_id
              AND vd.user_id        = varuser_id
              AND vd.record_status  = 0),
          0
        )::numeric(15,2) AS settled_amount,

        tdd.added_by,
        tdd.added_date,
        tdd.update_by,
        tdd.update_date,

        tcd.agent_id,
        tcd.agent_percent,
        tcd.master_id,
        tcd.master_percent,
        tcd.super_id,
        tcd.super_percent,
        tcd.admin_id,
        tcd.admin_percent,
        tcd.owner_id,
        tcd.owner_percent,

        mr.event_id,
        mr.event_type_id,
        mr.competition_id,
        mr.market_id,
        mr.market_type,
        mr.status,
        mr.winner_id,
        mr.winner_name,
        mr.runners,
        mr.source,
        mr.api_response,
        mr.settled_at,
        mr.declared_at,
        mr.runs,

        tld.ip_address,
        tld.user_agent,
        tld.browser,
        tld.browser_version,
        tld.os,
        tld.os_version,
        tld.device_type,
        tld.device_brand,
        tld.device_model,
        tld.country,
        tld.city,
        tdd.record_status
    FROM trans
    INNER JOIN transaction_details_declare tdd
            ON tdd.transaction_id     = trans.id
           AND tdd.is_user_selection  = TRUE
    LEFT JOIN transaction_commissions_declare tcd
            ON tcd.transaction_id = trans.id
           AND tcd.record_status  = 0
    -- Match market_results to THIS market (original was a cartesian product).
    LEFT JOIN market_results mr
            ON mr.market_id      = trans.market_id
           AND mr.record_status  = 0
    -- Join transaction_logs_declare for IP address
    LEFT JOIN transaction_logs_declare tld
            ON tld.transaction_id = trans.id
           AND tld.record_status  = 0
    ORDER BY tdd.added_date DESC;
END;
$function$;



ALTER FUNCTION public.get_user_account_ledger_statement_transaction_detail(
    uuid,
    numeric,
    uuid
)
    OWNER TO postgres;
