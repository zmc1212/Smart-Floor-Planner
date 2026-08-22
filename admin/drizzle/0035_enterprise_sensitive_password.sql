ALTER TABLE "app"."enterprises"
  ADD COLUMN IF NOT EXISTS "sensitive_operation_password_hash" text;
