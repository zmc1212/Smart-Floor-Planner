ALTER TABLE "app"."leads"
  ADD COLUMN IF NOT EXISTS "finalized_workflow_id" bigint;
--> statement-breakpoint
ALTER TABLE "app"."leads"
  ADD COLUMN IF NOT EXISTS "finalized_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "app"."leads"
  ADD COLUMN IF NOT EXISTS "finalized_by" bigint;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_finalized_workflow_id_ai_workflows_id_fk'
  ) THEN
    ALTER TABLE "app"."leads"
      ADD CONSTRAINT "leads_finalized_workflow_id_ai_workflows_id_fk"
      FOREIGN KEY ("finalized_workflow_id")
      REFERENCES "app"."ai_workflows"("id")
      ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_finalized_by_admin_users_id_fk'
  ) THEN
    ALTER TABLE "app"."leads"
      ADD CONSTRAINT "leads_finalized_by_admin_users_id_fk"
      FOREIGN KEY ("finalized_by")
      REFERENCES "app"."admin_users"("id")
      ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_finalized_workflow_idx"
  ON "app"."leads" ("finalized_workflow_id")
  WHERE "finalized_workflow_id" IS NOT NULL;
