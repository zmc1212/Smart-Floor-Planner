-- The app schema forces row-level security on admin_users.  The previous
-- column migration could add must_change_password but could not see tenant
-- rows while running as sfp_migrator, so repeat the password backfill through
-- a temporary, migration-only policy.
CREATE POLICY "admin_users_migrator_initial_password_backfill"
ON "app"."admin_users"
FOR ALL TO sfp_migrator
USING (true)
WITH CHECK (true);
--> statement-breakpoint
UPDATE "app"."admin_users"
SET
  "password_hash" = '$2b$10$.jx4CzcEICyMaDqt2pDXwe3Ji57vdr6R24lytBn6Kl8Ldszp18rZ.',
  "must_change_password" = true,
  "updated_at" = now()
WHERE left("username", 3) = 'wx_'
  AND "user_id" IS NOT NULL
  AND "role" IN ('designer', 'measurer');
--> statement-breakpoint
DROP POLICY "admin_users_migrator_initial_password_backfill"
ON "app"."admin_users";
