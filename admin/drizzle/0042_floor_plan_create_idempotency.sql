ALTER TABLE "app"."floor_plans"
  ADD COLUMN IF NOT EXISTS "create_idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "floor_plans_create_idempotency_key_uidx"
  ON "app"."floor_plans" ("create_idempotency_key");
