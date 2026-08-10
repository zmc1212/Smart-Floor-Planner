INSERT INTO "app"."device_user_bindings" ("device_id", "admin_user_id", "enterprise_id")
SELECT "id", "assigned_user_id", "enterprise_id"
FROM "app"."devices"
WHERE "assigned_user_id" IS NOT NULL
ON CONFLICT ("device_id", "admin_user_id") DO NOTHING;
