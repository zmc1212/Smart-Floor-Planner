-- 0120: stable per-binding identity for verified SD windows.
-- 0 = written before the stable identity existed (legacy registration hash).
-- 1 = stable GB28181 binding identity (registerTimeStamp excluded).
-- The gateway rebases a binding's 0 rows once inside the existing
-- camera-sd-clock:<binding> advisory lock; no row is deleted or merged.
ALTER TABLE app.construction_camera_sd_windows
 ADD COLUMN identity_version smallint NOT NULL DEFAULT 0,
 ADD CONSTRAINT construction_camera_sd_identity_version_check
  CHECK(identity_version IN (0,1));
COMMENT ON COLUMN app.construction_camera_sd_windows.identity_version IS
 '0=legacy registration hash, 1=stable binding identity (registerTimeStamp excluded)';
