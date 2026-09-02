ALTER TABLE "app"."platform_configs"
  ADD COLUMN IF NOT EXISTS "enterprise_registration_code_template_config" jsonb;
