-- Managed currencies (owner-only)
CREATE TABLE IF NOT EXISTS "currencies" (
  "id" bigint PRIMARY KEY NOT NULL,
  "code" varchar(10) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "country_name" varchar(100) NOT NULL,
  "value" numeric(18, 6) NOT NULL DEFAULT '1',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- History of currency value changes
CREATE TABLE IF NOT EXISTS "currency_value_history" (
  "id" bigint PRIMARY KEY NOT NULL,
  "currency_id" bigint NOT NULL REFERENCES "currencies"("id") ON DELETE CASCADE,
  "value" numeric(18, 6) NOT NULL,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "currency_value_history_currency_id_idx" ON "currency_value_history" ("currency_id");
