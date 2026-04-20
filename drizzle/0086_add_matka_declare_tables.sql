-- ============================================================
-- 0086 — Matka declare archive tables (+ supporting indexes).
--
-- Created to hold an archival snapshot of matka_transactions,
-- matka_transaction_details, matka_transaction_logs and
-- matka_transaction_commissions at the moment declare_process_matka
-- runs. The procedure copies rows into these tables and deletes
-- them from the live tables.
--
-- Safe to re-run: CREATE TABLE/INDEX IF NOT EXISTS.
-- ============================================================

-- ── matka_transactions_declare ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.matka_transactions_declare
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    shift_id uuid,
    transaction_date date NOT NULL,
    dara_rate numeric(10,2) NOT NULL,
    dara_commission numeric(10,2) NOT NULL,
    akhar_rate numeric(10,2) NOT NULL,
    akhar_commission numeric(10,2) NOT NULL,
    total_amount numeric(15,2) NOT NULL DEFAULT '0'::numeric,
    total_commission numeric(15,2) NOT NULL DEFAULT '0'::numeric,
    final_amount numeric(15,2) NOT NULL DEFAULT '0'::numeric,
    device_type character varying(10) COLLATE pg_catalog."default" NOT NULL DEFAULT 'WEB'::character varying,
    added_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    added_date timestamp without time zone NOT NULL DEFAULT now(),
    update_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    update_date timestamp without time zone NOT NULL DEFAULT now(),
    record_status integer NOT NULL DEFAULT 0,
    copy_reference_shift_id uuid,
    whitelabel_id uuid,
    CONSTRAINT matka_transactions_declare_pkey PRIMARY KEY (id)
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.matka_transactions_declare
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_matka_transactions_declare_shift_id
    ON public.matka_transactions_declare USING btree
    (shift_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_matka_transactions_declare_transaction_date
    ON public.matka_transactions_declare USING btree
    (transaction_date DESC NULLS FIRST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_matka_transactions_declare_user_id
    ON public.matka_transactions_declare USING btree
    (user_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- ── matka_transaction_logs_declare ──────────────────────────
CREATE TABLE IF NOT EXISTS public.matka_transaction_logs_declare
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    matka_transaction_id uuid NOT NULL,
    ip_address character varying(45) COLLATE pg_catalog."default",
    user_agent text COLLATE pg_catalog."default",
    browser character varying(100) COLLATE pg_catalog."default",
    browser_version character varying(50) COLLATE pg_catalog."default",
    os character varying(100) COLLATE pg_catalog."default",
    os_version character varying(50) COLLATE pg_catalog."default",
    device_type character varying(20) COLLATE pg_catalog."default",
    device_brand character varying(100) COLLATE pg_catalog."default",
    device_model character varying(100) COLLATE pg_catalog."default",
    country character varying(100) COLLATE pg_catalog."default",
    city character varying(100) COLLATE pg_catalog."default",
    added_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    added_date timestamp without time zone NOT NULL DEFAULT now(),
    update_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    update_date timestamp without time zone NOT NULL DEFAULT now(),
    record_status integer NOT NULL DEFAULT 0,
    CONSTRAINT matka_transaction_declare_logs_pkey PRIMARY KEY (id)
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.matka_transaction_logs_declare
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_matka_tl_declare_matka_tx_id
    ON public.matka_transaction_logs_declare USING btree
    (matka_transaction_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- ── matka_transaction_details_declare ───────────────────────
CREATE TABLE IF NOT EXISTS public.matka_transaction_details_declare
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    transaction_id uuid NOT NULL,
    number_type integer NOT NULL,
    "number" character varying(4) COLLATE pg_catalog."default" NOT NULL,
    amount numeric(15,2) NOT NULL,
    rate numeric(10,2) NOT NULL,
    commission numeric(10,2) NOT NULL DEFAULT '0'::numeric,
    final_amount numeric(15,2) NOT NULL,
    order_number integer NOT NULL DEFAULT 0,
    added_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    added_date timestamp without time zone NOT NULL DEFAULT now(),
    update_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    update_date timestamp without time zone NOT NULL DEFAULT now(),
    record_status integer NOT NULL DEFAULT 0,
    CONSTRAINT matka_transaction_details_declare_pkey PRIMARY KEY (id)
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.matka_transaction_details_declare
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_matka_td_declare_transaction_id
    ON public.matka_transaction_details_declare USING btree
    (transaction_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- ── matka_transaction_commissions_declare ───────────────────
CREATE TABLE IF NOT EXISTS public.matka_transaction_commissions_declare
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    matka_transaction_id uuid NOT NULL,
    agent_id uuid,
    agent_percent numeric(5,2) DEFAULT '0'::numeric,
    master_id uuid,
    master_percent numeric(5,2) DEFAULT '0'::numeric,
    super_id uuid,
    super_percent numeric(5,2) DEFAULT '0'::numeric,
    admin_id uuid,
    admin_percent numeric(5,2) DEFAULT '0'::numeric,
    owner_id uuid,
    owner_percent numeric(5,2) DEFAULT '0'::numeric,
    added_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    added_date timestamp without time zone NOT NULL DEFAULT now(),
    update_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    update_date timestamp without time zone NOT NULL DEFAULT now(),
    record_status integer NOT NULL DEFAULT 0,
    CONSTRAINT matka_transaction_commissions_declare_pkey PRIMARY KEY (id)
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.matka_transaction_commissions_declare
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_matka_tc_declare_matka_tx_id
    ON public.matka_transaction_commissions_declare USING btree
    (matka_transaction_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
