ALTER TABLE "app"."admin_users"
  ADD COLUMN "lead_capacity_override" integer;
--> statement-breakpoint
ALTER TABLE "app"."admin_users"
  ADD CONSTRAINT "admin_users_lead_capacity_override_check"
  CHECK ("lead_capacity_override" IS NULL OR "lead_capacity_override" BETWEEN 1 AND 100000);
--> statement-breakpoint
CREATE TABLE "app"."enterprise_assignment_setting_versions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "claim_enabled" boolean NOT NULL DEFAULT false,
  "claim_duration_seconds" integer NOT NULL DEFAULT 60,
  "high_performance_traffic_percent" integer NOT NULL DEFAULT 70,
  "performance_rate_threshold_percent" integer NOT NULL DEFAULT 30,
  "performance_window_days" integer NOT NULL DEFAULT 180,
  "minimum_effective_samples" integer NOT NULL DEFAULT 10,
  "default_designer_capacity" integer NOT NULL DEFAULT 20,
  "created_by_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "enterprise_assignment_settings_claim_duration_check" CHECK ("claim_duration_seconds" BETWEEN 5 AND 3600),
  CONSTRAINT "enterprise_assignment_settings_high_traffic_check" CHECK ("high_performance_traffic_percent" BETWEEN 0 AND 100),
  CONSTRAINT "enterprise_assignment_settings_rate_check" CHECK ("performance_rate_threshold_percent" BETWEEN 0 AND 100),
  CONSTRAINT "enterprise_assignment_settings_window_check" CHECK ("performance_window_days" BETWEEN 1 AND 3650),
  CONSTRAINT "enterprise_assignment_settings_samples_check" CHECK ("minimum_effective_samples" BETWEEN 1 AND 100000),
  CONSTRAINT "enterprise_assignment_settings_capacity_check" CHECK ("default_designer_capacity" BETWEEN 1 AND 100000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_assignment_settings_version_uidx"
  ON "app"."enterprise_assignment_setting_versions" ("enterprise_id", "version");
CREATE INDEX "enterprise_assignment_settings_current_idx"
  ON "app"."enterprise_assignment_setting_versions" ("enterprise_id", "created_at", "id");
--> statement-breakpoint
INSERT INTO "app"."enterprise_assignment_setting_versions" ("enterprise_id", "version")
SELECT "id", 1 FROM "app"."enterprises";
--> statement-breakpoint
CREATE TABLE "app"."lead_claim_windows" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE cascade,
  "setting_version_id" bigint NOT NULL REFERENCES "app"."enterprise_assignment_setting_versions"("id") ON DELETE restrict,
  "status" text NOT NULL DEFAULT 'open',
  "opens_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "claimed_by_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "claimed_at" timestamptz,
  "claim_idempotency_key_hash" text,
  "resolved_at" timestamptz,
  "resolution_reason" text,
  "assignment_group" text,
  "rule_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "lead_claim_windows_status_check" CHECK ("status" IN ('open', 'claimed', 'auto_assigned', 'manually_assigned', 'cancelled', 'assignment_pending')),
  CONSTRAINT "lead_claim_windows_group_check" CHECK ("assignment_group" IS NULL OR "assignment_group" IN ('high', 'standard'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_claim_windows_lead_uidx" ON "app"."lead_claim_windows" ("lead_id");
CREATE UNIQUE INDEX "lead_claim_windows_idempotency_uidx"
  ON "app"."lead_claim_windows" ("enterprise_id", "claim_idempotency_key_hash")
  WHERE "claim_idempotency_key_hash" IS NOT NULL;
CREATE INDEX "lead_claim_windows_due_idx" ON "app"."lead_claim_windows" ("status", "expires_at", "id");
CREATE INDEX "lead_claim_windows_enterprise_status_idx" ON "app"."lead_claim_windows" ("enterprise_id", "status", "expires_at");
--> statement-breakpoint
CREATE TABLE "app"."lead_outcome_snapshots" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE cascade,
  "designer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "outcome" text NOT NULL,
  "performance_eligible" boolean NOT NULL DEFAULT true,
  "lost_reason" text,
  "note" text,
  "previous_lead_status" text NOT NULL,
  "outcome_at" timestamptz NOT NULL,
  "recorded_by_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "invalidated_at" timestamptz,
  "invalidated_by_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "invalidation_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "lead_outcome_snapshots_outcome_check" CHECK ("outcome" IN ('signed', 'lost'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_outcome_snapshots_active_lead_uidx"
  ON "app"."lead_outcome_snapshots" ("lead_id") WHERE "invalidated_at" IS NULL;
CREATE INDEX "lead_outcome_snapshots_performance_idx"
  ON "app"."lead_outcome_snapshots" ("enterprise_id", "designer_id", "outcome_at");
CREATE INDEX "lead_outcome_snapshots_lead_idx"
  ON "app"."lead_outcome_snapshots" ("lead_id", "created_at");
--> statement-breakpoint
INSERT INTO "app"."lead_outcome_snapshots" (
  "enterprise_id", "lead_id", "designer_id", "outcome", "previous_lead_status",
  "outcome_at", "recorded_by_staff_id"
)
SELECT
  "enterprise_id", "id", "assigned_to", 'signed',
  COALESCE("converted_from_status", 'designing'), COALESCE("converted_at", "updated_at"), "converted_by"
FROM "app"."leads"
WHERE "enterprise_id" IS NOT NULL
  AND "status" = 'converted'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE "app"."assignment_distribution_counters" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "setting_version_id" bigint NOT NULL REFERENCES "app"."enterprise_assignment_setting_versions"("id") ON DELETE cascade,
  "high_count" integer NOT NULL DEFAULT 0,
  "standard_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "assignment_distribution_counters_nonnegative_check" CHECK ("high_count" >= 0 AND "standard_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_distribution_counters_scope_uidx"
  ON "app"."assignment_distribution_counters" ("enterprise_id", "setting_version_id");
--> statement-breakpoint
ALTER TABLE "app"."lead_lifecycle_events" DROP CONSTRAINT "lead_lifecycle_events_action_check";
ALTER TABLE "app"."lead_lifecycle_events"
  ADD CONSTRAINT "lead_lifecycle_events_action_check"
  CHECK ("action" IN ('archived', 'restored', 'purged', 'converted', 'conversion_reverted', 'closed_lost', 'reopened'));
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'enterprise_assignment_setting_versions',
    'lead_claim_windows',
    'lead_outcome_snapshots',
    'assignment_distribution_counters'
  ]
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY auditor_read_all ON app.%I FOR SELECT TO sfp_auditor USING (true)',
      table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO sfp_app', table_name);
    EXECUTE format('GRANT SELECT ON app.%I TO sfp_auditor', table_name);
  END LOOP;
END
$$;
