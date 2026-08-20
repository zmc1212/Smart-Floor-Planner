ALTER TABLE "app"."lead_commissions"
  ADD COLUMN IF NOT EXISTS "original_payable_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  ADD COLUMN IF NOT EXISTS "original_beneficiary_user_id" bigint;
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  ADD COLUMN IF NOT EXISTS "adjusted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  ADD COLUMN IF NOT EXISTS "adjusted_by" bigint;
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  ADD COLUMN IF NOT EXISTS "adjust_reason" text;
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "app"."lead_commissions"
SET
  "original_payable_amount" = "payable_amount",
  "original_beneficiary_user_id" = "beneficiary_user_id"
WHERE "original_payable_amount" IS NULL
   OR "original_beneficiary_user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  ALTER COLUMN "original_payable_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."lead_commissions"
  ALTER COLUMN "original_beneficiary_user_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_commissions_original_beneficiary_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "app"."lead_commissions"
      ADD CONSTRAINT "lead_commissions_original_beneficiary_user_id_users_id_fk"
      FOREIGN KEY ("original_beneficiary_user_id") REFERENCES "app"."users"("id") ON DELETE restrict;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_commissions_adjusted_by_admin_users_id_fk'
  ) THEN
    ALTER TABLE "app"."lead_commissions"
      ADD CONSTRAINT "lead_commissions_adjusted_by_admin_users_id_fk"
      FOREIGN KEY ("adjusted_by") REFERENCES "app"."admin_users"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_commissions_original_amount_check'
  ) THEN
    ALTER TABLE "app"."lead_commissions"
      ADD CONSTRAINT "lead_commissions_original_amount_check"
      CHECK ("original_payable_amount" >= 0);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_commissions_original_beneficiary_idx"
  ON "app"."lead_commissions" ("original_beneficiary_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_commissions_adjusted_by_idx"
  ON "app"."lead_commissions" ("adjusted_by");
