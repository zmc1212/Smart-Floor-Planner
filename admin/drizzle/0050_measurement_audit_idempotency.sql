ALTER TABLE "app"."measurements"
  ADD COLUMN IF NOT EXISTS "audit_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "measurements_floor_plan_audit_id_uidx"
  ON "app"."measurements" ("floor_plan_id", "audit_id")
  WHERE "audit_id" IS NOT NULL;
