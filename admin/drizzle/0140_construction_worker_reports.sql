-- Worker site reports: manual multi-stage snapshot and up to 9 original photos.
ALTER TABLE app.construction_site_records
 ADD COLUMN IF NOT EXISTS stage_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='app.construction_site_records'::regclass
    AND conname='construction_site_records_stage_snapshot_array'
 ) THEN
  ALTER TABLE app.construction_site_records
   ADD CONSTRAINT construction_site_records_stage_snapshot_array
   CHECK (jsonb_typeof(stage_snapshot)='array');
 END IF;
END $$;

ALTER TABLE app.construction_site_attachments
 DROP CONSTRAINT IF EXISTS construction_site_attachments_position_check;

DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='app.construction_site_attachments'::regclass
    AND conname='construction_site_attachments_position_check'
 ) THEN
  ALTER TABLE app.construction_site_attachments
   ADD CONSTRAINT construction_site_attachments_position_check
   CHECK (position BETWEEN 0 AND 8);
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS construction_site_records_author_history
 ON app.construction_site_records(enterprise_id,project_id,author_id,id DESC);
