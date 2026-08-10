CREATE TABLE "app"."device_user_bindings" (
	"device_id" bigint NOT NULL,
	"admin_user_id" bigint NOT NULL,
	"enterprise_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_user_bindings_pkey" PRIMARY KEY("device_id","admin_user_id")
);
--> statement-breakpoint
ALTER TABLE "app"."device_user_bindings" ADD CONSTRAINT "device_user_bindings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "app"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device_user_bindings" ADD CONSTRAINT "device_user_bindings_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "app"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device_user_bindings" ADD CONSTRAINT "device_user_bindings_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "app"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_user_bindings_admin_user_idx" ON "app"."device_user_bindings" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "device_user_bindings_enterprise_idx" ON "app"."device_user_bindings" USING btree ("enterprise_id");--> statement-breakpoint
INSERT INTO "app"."device_user_bindings" ("device_id", "admin_user_id", "enterprise_id")
SELECT "id", "assigned_user_id", "enterprise_id"
FROM "app"."devices"
WHERE "assigned_user_id" IS NOT NULL
ON CONFLICT ("device_id", "admin_user_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "app"."device_user_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."device_user_bindings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "device_user_bindings_tenant_isolation"
ON "app"."device_user_bindings"
FOR ALL TO sfp_app
USING (
  (SELECT app.has_platform_access())
  OR "enterprise_id" = (SELECT app.current_enterprise_id())
)
WITH CHECK (
  (SELECT app.has_platform_access())
  OR "enterprise_id" = (SELECT app.current_enterprise_id())
);--> statement-breakpoint
CREATE POLICY "device_user_bindings_auditor_read_all"
ON "app"."device_user_bindings"
FOR SELECT TO sfp_auditor
USING (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
ON "app"."device_user_bindings"
TO sfp_app;--> statement-breakpoint
GRANT SELECT
ON "app"."device_user_bindings"
TO sfp_auditor;
