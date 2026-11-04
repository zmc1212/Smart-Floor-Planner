ALTER TABLE app.construction_public_live_sessions
  ADD COLUMN first_segment_at timestamptz,
  ADD COLUMN played_at timestamptz,
  ADD CONSTRAINT public_live_playback_receipt CHECK(played_at IS NULL OR (audience='owner' AND first_segment_at IS NOT NULL AND played_at>=first_segment_at));

ALTER TABLE app.construction_camera_snapshots
  ADD COLUMN scheduled_live_version_id bigint REFERENCES app.construction_public_live_versions(id) ON DELETE CASCADE,
  ADD COLUMN scheduled_at timestamptz,
  DROP CONSTRAINT construction_camera_snapshot_principal,
  ADD CONSTRAINT construction_camera_snapshot_principal CHECK(
    (scheduled_live_version_id IS NULL AND scheduled_at IS NULL AND ((actor_id IS NOT NULL)::integer+(actor_user_id IS NOT NULL)::integer=1)) OR
    (scheduled_live_version_id IS NOT NULL AND scheduled_at IS NOT NULL AND actor_id IS NULL AND actor_user_id IS NULL));

CREATE UNIQUE INDEX construction_camera_snapshot_live_slot
  ON app.construction_camera_snapshots(enterprise_id,scheduled_live_version_id,scheduled_at)
  WHERE scheduled_live_version_id IS NOT NULL;
