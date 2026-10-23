-- Node metrics are platform-only; tenant policies carry their own public status.
CREATE TABLE app.construction_camera_storage_health (
 node_key text PRIMARY KEY CHECK(node_key='default'), media_server_id text NOT NULL,
 level text NOT NULL CHECK(level IN ('ok','warning','critical','blocked','unavailable')),
 blocked boolean NOT NULL, reason text,
 total_bytes bigint, available_bytes bigint, used_percent numeric(6,3),
 sampled_at timestamptz, checked_at timestamptz NOT NULL DEFAULT now(),
 CHECK(total_bytes IS NULL OR total_bytes>0),
 CHECK(available_bytes IS NULL OR available_bytes BETWEEN 0 AND total_bytes),
 CHECK(used_percent IS NULL OR used_percent BETWEEN 0 AND 100)
);
ALTER TABLE app.construction_camera_storage_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_camera_storage_health FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_scope ON app.construction_camera_storage_health
 USING(app.has_platform_access()) WITH CHECK(app.has_platform_access());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_camera_storage_health TO sfp_app;
ALTER TABLE app.construction_camera_recording_policies
 ADD COLUMN storage_level text NOT NULL DEFAULT 'unavailable'
 CHECK(storage_level IN ('ok','warning','critical','blocked','unavailable')),
 ADD COLUMN storage_checked_at timestamptz;
