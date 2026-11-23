ALTER TABLE app.construction_projects
  ADD COLUMN inspection_pin jsonb,
  ADD CONSTRAINT construction_inspection_pin_object CHECK (inspection_pin IS NULL OR jsonb_typeof(inspection_pin) = 'object');

ALTER TABLE app.construction_site_records
  ADD COLUMN inspection_checkpoint jsonb,
  ADD COLUMN inspection_suggestion jsonb,
  ADD COLUMN inspection_decision jsonb,
  ADD COLUMN inspection_receipt jsonb;

ALTER TABLE app.construction_site_record_versions
  DROP CONSTRAINT construction_site_record_versions_action_check,
  ADD CONSTRAINT construction_site_record_versions_action_check
    CHECK (action IN ('organized','edit','publish','withdraw','request_changes','resubmit','submitted','inspection_triage'));

CREATE INDEX construction_site_records_inspection
  ON app.construction_site_records (enterprise_id, project_id, id DESC)
  WHERE source_message_id IS NOT NULL;

-- The platform Key's capacity is shared across enterprises. Keep only usage counts.
CREATE TABLE app.construction_inspection_map_usage (
  config_key text NOT NULL,
  day date NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  second_bucket timestamptz NOT NULL DEFAULT date_trunc('second', now()),
  second_count integer NOT NULL DEFAULT 0 CHECK (second_count >= 0),
  PRIMARY KEY (config_key, day)
);
ALTER TABLE app.construction_inspection_map_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_inspection_map_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY construction_inspection_map_platform ON app.construction_inspection_map_usage
  USING (app.has_platform_access()) WITH CHECK (app.has_platform_access());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.construction_inspection_map_usage TO sfp_app;
