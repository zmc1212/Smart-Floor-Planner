-- Actual progress drives configurable XiaoK reminders. Phone coordination has no booking lifecycle.
CREATE TABLE app.construction_stage_settings (
 enterprise_id bigint PRIMARY KEY REFERENCES app.enterprises(id),
 stages jsonb NOT NULL CHECK(jsonb_typeof(stages)='array' AND jsonb_array_length(stages) BETWEEN 1 AND 30),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.construction_stage_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_stage_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.construction_stage_settings
 USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_stage_settings TO sfp_app;
ALTER TABLE app.construction_projects
 ADD COLUMN current_stage_key text,
 ADD COLUMN stage_contacts jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(stage_contacts)='object'),
 ADD COLUMN progress_note text NOT NULL DEFAULT '' CHECK(length(progress_note)<=1000),
 ADD COLUMN progress_revision integer NOT NULL DEFAULT 0 CHECK(progress_revision>=0);
-- Applied migrations and historical records are retained; runtime visit/plan mutation routes are retired.
