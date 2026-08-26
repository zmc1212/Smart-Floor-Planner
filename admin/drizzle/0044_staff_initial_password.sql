ALTER TABLE "app"."admin_users"
ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "app"."admin_users"
SET
  "password_hash" = '$2b$10$.jx4CzcEICyMaDqt2pDXwe3Ji57vdr6R24lytBn6Kl8Ldszp18rZ.',
  "must_change_password" = true,
  "updated_at" = now()
WHERE left("username", 3) = 'wx_'
  AND "user_id" IS NOT NULL
  AND "role" IN ('designer', 'measurer');
