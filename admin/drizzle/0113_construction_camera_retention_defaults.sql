-- Existing policies remain explicit overrides; migration never changes a writer or history.
CREATE TABLE app.construction_camera_retention_defaults (
 enterprise_id bigint PRIMARY KEY REFERENCES app.enterprises(id),
 retention_days integer NOT NULL DEFAULT 3 CHECK(retention_days BETWEEN 1 AND 30),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.construction_camera_retention_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_camera_retention_defaults FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.construction_camera_retention_defaults
 USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_camera_retention_defaults TO sfp_app;
ALTER TABLE app.construction_camera_recording_policies
 ADD COLUMN retention_override_days integer CHECK(retention_override_days BETWEEN 1 AND 30);
UPDATE app.construction_camera_recording_policies SET retention_override_days=retention_days;
