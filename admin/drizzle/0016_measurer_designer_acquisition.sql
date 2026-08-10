ALTER TABLE "app"."admin_users" ADD COLUMN "wechat_id" text;
--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD COLUMN "wechat_qr_asset_id" bigint;
--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD CONSTRAINT "admin_users_wechat_qr_asset_id_media_assets_id_fk" FOREIGN KEY ("wechat_qr_asset_id") REFERENCES "app"."media_assets"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "app"."enterprises" ADD COLUMN "measurer_acquisition_fixed_commission" numeric(14,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "acquired_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "acquired_by" bigint;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_acquired_by_admin_users_id_fk" FOREIGN KEY ("acquired_by") REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE TABLE "app"."measurer_designer_bindings" (
  "measurer_id" bigint NOT NULL,
  "designer_id" bigint NOT NULL,
  "enterprise_id" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "measurer_designer_bindings_pkey" PRIMARY KEY("measurer_id")
);
--> statement-breakpoint
ALTER TABLE "app"."measurer_designer_bindings" ADD CONSTRAINT "measurer_designer_bindings_measurer_id_admin_users_id_fk" FOREIGN KEY ("measurer_id") REFERENCES "app"."admin_users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "app"."measurer_designer_bindings" ADD CONSTRAINT "measurer_designer_bindings_designer_id_admin_users_id_fk" FOREIGN KEY ("designer_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "app"."measurer_designer_bindings" ADD CONSTRAINT "measurer_designer_bindings_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "measurer_designer_bindings_designer_idx" ON "app"."measurer_designer_bindings" USING btree ("designer_id");
--> statement-breakpoint
CREATE INDEX "measurer_designer_bindings_enterprise_idx" ON "app"."measurer_designer_bindings" USING btree ("enterprise_id");
--> statement-breakpoint
CREATE TABLE "app"."lead_acquisition_commissions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "lead_id" bigint NOT NULL,
  "enterprise_id" bigint NOT NULL,
  "measurer_id" bigint NOT NULL,
  "designer_id" bigint NOT NULL,
  "commission_amount" numeric(14,2) NOT NULL,
  "status" text DEFAULT 'pending_settlement' NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "settled_at" timestamp with time zone,
  "settled_by" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lead_acquisition_commissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade,
  CONSTRAINT "lead_acquisition_commissions_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  CONSTRAINT "lead_acquisition_commissions_measurer_id_admin_users_id_fk" FOREIGN KEY ("measurer_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict,
  CONSTRAINT "lead_acquisition_commissions_designer_id_admin_users_id_fk" FOREIGN KEY ("designer_id") REFERENCES "app"."admin_users"("id") ON DELETE restrict,
  CONSTRAINT "lead_acquisition_commissions_settled_by_admin_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "app"."admin_users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_acquisition_commissions_lead_uidx" ON "app"."lead_acquisition_commissions" USING btree ("lead_id");
--> statement-breakpoint
CREATE INDEX "lead_acquisition_commissions_enterprise_status_idx" ON "app"."lead_acquisition_commissions" USING btree ("enterprise_id", "status");
--> statement-breakpoint
CREATE INDEX "lead_acquisition_commissions_measurer_status_idx" ON "app"."lead_acquisition_commissions" USING btree ("measurer_id", "status");
--> statement-breakpoint
CREATE TABLE "app"."staff_notifications" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "enterprise_id" bigint,
  "recipient_staff_id" bigint,
  "lead_id" bigint,
  "notification_type" text NOT NULL,
  "channel" text DEFAULT 'in_app' NOT NULL,
  "status" text DEFAULT 'unread' NOT NULL,
  "message" text,
  "error_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedupe_key" text,
  "read_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_notifications_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  CONSTRAINT "staff_notifications_recipient_staff_id_admin_users_id_fk" FOREIGN KEY ("recipient_staff_id") REFERENCES "app"."admin_users"("id") ON DELETE set null,
  CONSTRAINT "staff_notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_notifications_dedupe_uidx" ON "app"."staff_notifications" USING btree ("dedupe_key", "channel") WHERE "dedupe_key" is not null;
--> statement-breakpoint
CREATE INDEX "staff_notifications_recipient_created_idx" ON "app"."staff_notifications" USING btree ("recipient_staff_id", "created_at");
--> statement-breakpoint
CREATE INDEX "staff_notifications_lead_idx" ON "app"."staff_notifications" USING btree ("lead_id");
--> statement-breakpoint
ALTER TABLE "app"."measurer_designer_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."measurer_designer_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "measurer_designer_bindings_tenant_isolation" ON "app"."measurer_designer_bindings" FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."measurer_designer_bindings" TO sfp_app;
--> statement-breakpoint
ALTER TABLE "app"."lead_acquisition_commissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."lead_acquisition_commissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lead_acquisition_commissions_tenant_isolation" ON "app"."lead_acquisition_commissions" FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."lead_acquisition_commissions" TO sfp_app;
--> statement-breakpoint
ALTER TABLE "app"."staff_notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."staff_notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "staff_notifications_tenant_isolation" ON "app"."staff_notifications" FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."staff_notifications" TO sfp_app;
