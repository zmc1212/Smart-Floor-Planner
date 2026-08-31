ALTER TABLE "app"."enterprise_join_codes"
  ADD COLUMN IF NOT EXISTS "inviter_staff_id" bigint
  REFERENCES "app"."admin_users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "app"."enterprise_join_codes"
  ADD CONSTRAINT "enterprise_join_codes_inviter_type_check"
  CHECK ("inviter_staff_id" IS NULL OR "code_type" = 'referrer');
--> statement-breakpoint
DROP INDEX IF EXISTS "app"."enterprise_join_codes_active_type_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_join_codes_active_enterprise_scope_uidx"
  ON "app"."enterprise_join_codes" ("enterprise_id", "code_type")
  WHERE "status" = 'active' AND "inviter_staff_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_join_codes_active_staff_scope_uidx"
  ON "app"."enterprise_join_codes" ("enterprise_id", "code_type", "inviter_staff_id")
  WHERE "status" = 'active' AND "inviter_staff_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_join_codes_inviter_staff_created_idx"
  ON "app"."enterprise_join_codes" ("inviter_staff_id", "created_at");
--> statement-breakpoint
ALTER TABLE "app"."referrer_enterprise_memberships"
  ADD COLUMN IF NOT EXISTS "invited_by_staff_id" bigint
  REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "app"."referrer_enterprise_memberships"
  ADD COLUMN IF NOT EXISTS "invited_by_name_snapshot" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrer_memberships_enterprise_inviter_status_idx"
  ON "app"."referrer_enterprise_memberships" (
    "enterprise_id",
    "invited_by_staff_id",
    "status"
  );
--> statement-breakpoint

-- Both tables use FORCE ROW LEVEL SECURITY.  The migration connection runs as
-- sfp_migrator, so temporarily grant only this migration's backfill access;
-- the policies are removed before the migration commits.
CREATE POLICY "staff_referrer_network_migrator_admin_users"
ON "app"."admin_users"
FOR SELECT TO sfp_migrator
USING (true);
--> statement-breakpoint
CREATE POLICY "staff_referrer_network_migrator_memberships"
ON "app"."referrer_enterprise_memberships"
FOR ALL TO sfp_migrator
USING (true)
WITH CHECK (true);
--> statement-breakpoint
WITH sole_enterprise_admin AS (
  SELECT
    enterprise_id,
    min(id) AS staff_id
  FROM "app"."admin_users"
  WHERE enterprise_id IS NOT NULL
    AND role = 'enterprise_admin'
  GROUP BY enterprise_id
  HAVING count(*) = 1
)
UPDATE "app"."referrer_enterprise_memberships" AS membership
SET
  "invited_by_staff_id" = owner.id,
  "invited_by_name_snapshot" = COALESCE(
    NULLIF(btrim(owner.display_name), ''),
    NULLIF(btrim(owner.username), ''),
    '企业负责人'
  )
FROM sole_enterprise_admin AS sole
JOIN "app"."admin_users" AS owner ON owner.id = sole.staff_id
WHERE membership.enterprise_id = sole.enterprise_id
  AND membership.invited_by_staff_id IS NULL;
--> statement-breakpoint
DROP POLICY "staff_referrer_network_migrator_memberships"
ON "app"."referrer_enterprise_memberships";
--> statement-breakpoint
DROP POLICY "staff_referrer_network_migrator_admin_users"
ON "app"."admin_users";
