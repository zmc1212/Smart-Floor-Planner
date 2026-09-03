ALTER TABLE "app"."platform_configs"
  ADD COLUMN IF NOT EXISTS "llm_config" jsonb;
