ALTER TABLE "app"."floor_plans"
  ADD COLUMN IF NOT EXISTS "preview_asset_id" bigint;
--> statement-breakpoint
ALTER TABLE "app"."floor_plans"
  ADD COLUMN IF NOT EXISTS "preview_render_revision" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'floor_plans_preview_asset_id_media_assets_id_fk'
  ) THEN
    ALTER TABLE "app"."floor_plans"
      ADD CONSTRAINT "floor_plans_preview_asset_id_media_assets_id_fk"
      FOREIGN KEY ("preview_asset_id") REFERENCES "app"."media_assets"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "floor_plans_preview_asset_idx"
  ON "app"."floor_plans" ("preview_asset_id");
