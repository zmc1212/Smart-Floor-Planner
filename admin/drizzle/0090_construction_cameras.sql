-- Private construction video. Recording/playback deliberately remain deferred.
CREATE TABLE app.construction_cameras (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 node_key text NOT NULL DEFAULT 'default' CHECK(node_key='default'), device_id text NOT NULL CHECK(device_id ~ '^[0-9]{20}$'),
 channel_id text NOT NULL CHECK(channel_id ~ '^[0-9]{20}$'), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 enabled boolean NOT NULL DEFAULT true, ptz_enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(node_key,device_id,channel_id)
);
CREATE TABLE app.construction_camera_bindings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, camera_id bigint NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 UNIQUE(enterprise_id,project_id,id), UNIQUE(enterprise_id,id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,camera_id) REFERENCES app.construction_cameras(enterprise_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX construction_camera_one_binding ON app.construction_camera_bindings(camera_id) WHERE ended_at IS NULL;
CREATE TABLE app.construction_camera_entries (
 enterprise_id bigint NOT NULL, token_hash text NOT NULL PRIMARY KEY, project_id bigint NOT NULL, actor jsonb NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE
);
CREATE TABLE app.construction_camera_sessions (
 enterprise_id bigint NOT NULL, token_hash text NOT NULL PRIMARY KEY, project_id bigint NOT NULL, actor jsonb NOT NULL,
 csrf_hash text NOT NULL, expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL,
 binding_id bigint, stream_app text, stream_id text, play_version integer NOT NULL DEFAULT 0, view_expires_at timestamptz, closed_at timestamptz,
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_bindings(enterprise_id,project_id,id)
);
CREATE INDEX construction_camera_session_expiry ON app.construction_camera_sessions(expires_at);
CREATE TABLE app.construction_camera_snapshots (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, binding_id bigint NOT NULL,
 actor_id bigint NOT NULL REFERENCES app.admin_users(id), request_key text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','failed')),
 data bytea, width integer, height integer, captured_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,project_id,actor_id,request_key),
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_bindings(enterprise_id,project_id,id) ON DELETE CASCADE,
 CHECK(state<>'ready' OR (data IS NOT NULL AND octet_length(data) BETWEEN 1 AND 4194304 AND width>0 AND height>0 AND captured_at IS NOT NULL))
);
CREATE TABLE app.construction_camera_controls (
 enterprise_id bigint NOT NULL, camera_id bigint NOT NULL PRIMARY KEY, session_hash text NOT NULL,
 sequence bigint NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, stop_required boolean NOT NULL DEFAULT true,
 FOREIGN KEY(enterprise_id,camera_id) REFERENCES app.construction_cameras(enterprise_id,id) ON DELETE CASCADE
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_cameras','construction_camera_bindings','construction_camera_entries','construction_camera_sessions','construction_camera_snapshots','construction_camera_controls'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
