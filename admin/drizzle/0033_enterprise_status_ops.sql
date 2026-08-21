ALTER TABLE "app"."enterprises"
  ADD COLUMN IF NOT EXISTS "status_reason" text;
--> statement-breakpoint
ALTER TABLE "app"."enterprises"
  ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "app"."enterprises"
  ADD COLUMN IF NOT EXISTS "status_changed_by_admin_id" bigint;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enterprises_status_changed_by_admin_id_admin_users_id_fk'
  ) THEN
    ALTER TABLE "app"."enterprises"
      ADD CONSTRAINT "enterprises_status_changed_by_admin_id_admin_users_id_fk"
      FOREIGN KEY ("status_changed_by_admin_id")
      REFERENCES "app"."admin_users"("id")
      ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enterprises_status_check'
  ) THEN
    ALTER TABLE "app"."enterprises"
      ADD CONSTRAINT "enterprises_status_check"
      CHECK ("status" IN ('pending_approval', 'active', 'disabled', 'rejected'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprises_status_changed_by_idx"
  ON "app"."enterprises" ("status_changed_by_admin_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."enterprise_status_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL
    REFERENCES "app"."enterprises"("id") ON DELETE cascade,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "action" text NOT NULL,
  "reason" text,
  "actor_admin_id" bigint
    REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "enterprise_status_events_action_check"
    CHECK ("action" IN ('approve', 'reject', 'disable', 'enable', 'resubmit_review'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_status_events_enterprise_created_idx"
  ON "app"."enterprise_status_events" ("enterprise_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_status_events_actor_idx"
  ON "app"."enterprise_status_events" ("actor_admin_id");
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE app.enterprise_status_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.enterprise_status_events FORCE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'app'
      AND tablename = 'enterprise_status_events'
      AND policyname = 'enterprise_status_events_tenant_isolation'
  ) THEN
    CREATE POLICY enterprise_status_events_tenant_isolation
      ON app.enterprise_status_events
      FOR ALL TO sfp_app
      USING (
        (SELECT app.has_platform_access())
        OR enterprise_id = (SELECT app.current_enterprise_id())
      )
      WITH CHECK (
        (SELECT app.has_platform_access())
        OR enterprise_id = (SELECT app.current_enterprise_id())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'app'
      AND tablename = 'enterprise_status_events'
      AND policyname = 'auditor_read_all'
  ) THEN
    CREATE POLICY auditor_read_all
      ON app.enterprise_status_events
      FOR SELECT TO sfp_auditor
      USING (true);
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.enterprise_status_events TO sfp_app;
GRANT SELECT ON app.enterprise_status_events TO sfp_auditor;
