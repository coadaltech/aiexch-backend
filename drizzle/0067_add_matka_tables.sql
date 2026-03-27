-- Matka Shifts
CREATE TABLE IF NOT EXISTS "matka_shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "shift_date" date NOT NULL,
  "end_time" varchar(30) NOT NULL,
  "shift_order" integer DEFAULT 0 NOT NULL,
  "dara_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
  "dara_commission" numeric(10, 2) DEFAULT '0' NOT NULL,
  "akhar_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
  "akhar_commission" numeric(10, 2) DEFAULT '0' NOT NULL,
  "main_jantri_time" varchar(30),
  "result" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "added_by" varchar(50) DEFAULT 'system' NOT NULL,
  "added_date" timestamp DEFAULT now() NOT NULL,
  "update_by" varchar(50) DEFAULT 'system' NOT NULL,
  "update_date" timestamp DEFAULT now() NOT NULL,
  "record_status" integer DEFAULT 0 NOT NULL
);

-- Matka Transactions
CREATE TABLE IF NOT EXISTS "matka_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "shift_id" uuid NOT NULL REFERENCES "matka_shifts"("id") ON DELETE CASCADE,
  "transaction_date" date NOT NULL,
  "dara_rate" numeric(10, 2) NOT NULL,
  "dara_commission" numeric(10, 2) NOT NULL,
  "akhar_rate" numeric(10, 2) NOT NULL,
  "akhar_commission" numeric(10, 2) NOT NULL,
  "total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
  "total_commission" numeric(15, 2) DEFAULT '0' NOT NULL,
  "final_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
  "device_type" varchar(10) DEFAULT 'WEB' NOT NULL,
  "added_by" varchar(50) DEFAULT 'system' NOT NULL,
  "added_date" timestamp DEFAULT now() NOT NULL,
  "update_by" varchar(50) DEFAULT 'system' NOT NULL,
  "update_date" timestamp DEFAULT now() NOT NULL,
  "record_status" integer DEFAULT 0 NOT NULL
);

-- Matka Transaction Details
CREATE TABLE IF NOT EXISTS "matka_transaction_details" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "transaction_id" uuid NOT NULL REFERENCES "matka_transactions"("id") ON DELETE CASCADE,
  "number_type" integer NOT NULL,
  "number" varchar(4) NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "rate" numeric(10, 2) NOT NULL,
  "commission" numeric(10, 2) DEFAULT '0' NOT NULL,
  "final_amount" numeric(15, 2) NOT NULL,
  "order_number" integer DEFAULT 0 NOT NULL,
  "added_by" varchar(50) DEFAULT 'system' NOT NULL,
  "added_date" timestamp DEFAULT now() NOT NULL,
  "update_by" varchar(50) DEFAULT 'system' NOT NULL,
  "update_date" timestamp DEFAULT now() NOT NULL,
  "record_status" integer DEFAULT 0 NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_matka_shifts_date" ON "matka_shifts" ("shift_date");
CREATE INDEX IF NOT EXISTS "idx_matka_shifts_active" ON "matka_shifts" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_matka_txn_user" ON "matka_transactions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_matka_txn_shift" ON "matka_transactions" ("shift_id");
CREATE INDEX IF NOT EXISTS "idx_matka_txn_date" ON "matka_transactions" ("transaction_date");
CREATE INDEX IF NOT EXISTS "idx_matka_detail_txn" ON "matka_transaction_details" ("transaction_id");
CREATE INDEX IF NOT EXISTS "idx_matka_detail_number" ON "matka_transaction_details" ("number");
