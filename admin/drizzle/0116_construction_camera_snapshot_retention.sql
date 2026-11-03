ALTER TABLE app.construction_camera_snapshots DROP CONSTRAINT construction_camera_snapshots_state_check;
ALTER TABLE app.construction_camera_snapshots ADD CONSTRAINT construction_camera_snapshots_state_check
 CHECK(state IN ('pending','ready','failed','expired'));
ALTER TABLE app.construction_camera_snapshots ADD CONSTRAINT construction_camera_snapshot_expired_bytes
 CHECK(state<>'expired' OR data IS NULL);
CREATE INDEX construction_camera_snapshot_retention
 ON app.construction_camera_snapshots(captured_at,id) WHERE state='ready';
