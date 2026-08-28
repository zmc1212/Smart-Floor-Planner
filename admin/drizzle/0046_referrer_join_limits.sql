ALTER TABLE "app"."enterprises"
  ADD COLUMN IF NOT EXISTS "referrer_additional_enterprise_limit" integer;
--> statement-breakpoint
ALTER TABLE "app"."enterprises"
  ADD CONSTRAINT "enterprises_referrer_additional_enterprise_limit_check"
  CHECK (
    "referrer_additional_enterprise_limit" IS NULL
    OR ("referrer_additional_enterprise_limit" BETWEEN 0 AND 99)
  );
