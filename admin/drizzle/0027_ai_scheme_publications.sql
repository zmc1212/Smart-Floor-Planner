ALTER TABLE "app"."ai_generation_publications"
  ADD COLUMN IF NOT EXISTS "workflow_id" bigint;
--> statement-breakpoint
ALTER TABLE "app"."ai_generation_publications"
  ADD COLUMN IF NOT EXISTS "scheme_title" text;
--> statement-breakpoint
ALTER TABLE "app"."ai_generation_publications"
  ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generation_publications_workflow_id_ai_workflows_id_fk'
  ) THEN
    ALTER TABLE "app"."ai_generation_publications"
      ADD CONSTRAINT "ai_generation_publications_workflow_id_ai_workflows_id_fk"
      FOREIGN KEY ("workflow_id") REFERENCES "app"."ai_workflows"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generation_publications_workflow_published_idx"
  ON "app"."ai_generation_publications" ("workflow_id", "published_at");
