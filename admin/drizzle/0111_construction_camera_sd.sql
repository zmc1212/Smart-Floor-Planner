-- SD is a remotely read device source, never a cloud-retention file.
ALTER TABLE app.construction_camera_recording_policies
 ADD COLUMN recording_mode text NOT NULL DEFAULT 'cloud' CHECK(recording_mode IN ('cloud','sd')),
 ADD COLUMN sd_activated_at timestamptz,
 ADD COLUMN sd_checked_at timestamptz,
 ADD COLUMN sd_last_error text,
 ADD CONSTRAINT construction_camera_sd_no_cloud_writer CHECK(recording_mode<>'sd' OR NOT enabled);
CREATE TABLE app.construction_camera_sd_windows (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 binding_id bigint NOT NULL, serial_hash text NOT NULL CHECK(serial_hash ~ '^[a-f0-9]{64}$'),
 business_from timestamptz NOT NULL, checked_at timestamptz NOT NULL,
 source_from timestamptz NOT NULL, source_to timestamptz NOT NULL,
 clock_min_ms integer NOT NULL, clock_max_ms integer NOT NULL,
 UNIQUE(enterprise_id,project_id,id), CHECK(source_to>=source_from), CHECK(checked_at>=business_from),
 CHECK(clock_min_ms BETWEEN -60000 AND 60000 AND clock_max_ms BETWEEN clock_min_ms AND 60000),
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_recording_policies(enterprise_id,project_id,binding_id)
);
CREATE INDEX construction_camera_sd_window_binding ON app.construction_camera_sd_windows(binding_id,id DESC);
CREATE TABLE app.construction_camera_sd_recordings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 binding_id bigint NOT NULL, window_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, UNIQUE(enterprise_id,project_id,id), UNIQUE(window_id,started_at,ended_at),
 CHECK(ended_at>started_at AND ended_at<=started_at+interval '5 minutes'),
 FOREIGN KEY(enterprise_id,project_id,window_id) REFERENCES app.construction_camera_sd_windows(enterprise_id,project_id,id),
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_recording_policies(enterprise_id,project_id,binding_id)
);
CREATE TABLE app.construction_camera_sd_playbacks (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 binding_id bigint NOT NULL, recording_id bigint NOT NULL,
 device_id text NOT NULL CHECK(device_id ~ '^[0-9]{20}$'), channel_id text NOT NULL CHECK(channel_id ~ '^[0-9]{20}$'),
 stream_app text NOT NULL CHECK(stream_app='rtp'), stream_id text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'starting' CHECK(state IN ('starting','active','stopping','stopped')),
 created_at timestamptz NOT NULL DEFAULT now(), stop_after timestamptz NOT NULL, stopped_at timestamptz,
 last_error text, UNIQUE(enterprise_id,project_id,id),
 FOREIGN KEY(enterprise_id,project_id,recording_id) REFERENCES app.construction_camera_sd_recordings(enterprise_id,project_id,id),
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_recording_policies(enterprise_id,project_id,binding_id)
);
ALTER TABLE app.construction_camera_sessions ADD COLUMN sd_playback_id bigint,
 ADD CONSTRAINT construction_camera_session_sd FOREIGN KEY(enterprise_id,project_id,sd_playback_id)
 REFERENCES app.construction_camera_sd_playbacks(enterprise_id,project_id,id),
 ADD CONSTRAINT construction_camera_session_source CHECK(recording_id IS NULL OR sd_playback_id IS NULL);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_camera_sd_windows','construction_camera_sd_recordings','construction_camera_sd_playbacks'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
