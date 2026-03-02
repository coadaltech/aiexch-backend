CREATE TABLE "ledger_limit" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
  "user_limit" numeric(15, 2) DEFAULT '0' NOT NULL,
  "limit_consumed" numeric(15, 2) DEFAULT '0' NOT NULL,
  "final_limit" numeric(15, 2) DEFAULT '0' NOT NULL,
  "added_by" uuid,
  "added_at" timestamp DEFAULT now(),
  "updated_by" uuid,
  "updated_at" timestamp DEFAULT now()
);
