-- ─────────────────────────────────────────────────────────────────────────────
--  Matka result declaration table + indexes
--  Also adds shift_id to vouchers and voucher_details tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.declare_result (
  declare_id uuid NOT NULL DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL,
  declare_date date NOT NULL,
  declare_number int NOT NULL,
  is_needed int default 0,
  redeclare_nos int DEFAULT '0',
  added_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  added_date timestamp without time zone NOT NULL DEFAULT now(),
  update_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  update_date timestamp without time zone NOT NULL DEFAULT now(),
  record_status integer NOT NULL DEFAULT 0,
  CONSTRAINT declare_result_pkey PRIMARY KEY (declare_id)
);

ALTER TABLE IF EXISTS public.declare_result
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_declare_result_shift_id
    ON public.declare_result USING btree
    (shift_id ASC NULLS FIRST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_declare_result_declare_date
    ON public.declare_result USING btree
    (declare_date DESC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- Add shift_id to vouchers (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vouchers' AND column_name = 'shift_id'
  ) THEN
    ALTER TABLE public.vouchers
      ADD COLUMN shift_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
END $$;

-- Add shift_id to voucher_details (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'voucher_details' AND column_name = 'shift_id'
  ) THEN
    ALTER TABLE public.voucher_details
      ADD COLUMN shift_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
END $$;
