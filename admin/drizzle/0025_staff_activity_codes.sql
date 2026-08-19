CREATE TABLE "app"."staff_activity_codes" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "staff_id" bigint NOT NULL REFERENCES "app"."admin_users"("id") ON DELETE restrict,
  "token_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "version" integer NOT NULL DEFAULT 1,
  "disabled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "staff_activity_codes_status_check" CHECK ("status" IN ('active', 'rotated', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_activity_codes_token_hash_uidx" ON "app"."staff_activity_codes" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_activity_codes_active_staff_uidx" ON "app"."staff_activity_codes" ("staff_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "staff_activity_codes_enterprise_created_idx" ON "app"."staff_activity_codes" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "staff_activity_codes_staff_created_idx" ON "app"."staff_activity_codes" ("staff_id", "created_at");
--> statement-breakpoint
ALTER TABLE "app"."promotion_scan_audits"
  ADD COLUMN "staff_activity_code_id" bigint REFERENCES "app"."staff_activity_codes"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "promotion_scan_audits_staff_activity_code_idx" ON "app"."promotion_scan_audits" ("staff_activity_code_id");
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE app.staff_activity_codes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.staff_activity_codes FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON app.staff_activity_codes FOR ALL TO sfp_app
    USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))
    WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()));
  CREATE POLICY auditor_read_all ON app.staff_activity_codes FOR SELECT TO sfp_auditor USING (true);
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.staff_activity_codes TO sfp_app;
GRANT SELECT ON app.staff_activity_codes TO sfp_auditor;
