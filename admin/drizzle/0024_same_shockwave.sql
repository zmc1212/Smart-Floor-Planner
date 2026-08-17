CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "context_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD COLUMN "user_id" bigint;
--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD COLUMN "assignment_paused" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD COLUMN "last_assigned_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "app"."wechat_identities" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" bigint NOT NULL REFERENCES "app"."users"("id") ON DELETE cascade,
  "openid" text NOT NULL,
  "unionid" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_identities_user_uidx" ON "app"."wechat_identities" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_identities_openid_uidx" ON "app"."wechat_identities" ("openid");
--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_identities_unionid_uidx" ON "app"."wechat_identities" ("unionid") WHERE "unionid" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "app"."referrer_profiles" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" bigint NOT NULL REFERENCES "app"."users"("id") ON DELETE cascade,
  "display_name" text DEFAULT '' NOT NULL,
  "phone" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referrer_profiles_status_check" CHECK ("status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referrer_profiles_user_uidx" ON "app"."referrer_profiles" ("user_id");
--> statement-breakpoint
CREATE INDEX "referrer_profiles_status_created_idx" ON "app"."referrer_profiles" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "app"."enterprise_join_codes" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "code_type" text NOT NULL,
  "token_hash" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "expires_at" timestamp with time zone,
  "created_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "disabled_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_join_codes_type_check" CHECK ("code_type" IN ('staff', 'referrer')),
  CONSTRAINT "enterprise_join_codes_status_check" CHECK ("status" IN ('active', 'rotated', 'disabled', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_join_codes_token_hash_uidx" ON "app"."enterprise_join_codes" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_join_codes_active_type_uidx" ON "app"."enterprise_join_codes" ("enterprise_id", "code_type") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "enterprise_join_codes_enterprise_created_idx" ON "app"."enterprise_join_codes" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "enterprise_join_codes_created_by_idx" ON "app"."enterprise_join_codes" ("created_by");
--> statement-breakpoint
CREATE INDEX "enterprise_join_codes_disabled_by_idx" ON "app"."enterprise_join_codes" ("disabled_by");
--> statement-breakpoint
CREATE TABLE "app"."enterprise_join_code_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "join_code_id" bigint NOT NULL REFERENCES "app"."enterprise_join_codes"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "actor_user_id" bigint REFERENCES "app"."users"("id") ON DELETE set null,
  "actor_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "result" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "enterprise_join_code_events_enterprise_created_idx" ON "app"."enterprise_join_code_events" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "enterprise_join_code_events_join_code_idx" ON "app"."enterprise_join_code_events" ("join_code_id");
--> statement-breakpoint
CREATE INDEX "enterprise_join_code_events_actor_user_idx" ON "app"."enterprise_join_code_events" ("actor_user_id");
--> statement-breakpoint
CREATE INDEX "enterprise_join_code_events_actor_staff_idx" ON "app"."enterprise_join_code_events" ("actor_staff_id");
--> statement-breakpoint
CREATE TABLE "app"."referrer_enterprise_memberships" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "referrer_id" bigint NOT NULL REFERENCES "app"."referrer_profiles"("id") ON DELETE cascade,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "status" text DEFAULT 'active' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "exited_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referrer_memberships_status_check" CHECK ("status" IN ('active', 'exited', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referrer_memberships_active_enterprise_uidx" ON "app"."referrer_enterprise_memberships" ("referrer_id", "enterprise_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "referrer_memberships_enterprise_status_idx" ON "app"."referrer_enterprise_memberships" ("enterprise_id", "status");
--> statement-breakpoint
CREATE INDEX "referrer_memberships_referrer_status_idx" ON "app"."referrer_enterprise_memberships" ("referrer_id", "status");
--> statement-breakpoint
CREATE TABLE "app"."referrer_promotion_codes" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "membership_id" bigint NOT NULL REFERENCES "app"."referrer_enterprise_memberships"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referrer_promotion_codes_status_check" CHECK ("status" IN ('active', 'rotated', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referrer_promotion_codes_token_hash_uidx" ON "app"."referrer_promotion_codes" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "referrer_promotion_codes_active_membership_uidx" ON "app"."referrer_promotion_codes" ("membership_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "referrer_promotion_codes_enterprise_created_idx" ON "app"."referrer_promotion_codes" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE TABLE "app"."promotion_scan_audits" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "promotion_code_id" bigint REFERENCES "app"."referrer_promotion_codes"("id") ON DELETE set null,
  "token_hash" text NOT NULL,
  "session_key" text,
  "result" text NOT NULL,
  "ip_hash" text,
  "device_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "promotion_scan_audits_enterprise_created_idx" ON "app"."promotion_scan_audits" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "promotion_scan_audits_promotion_code_idx" ON "app"."promotion_scan_audits" ("promotion_code_id");
--> statement-breakpoint
CREATE INDEX "promotion_scan_audits_token_created_idx" ON "app"."promotion_scan_audits" ("token_hash", "created_at");
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "customer_user_id" bigint REFERENCES "app"."users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "referrer_membership_id" bigint REFERENCES "app"."referrer_enterprise_memberships"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "measurer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "attribution_locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "assignment_status" text DEFAULT 'not_requested' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "assignment_error_code" text;
--> statement-breakpoint
CREATE INDEX "leads_customer_user_idx" ON "app"."leads" ("customer_user_id");
--> statement-breakpoint
CREATE INDEX "leads_referrer_membership_idx" ON "app"."leads" ("referrer_membership_id");
--> statement-breakpoint
CREATE INDEX "leads_measurer_created_idx" ON "app"."leads" ("measurer_id", "created_at");
--> statement-breakpoint
CREATE INDEX "leads_enterprise_assignment_status_idx" ON "app"."leads" ("enterprise_id", "assignment_status", "created_at");
--> statement-breakpoint
CREATE TABLE "app"."customer_attribution_locks" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "customer_user_id" bigint NOT NULL REFERENCES "app"."users"("id") ON DELETE restrict,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE restrict,
  "referrer_membership_id" bigint REFERENCES "app"."referrer_enterprise_memberships"("id") ON DELETE restrict,
  "locked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "released_at" timestamp with time zone,
  "release_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_attribution_locks_active_user_uidx" ON "app"."customer_attribution_locks" ("customer_user_id") WHERE "released_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_attribution_locks_active_lead_uidx" ON "app"."customer_attribution_locks" ("lead_id") WHERE "released_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "customer_attribution_locks_enterprise_created_idx" ON "app"."customer_attribution_locks" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "customer_attribution_locks_referrer_idx" ON "app"."customer_attribution_locks" ("referrer_membership_id");
--> statement-breakpoint
CREATE TABLE "app"."lead_assignment_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "previous_designer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "designer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "previous_measurer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "measurer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "actor_user_id" bigint REFERENCES "app"."users"("id") ON DELETE set null,
  "error_code" text,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lead_assignment_events_enterprise_created_idx" ON "app"."lead_assignment_events" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "lead_assignment_events_lead_created_idx" ON "app"."lead_assignment_events" ("lead_id", "created_at");
--> statement-breakpoint
CREATE INDEX "lead_assignment_events_previous_designer_idx" ON "app"."lead_assignment_events" ("previous_designer_id");
--> statement-breakpoint
CREATE INDEX "lead_assignment_events_designer_idx" ON "app"."lead_assignment_events" ("designer_id");
--> statement-breakpoint
CREATE INDEX "lead_assignment_events_previous_measurer_idx" ON "app"."lead_assignment_events" ("previous_measurer_id");
--> statement-breakpoint
CREATE INDEX "lead_assignment_events_measurer_idx" ON "app"."lead_assignment_events" ("measurer_id");
--> statement-breakpoint
CREATE INDEX "lead_assignment_events_actor_user_idx" ON "app"."lead_assignment_events" ("actor_user_id");
--> statement-breakpoint
CREATE TABLE "app"."enterprise_appointment_settings" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
  "weekly_schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "default_duration_minutes" integer DEFAULT 120 NOT NULL,
  "slot_step_minutes" integer DEFAULT 30 NOT NULL,
  "max_advance_days" integer DEFAULT 30 NOT NULL,
  "customer_reschedule_cutoff_hours" integer DEFAULT 2 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_appointment_duration_check" CHECK ("default_duration_minutes" > 0),
  CONSTRAINT "enterprise_appointment_step_check" CHECK ("slot_step_minutes" > 0),
  CONSTRAINT "enterprise_appointment_advance_check" CHECK ("max_advance_days" > 0),
  CONSTRAINT "enterprise_appointment_cutoff_check" CHECK ("customer_reschedule_cutoff_hours" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_appointment_settings_enterprise_uidx" ON "app"."enterprise_appointment_settings" ("enterprise_id");
--> statement-breakpoint
CREATE TABLE "app"."staff_unavailability_periods" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "staff_id" bigint NOT NULL REFERENCES "app"."admin_users"("id") ON DELETE cascade,
  "time_range" tstzrange NOT NULL,
  "reason" text,
  "created_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "staff_unavailability_enterprise_range_idx" ON "app"."staff_unavailability_periods" ("enterprise_id", "time_range");
--> statement-breakpoint
CREATE INDEX "staff_unavailability_created_by_idx" ON "app"."staff_unavailability_periods" ("created_by");
--> statement-breakpoint
CREATE INDEX "staff_unavailability_staff_range_idx" ON "app"."staff_unavailability_periods" USING gist ("staff_id", "time_range");
--> statement-breakpoint
CREATE TABLE "app"."measurement_appointments" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE restrict,
  "designer_id" bigint NOT NULL REFERENCES "app"."admin_users"("id") ON DELETE restrict,
  "measurer_id" bigint NOT NULL REFERENCES "app"."admin_users"("id") ON DELETE restrict,
  "address" text NOT NULL,
  "time_range" tstzrange NOT NULL,
  "status" text DEFAULT 'confirmed' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_user_id" bigint REFERENCES "app"."users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "measurement_appointments_status_check" CHECK ("status" IN ('confirmed', 'cancelled', 'completed')),
  CONSTRAINT "measurement_appointments_version_check" CHECK ("version" > 0),
  CONSTRAINT "measurement_appointments_measurer_time_excl" EXCLUDE USING gist ("measurer_id" WITH =, "time_range" WITH &&) WHERE ("status" = 'confirmed')
);
--> statement-breakpoint
CREATE INDEX "measurement_appointments_enterprise_range_idx" ON "app"."measurement_appointments" ("enterprise_id", "time_range");
--> statement-breakpoint
CREATE INDEX "measurement_appointments_lead_created_idx" ON "app"."measurement_appointments" ("lead_id", "created_at");
--> statement-breakpoint
CREATE INDEX "measurement_appointments_designer_range_idx" ON "app"."measurement_appointments" ("designer_id", "time_range");
--> statement-breakpoint
CREATE INDEX "measurement_appointments_measurer_range_idx" ON "app"."measurement_appointments" ("measurer_id", "time_range");
--> statement-breakpoint
CREATE INDEX "measurement_appointments_updated_by_user_idx" ON "app"."measurement_appointments" ("updated_by_user_id");
--> statement-breakpoint
CREATE TABLE "app"."measurement_appointment_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "appointment_id" bigint NOT NULL REFERENCES "app"."measurement_appointments"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "previous_time_range" tstzrange,
  "time_range" tstzrange,
  "previous_measurer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "measurer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "actor_user_id" bigint REFERENCES "app"."users"("id") ON DELETE set null,
  "reason" text,
  "event_key" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_appointment_events_key_uidx" ON "app"."measurement_appointment_events" ("event_key");
--> statement-breakpoint
CREATE INDEX "measurement_appointment_events_enterprise_created_idx" ON "app"."measurement_appointment_events" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "measurement_appointment_events_appointment_created_idx" ON "app"."measurement_appointment_events" ("appointment_id", "created_at");
--> statement-breakpoint
CREATE INDEX "measurement_appointment_events_previous_measurer_idx" ON "app"."measurement_appointment_events" ("previous_measurer_id");
--> statement-breakpoint
CREATE INDEX "measurement_appointment_events_measurer_idx" ON "app"."measurement_appointment_events" ("measurer_id");
--> statement-breakpoint
CREATE INDEX "measurement_appointment_events_actor_user_idx" ON "app"."measurement_appointment_events" ("actor_user_id");
--> statement-breakpoint
CREATE TABLE "app"."enterprise_commission_rules" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "calculation_type" text NOT NULL,
  "value" numeric(14,4) NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "updated_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_commission_rules_role_check" CHECK ("role" IN ('referrer', 'designer', 'measurer')),
  CONSTRAINT "enterprise_commission_rules_type_check" CHECK ("calculation_type" IN ('fixed', 'percentage')),
  CONSTRAINT "enterprise_commission_rules_status_check" CHECK ("status" IN ('active', 'disabled')),
  CONSTRAINT "enterprise_commission_rules_value_check" CHECK ("value" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_commission_rules_enterprise_role_uidx" ON "app"."enterprise_commission_rules" ("enterprise_id", "role");
--> statement-breakpoint
CREATE INDEX "enterprise_commission_rules_created_by_idx" ON "app"."enterprise_commission_rules" ("created_by");
--> statement-breakpoint
CREATE INDEX "enterprise_commission_rules_updated_by_idx" ON "app"."enterprise_commission_rules" ("updated_by");
--> statement-breakpoint
CREATE TABLE "app"."lead_commissions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE restrict,
  "role" text NOT NULL,
  "beneficiary_user_id" bigint NOT NULL REFERENCES "app"."users"("id") ON DELETE restrict,
  "rule_type" text NOT NULL,
  "rule_value" numeric(14,4) NOT NULL,
  "rule_version" integer NOT NULL,
  "contract_amount" numeric(14,2),
  "payable_amount" numeric(14,2) NOT NULL,
  "status" text DEFAULT 'payable' NOT NULL,
  "paid_at" timestamp with time zone,
  "paid_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "voided_at" timestamp with time zone,
  "voided_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "void_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lead_commissions_role_check" CHECK ("role" IN ('referrer', 'designer', 'measurer')),
  CONSTRAINT "lead_commissions_rule_type_check" CHECK ("rule_type" IN ('fixed', 'percentage')),
  CONSTRAINT "lead_commissions_status_check" CHECK ("status" IN ('payable', 'paid', 'voided')),
  CONSTRAINT "lead_commissions_amount_check" CHECK ("payable_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_commissions_lead_role_uidx" ON "app"."lead_commissions" ("lead_id", "role");
--> statement-breakpoint
CREATE INDEX "lead_commissions_enterprise_status_idx" ON "app"."lead_commissions" ("enterprise_id", "status");
--> statement-breakpoint
CREATE INDEX "lead_commissions_beneficiary_status_idx" ON "app"."lead_commissions" ("beneficiary_user_id", "status");
--> statement-breakpoint
CREATE INDEX "lead_commissions_paid_by_idx" ON "app"."lead_commissions" ("paid_by");
--> statement-breakpoint
CREATE INDEX "lead_commissions_voided_by_idx" ON "app"."lead_commissions" ("voided_by");
--> statement-breakpoint
CREATE TABLE "app"."ai_generation_publications" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE cascade,
  "generation_id" bigint NOT NULL REFERENCES "app"."ai_generations"("id") ON DELETE restrict,
  "published_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_by" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "withdrawn_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_generation_publications_active_generation_uidx" ON "app"."ai_generation_publications" ("generation_id") WHERE "withdrawn_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "ai_generation_publications_enterprise_created_idx" ON "app"."ai_generation_publications" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ai_generation_publications_lead_published_idx" ON "app"."ai_generation_publications" ("lead_id", "published_at");
--> statement-breakpoint
CREATE INDEX "ai_generation_publications_published_by_idx" ON "app"."ai_generation_publications" ("published_by");
--> statement-breakpoint
CREATE INDEX "ai_generation_publications_withdrawn_by_idx" ON "app"."ai_generation_publications" ("withdrawn_by");
--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD CONSTRAINT "admin_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_user_uidx" ON "app"."admin_users" ("user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "app"."wechat_identities" ("user_id", "openid")
SELECT "id", "openid" FROM "app"."users" WHERE "openid" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "app"."admin_users" AS staff
SET "user_id" = (
  SELECT candidate."id"
  FROM "app"."users" AS candidate
  WHERE (staff."openid" IS NOT NULL AND candidate."openid" = staff."openid")
     OR (staff."phone" IS NOT NULL AND candidate."phone" = staff."phone")
  ORDER BY CASE WHEN candidate."openid" = staff."openid" THEN 0 ELSE 1 END, candidate."id"
  LIMIT 1
)
WHERE staff."user_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "app"."users" AS candidate
    WHERE (staff."openid" IS NOT NULL AND candidate."openid" = staff."openid")
       OR (staff."phone" IS NOT NULL AND candidate."phone" = staff."phone")
  );
--> statement-breakpoint
INSERT INTO "app"."wechat_identities" ("user_id", "openid")
SELECT staff."user_id", staff."openid"
FROM "app"."admin_users" AS staff
WHERE staff."user_id" IS NOT NULL AND staff."openid" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'enterprise_join_codes', 'enterprise_join_code_events',
    'referrer_enterprise_memberships', 'referrer_promotion_codes',
    'promotion_scan_audits', 'customer_attribution_locks',
    'lead_assignment_events', 'enterprise_appointment_settings',
    'staff_unavailability_periods', 'measurement_appointments',
    'measurement_appointment_events', 'enterprise_commission_rules',
    'lead_commissions', 'ai_generation_publications'
  ]
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I FOR ALL TO sfp_app '
      'USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id())) '
      'WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY auditor_read_all ON app.%I FOR SELECT TO sfp_auditor USING (true)',
      table_name
    );
  END LOOP;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "app" TO sfp_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "app" TO sfp_app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "app" TO sfp_auditor;
