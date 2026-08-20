ALTER TABLE "app"."platform_configs"
  ADD COLUMN IF NOT EXISTS "mini_program_code_config" jsonb;

UPDATE "app"."platform_configs"
SET "mini_program_code_config" = '{"environment":"develop"}'::jsonb
WHERE "mini_program_code_config" IS NULL;

ALTER TABLE "app"."platform_configs"
  ALTER COLUMN "mini_program_code_config" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "mini_program_code_config" SET NOT NULL;
