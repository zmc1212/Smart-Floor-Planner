-- Business ownership and retention wrap the existing WVP recorder/index.
ALTER TABLE app.construction_camera_bindings ADD CONSTRAINT construction_binding_camera_identity UNIQUE(enterprise_id,project_id,id,camera_id);
CREATE TABLE app.construction_camera_recording_policies (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, binding_id bigint PRIMARY KEY, camera_id bigint NOT NULL,
 source_key uuid NOT NULL DEFAULT gen_random_uuid(), enabled boolean NOT NULL DEFAULT false,
 retention_days integer NOT NULL DEFAULT 3 CHECK(retention_days BETWEEN 1 AND 30), version integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','recording','stopped','error')),
 plan_id integer, stream_app text, stream_id text, started_at timestamptz, stopped_at timestamptz,
 imported_until timestamptz, last_segment_at timestamptz, last_error text, checked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,project_id,binding_id), UNIQUE(source_key),
 FOREIGN KEY(enterprise_id,project_id,binding_id,camera_id) REFERENCES app.construction_camera_bindings(enterprise_id,project_id,id,camera_id)
);
CREATE TABLE app.construction_recordings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, binding_id bigint NOT NULL,
 source_id integer NOT NULL CHECK(source_id>0), media_server_id text NOT NULL, stream_app text NOT NULL, stream_id text NOT NULL, file_path text NOT NULL,
 started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL, bytes bigint NOT NULL CHECK(bytes>0),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','deleting','deleted','missing')),
 deleted_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,project_id,id), UNIQUE(media_server_id,source_id), CHECK(ended_at>started_at),
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_recording_policies(enterprise_id,project_id,binding_id)
);
CREATE INDEX construction_recording_time ON app.construction_recordings(enterprise_id,project_id,started_at);
ALTER TABLE app.construction_camera_sessions ADD COLUMN recording_id bigint;
ALTER TABLE app.construction_camera_sessions ADD CONSTRAINT construction_camera_session_recording FOREIGN KEY(enterprise_id,project_id,recording_id) REFERENCES app.construction_recordings(enterprise_id,project_id,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_camera_recording_policies','construction_recordings'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
