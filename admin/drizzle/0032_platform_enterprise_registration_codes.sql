CREATE TABLE "app"."platform_enterprise_registration_codes" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "token_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "version" integer NOT NULL DEFAULT 1,
  "expires_at" timestamptz,
  "created_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "disabled_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "disabled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_enterprise_registration_codes_status_check"
    CHECK ("status" IN ('active', 'rotated', 'disabled', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_enterprise_registration_codes_token_hash_uidx"
  ON "app"."platform_enterprise_registration_codes" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_enterprise_registration_codes_active_uidx"
  ON "app"."platform_enterprise_registration_codes" ("status")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "platform_enterprise_registration_codes_created_idx"
  ON "app"."platform_enterprise_registration_codes" ("created_at");
--> statement-breakpoint
CREATE INDEX "platform_enterprise_registration_codes_created_by_idx"
  ON "app"."platform_enterprise_registration_codes" ("created_by");
--> statement-breakpoint
CREATE INDEX "platform_enterprise_registration_codes_disabled_by_idx"
  ON "app"."platform_enterprise_registration_codes" ("disabled_by");
--> statement-breakpoint
CREATE TABLE "app"."platform_enterprise_registration_code_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "registration_code_id" bigint NOT NULL
    REFERENCES "app"."platform_enterprise_registration_codes"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "actor_user_id" bigint REFERENCES "app"."users"("id") ON DELETE set null,
  "actor_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "result" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "platform_enterprise_registration_code_events_created_idx"
  ON "app"."platform_enterprise_registration_code_events" ("created_at");
--> statement-breakpoint
CREATE INDEX "platform_enterprise_registration_code_events_code_idx"
  ON "app"."platform_enterprise_registration_code_events" ("registration_code_id");
--> statement-breakpoint
CREATE INDEX "platform_enterprise_registration_code_events_actor_user_idx"
  ON "app"."platform_enterprise_registration_code_events" ("actor_user_id");
--> statement-breakpoint
CREATE INDEX "platform_enterprise_registration_code_events_actor_staff_idx"
  ON "app"."platform_enterprise_registration_code_events" ("actor_staff_id");
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE app.platform_enterprise_registration_codes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.platform_enterprise_registration_codes FORCE ROW LEVEL SECURITY;
  CREATE POLICY platform_only ON app.platform_enterprise_registration_codes
    FOR ALL TO sfp_app
    USING ((SELECT app.has_platform_access()))
    WITH CHECK ((SELECT app.has_platform_access()));
  CREATE POLICY auditor_read_all ON app.platform_enterprise_registration_codes
    FOR SELECT TO sfp_auditor USING (true);

  ALTER TABLE app.platform_enterprise_registration_code_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.platform_enterprise_registration_code_events FORCE ROW LEVEL SECURITY;
  CREATE POLICY platform_only ON app.platform_enterprise_registration_code_events
    FOR ALL TO sfp_app
    USING ((SELECT app.has_platform_access()))
    WITH CHECK ((SELECT app.has_platform_access()));
  CREATE POLICY auditor_read_all ON app.platform_enterprise_registration_code_events
    FOR SELECT TO sfp_auditor USING (true);
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.platform_enterprise_registration_codes TO sfp_app;
GRANT SELECT ON app.platform_enterprise_registration_codes TO sfp_auditor;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.platform_enterprise_registration_code_events TO sfp_app;
GRANT SELECT ON app.platform_enterprise_registration_code_events TO sfp_auditor;
