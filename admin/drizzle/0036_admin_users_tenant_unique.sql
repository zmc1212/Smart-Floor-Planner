DROP INDEX IF EXISTS "app"."admin_users_user_uidx";
--> statement-breakpoint
DROP INDEX IF EXISTS "app"."admin_users_phone_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_enterprise_user_uidx"
  ON "app"."admin_users" ("enterprise_id", "user_id")
  WHERE "enterprise_id" IS NOT NULL AND "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_enterprise_phone_uidx"
  ON "app"."admin_users" ("enterprise_id", "phone")
  WHERE "enterprise_id" IS NOT NULL AND "phone" IS NOT NULL;
