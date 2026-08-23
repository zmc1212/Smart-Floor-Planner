CREATE TABLE IF NOT EXISTS "app"."lead_site_photos" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "enterprise_id" bigint NOT NULL
    REFERENCES "app"."enterprises"("id") ON DELETE restrict,
  "lead_id" bigint NOT NULL
    REFERENCES "app"."leads"("id") ON DELETE restrict,
  "asset_id" bigint NOT NULL
    REFERENCES "app"."media_assets"("id") ON DELETE restrict,
  "space_tag" text NOT NULL,
  "source" text NOT NULL DEFAULT 'album',
  "created_by_user_id" bigint
    REFERENCES "app"."users"("id") ON DELETE set null,
  "created_by_staff_id" bigint
    REFERENCES "app"."admin_users"("id") ON DELETE set null,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "lead_site_photos_source_check"
    CHECK ("source" IN ('camera', 'album', 'ai_picker')),
  CONSTRAINT "lead_site_photos_space_tag_check"
    CHECK (
      "space_tag" IN (
        'living_room',
        'master_bedroom',
        'secondary_bedroom',
        'master_bathroom',
        'secondary_bathroom',
        'kitchen',
        'dining_room',
        'balcony',
        'study',
        'other'
      )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_site_photos_asset_uidx"
  ON "app"."lead_site_photos" ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_site_photos_lead_created_idx"
  ON "app"."lead_site_photos" ("enterprise_id", "lead_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_site_photos_lead_active_idx"
  ON "app"."lead_site_photos" ("lead_id", "created_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE app.lead_site_photos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.lead_site_photos FORCE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'app'
      AND tablename = 'lead_site_photos'
      AND policyname = 'lead_site_photos_tenant_isolation'
  ) THEN
    CREATE POLICY lead_site_photos_tenant_isolation
      ON app.lead_site_photos
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
      AND tablename = 'lead_site_photos'
      AND policyname = 'auditor_read_all'
  ) THEN
    CREATE POLICY auditor_read_all
      ON app.lead_site_photos
      FOR SELECT TO sfp_auditor
      USING (true);
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.lead_site_photos TO sfp_app;
GRANT SELECT ON app.lead_site_photos TO sfp_auditor;
