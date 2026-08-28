ALTER TABLE "app"."admin_users"
  ADD COLUMN IF NOT EXISTS "sensitive_operation_password_hash" text;
