CREATE TABLE "app"."ai_creation_batch_reference_assets" (
	"batch_id" bigint NOT NULL,
	"asset_id" bigint NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "ai_creation_batch_reference_assets_pkey" PRIMARY KEY("batch_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "app"."ai_creation_task_reference_assets" (
	"task_id" bigint NOT NULL,
	"asset_id" bigint NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "ai_creation_task_reference_assets_pkey" PRIMARY KEY("task_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batch_reference_assets" ADD CONSTRAINT "ai_creation_batch_reference_assets_batch_id_ai_creation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "app"."ai_creation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batch_reference_assets" ADD CONSTRAINT "ai_creation_batch_reference_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_task_reference_assets" ADD CONSTRAINT "ai_creation_task_reference_assets_task_id_ai_creation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."ai_creation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_creation_task_reference_assets" ADD CONSTRAINT "ai_creation_task_reference_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_creation_batch_reference_assets_position_uidx" ON "app"."ai_creation_batch_reference_assets" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "ai_creation_batch_reference_assets_asset_idx" ON "app"."ai_creation_batch_reference_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_creation_task_reference_assets_position_uidx" ON "app"."ai_creation_task_reference_assets" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "ai_creation_task_reference_assets_asset_idx" ON "app"."ai_creation_task_reference_assets" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batches" DROP COLUMN "reference_asset_ids";--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batches" DROP COLUMN "generation_ids";--> statement-breakpoint
ALTER TABLE "app"."ai_creation_tasks" DROP COLUMN "reference_asset_ids";
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batch_reference_assets"
  ADD CONSTRAINT "ai_creation_batch_reference_assets_position_check"
  CHECK ("position" >= 0);
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_task_reference_assets"
  ADD CONSTRAINT "ai_creation_task_reference_assets_position_check"
  CHECK ("position" >= 0);
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batch_reference_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_batch_reference_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_creation_batch_reference_assets_tenant_isolation"
ON "app"."ai_creation_batch_reference_assets"
FOR ALL TO sfp_app
USING (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.ai_creation_batches
    WHERE app.ai_creation_batches.id = batch_id
      AND app.ai_creation_batches.enterprise_id = (SELECT app.current_enterprise_id())
  )
)
WITH CHECK (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.ai_creation_batches
    WHERE app.ai_creation_batches.id = batch_id
      AND app.ai_creation_batches.enterprise_id = (SELECT app.current_enterprise_id())
  )
);
--> statement-breakpoint
CREATE POLICY "ai_creation_batch_reference_assets_auditor_read_all"
ON "app"."ai_creation_batch_reference_assets"
FOR SELECT TO sfp_auditor USING (true);
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_task_reference_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."ai_creation_task_reference_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_creation_task_reference_assets_tenant_isolation"
ON "app"."ai_creation_task_reference_assets"
FOR ALL TO sfp_app
USING (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.ai_creation_tasks
    WHERE app.ai_creation_tasks.id = task_id
      AND app.ai_creation_tasks.enterprise_id = (SELECT app.current_enterprise_id())
  )
)
WITH CHECK (
  (SELECT app.has_platform_access())
  OR EXISTS (
    SELECT 1
    FROM app.ai_creation_tasks
    WHERE app.ai_creation_tasks.id = task_id
      AND app.ai_creation_tasks.enterprise_id = (SELECT app.current_enterprise_id())
  )
);
--> statement-breakpoint
CREATE POLICY "ai_creation_task_reference_assets_auditor_read_all"
ON "app"."ai_creation_task_reference_assets"
FOR SELECT TO sfp_auditor USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
ON "app"."ai_creation_batch_reference_assets",
   "app"."ai_creation_task_reference_assets"
TO sfp_app;
--> statement-breakpoint
GRANT SELECT
ON "app"."ai_creation_batch_reference_assets",
   "app"."ai_creation_task_reference_assets"
TO sfp_auditor;
