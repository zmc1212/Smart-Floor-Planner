-- Owner-facing cover frames are captured on an interval by the camera gateway.
-- Default is one hour per enterprise; values are bounded so a sleeping 4G
-- camera is not woken continuously.
CREATE TABLE app.construction_camera_cover_defaults (
  enterprise_id bigint PRIMARY KEY,
  interval_hours integer NOT NULL CHECK (interval_hours BETWEEN 1 AND 24),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (enterprise_id) REFERENCES app.enterprises(id) ON DELETE CASCADE
);
ALTER TABLE app.construction_camera_cover_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_camera_cover_defaults FORCE ROW LEVEL SECURITY;
CREATE POLICY construction_camera_cover_defaults_tenant ON app.construction_camera_cover_defaults FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON app.construction_camera_cover_defaults TO sfp_app;
--> statement-breakpoint
-- Scheduled covers have no author. They are identified by the scheduler slot so
-- one binding claims an interval at most once, including after a failure.
ALTER TABLE app.construction_camera_snapshots
  DROP CONSTRAINT construction_camera_snapshot_principal,
  ADD CONSTRAINT construction_camera_snapshot_principal CHECK(
    (scheduled_live_version_id IS NULL AND scheduled_at IS NULL AND ((actor_id IS NOT NULL)::integer+(actor_user_id IS NOT NULL)::integer=1)) OR
    (scheduled_live_version_id IS NOT NULL AND scheduled_at IS NOT NULL AND actor_id IS NULL AND actor_user_id IS NULL) OR
    (scheduled_live_version_id IS NULL AND scheduled_at IS NOT NULL AND request_key='owner-cover' AND actor_id IS NULL AND actor_user_id IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX construction_camera_snapshot_owner_slot
  ON app.construction_camera_snapshots(enterprise_id,binding_id,scheduled_at)
  WHERE scheduled_live_version_id IS NULL AND scheduled_at IS NOT NULL;
