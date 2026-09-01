ALTER TABLE "app"."platform_configs"
  ADD COLUMN IF NOT EXISTS "ai_prompt_config" jsonb;
