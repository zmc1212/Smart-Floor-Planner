-- Keep each owned recording interval across stop/restart and index late files.
CREATE TABLE app.construction_camera_recording_periods (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, binding_id bigint NOT NULL,
 started_at timestamptz NOT NULL, ended_at timestamptz,
 CHECK(ended_at IS NULL OR ended_at>=started_at),
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_recording_policies(enterprise_id,project_id,binding_id)
);
CREATE UNIQUE INDEX construction_recording_period_open ON app.construction_camera_recording_periods(binding_id) WHERE ended_at IS NULL;
CREATE INDEX construction_recording_period_time ON app.construction_camera_recording_periods(enterprise_id,binding_id,started_at);
INSERT INTO app.construction_camera_recording_periods(enterprise_id,project_id,binding_id,started_at,ended_at)
 SELECT enterprise_id,project_id,binding_id,date_trunc('second',started_at),
 CASE WHEN state='stopped' THEN greatest(started_at,coalesce(stopped_at,checked_at,now())) END
 FROM app.construction_camera_recording_policies WHERE started_at IS NOT NULL;
ALTER TABLE app.construction_camera_recording_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_camera_recording_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.construction_camera_recording_periods
 USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_camera_recording_periods TO sfp_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
ALTER TABLE app.construction_camera_recording_policies
 ADD COLUMN scan_from timestamptz, ADD COLUMN scan_to timestamptz,
 ADD COLUMN scan_page integer NOT NULL DEFAULT 1 CHECK(scan_page>0),
 ADD COLUMN index_swept_at timestamptz;
-- The incremental cursor now follows source start_time, the provider's sort key.
UPDATE app.construction_camera_recording_policies SET imported_until=NULL;
