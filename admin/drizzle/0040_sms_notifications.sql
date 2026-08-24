ALTER TABLE "app"."platform_configs"
  ADD COLUMN IF NOT EXISTS "sms_config" jsonb;
--> statement-breakpoint
UPDATE "app"."platform_configs"
SET "sms_config" = '{}'::jsonb
WHERE "sms_config" IS NULL;
--> statement-breakpoint
ALTER TABLE "app"."platform_configs"
  ALTER COLUMN "sms_config" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "sms_config" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE "app"."sms_delivery_logs" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "lead_id" bigint REFERENCES "app"."leads"("id") ON DELETE cascade,
  "recipient_staff_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "phone_encrypted" text,
  "phone_masked" text NOT NULL,
  "provider" text NOT NULL,
  "template_code" text NOT NULL,
  "sign_name" text NOT NULL,
  "message" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'lead_assignment',
  "status" text NOT NULL DEFAULT 'pending',
  "provider_message_id" text,
  "provider_request_id" text,
  "error_code" text,
  "error_message" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sms_delivery_logs_provider_check" CHECK ("provider" IN ('aliyun', 'tencent')),
  CONSTRAINT "sms_delivery_logs_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT "sms_delivery_logs_kind_check" CHECK ("kind" IN ('lead_assignment', 'test')),
  CONSTRAINT "sms_delivery_logs_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sms_delivery_logs_dedupe_uidx"
  ON "app"."sms_delivery_logs" ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "sms_delivery_logs_enterprise_status_created_idx"
  ON "app"."sms_delivery_logs" ("enterprise_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "sms_delivery_logs_recipient_created_idx"
  ON "app"."sms_delivery_logs" ("recipient_staff_id", "created_at");
--> statement-breakpoint
CREATE INDEX "sms_delivery_logs_lead_idx"
  ON "app"."sms_delivery_logs" ("lead_id");
--> statement-breakpoint
ALTER TABLE "app"."sms_delivery_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."sms_delivery_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sms_delivery_logs_tenant_isolation"
  ON "app"."sms_delivery_logs"
  FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR "enterprise_id" = (SELECT app.current_enterprise_id()));
--> statement-breakpoint
CREATE POLICY "sms_delivery_logs_auditor_read_all"
  ON "app"."sms_delivery_logs"
  FOR SELECT TO sfp_auditor USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."sms_delivery_logs" TO sfp_app;
--> statement-breakpoint
GRANT SELECT ON "app"."sms_delivery_logs" TO sfp_auditor;
