CREATE TABLE "app"."lead_service_needs" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "lead_id" bigint NOT NULL REFERENCES "app"."leads"("id") ON DELETE cascade,
  "need_key" text NOT NULL,
  "source" text NOT NULL DEFAULT 'customer',
  "updated_by_user_id" bigint REFERENCES "app"."users"("id") ON DELETE set null,
  "updated_by_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "lead_service_needs_key_check" CHECK ("need_key" IN ('old_house_consultation', 'materials_consultation', 'partial_space_advice')),
  CONSTRAINT "lead_service_needs_source_check" CHECK ("source" IN ('customer', 'designer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_service_needs_lead_key_uidx"
  ON "app"."lead_service_needs" ("lead_id", "need_key");
--> statement-breakpoint
CREATE INDEX "lead_service_needs_enterprise_lead_idx"
  ON "app"."lead_service_needs" ("enterprise_id", "lead_id");
--> statement-breakpoint
ALTER TABLE "app"."lead_service_needs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."lead_service_needs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lead_service_needs_tenant_isolation"
  ON "app"."lead_service_needs"
  FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
CREATE POLICY "lead_service_needs_auditor_read_all"
  ON "app"."lead_service_needs"
  FOR SELECT TO sfp_auditor USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."lead_service_needs" TO sfp_app;
--> statement-breakpoint
GRANT SELECT ON "app"."lead_service_needs" TO sfp_auditor;
