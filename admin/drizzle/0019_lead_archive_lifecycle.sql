ALTER TABLE "app"."leads" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "archived_by" bigint;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "archive_reason" text;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "archive_note" text;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_archived_by_admin_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_archive_reason_check" CHECK (
  "archive_reason" IS NULL OR "archive_reason" IN (
    'no_intent',
    'lost_contact',
    'invalid_contact',
    'duplicate',
    'mistaken_entry',
    'other'
  )
);
--> statement-breakpoint
CREATE INDEX "leads_archived_by_idx" ON "app"."leads" USING btree ("archived_by");
--> statement-breakpoint
CREATE INDEX "leads_enterprise_archived_created_idx" ON "app"."leads" USING btree ("enterprise_id", "archived_at", "created_at", "id");
--> statement-breakpoint
CREATE TABLE "app"."enterprise_role_capabilities" (
  "enterprise_id" bigint NOT NULL,
  "role_key" text NOT NULL,
  "capability_key" text NOT NULL,
  "allowed" boolean DEFAULT false NOT NULL,
  "updated_by" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_role_capabilities_pkey" PRIMARY KEY ("enterprise_id", "role_key", "capability_key"),
  CONSTRAINT "enterprise_role_capabilities_role_check" CHECK ("role_key" IN ('designer', 'measurer'))
);
--> statement-breakpoint
CREATE TABLE "app"."admin_user_capability_overrides" (
  "enterprise_id" bigint NOT NULL,
  "admin_user_id" bigint NOT NULL,
  "capability_key" text NOT NULL,
  "allowed" boolean NOT NULL,
  "updated_by" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_user_capability_overrides_pkey" PRIMARY KEY ("admin_user_id", "capability_key")
);
--> statement-breakpoint
CREATE TABLE "app"."lead_lifecycle_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL,
  "lead_record_id" bigint NOT NULL,
  "actor_id" bigint,
  "action" text NOT NULL,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lead_lifecycle_events_action_check" CHECK ("action" IN ('archived', 'restored', 'purged'))
);
--> statement-breakpoint
ALTER TABLE "app"."enterprise_role_capabilities" ADD CONSTRAINT "enterprise_role_capabilities_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "app"."enterprise_role_capabilities" ADD CONSTRAINT "enterprise_role_capabilities_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "app"."admin_user_capability_overrides" ADD CONSTRAINT "admin_user_capability_overrides_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "app"."admin_user_capability_overrides" ADD CONSTRAINT "admin_user_capability_overrides_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "app"."admin_users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "app"."admin_user_capability_overrides" ADD CONSTRAINT "admin_user_capability_overrides_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "app"."lead_lifecycle_events" ADD CONSTRAINT "lead_lifecycle_events_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "app"."lead_lifecycle_events" ADD CONSTRAINT "lead_lifecycle_events_actor_id_admin_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "enterprise_role_capabilities_lookup_idx" ON "app"."enterprise_role_capabilities" USING btree ("enterprise_id", "capability_key");
--> statement-breakpoint
CREATE INDEX "admin_user_capability_overrides_lookup_idx" ON "app"."admin_user_capability_overrides" USING btree ("enterprise_id", "capability_key");
--> statement-breakpoint
CREATE INDEX "lead_lifecycle_events_enterprise_created_idx" ON "app"."lead_lifecycle_events" USING btree ("enterprise_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "lead_lifecycle_events_lead_idx" ON "app"."lead_lifecycle_events" USING btree ("enterprise_id", "lead_record_id", "created_at");
--> statement-breakpoint
ALTER TABLE "app"."enterprise_role_capabilities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."enterprise_role_capabilities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "enterprise_role_capabilities_tenant_isolation" ON "app"."enterprise_role_capabilities" FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
ALTER TABLE "app"."admin_user_capability_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."admin_user_capability_overrides" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "admin_user_capability_overrides_tenant_isolation" ON "app"."admin_user_capability_overrides" FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
ALTER TABLE "app"."lead_lifecycle_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."lead_lifecycle_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lead_lifecycle_events_tenant_isolation" ON "app"."lead_lifecycle_events" FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."enterprise_role_capabilities" TO sfp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."admin_user_capability_overrides" TO sfp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "app"."lead_lifecycle_events" TO sfp_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "app"."lead_lifecycle_events_id_seq" TO sfp_app;
