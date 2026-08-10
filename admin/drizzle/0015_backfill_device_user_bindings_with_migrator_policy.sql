CREATE POLICY "device_user_bindings_migrator_backfill"
ON "app"."device_user_bindings"
FOR ALL TO sfp_migrator
USING (true)
WITH CHECK (true);--> statement-breakpoint
INSERT INTO "app"."device_user_bindings" ("device_id", "admin_user_id", "enterprise_id")
SELECT "id", "assigned_user_id", "enterprise_id"
FROM "app"."devices"
WHERE "assigned_user_id" IS NOT NULL
ON CONFLICT ("device_id", "admin_user_id") DO NOTHING;--> statement-breakpoint
DROP POLICY "device_user_bindings_migrator_backfill"
ON "app"."device_user_bindings";
