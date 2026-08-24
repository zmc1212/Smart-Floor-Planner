CREATE INDEX "enterprise_assignment_settings_created_by_staff_idx"
  ON "app"."enterprise_assignment_setting_versions" ("created_by_staff_id");
--> statement-breakpoint
CREATE INDEX "lead_claim_windows_setting_version_idx"
  ON "app"."lead_claim_windows" ("setting_version_id");
CREATE INDEX "lead_claim_windows_claimed_by_staff_idx"
  ON "app"."lead_claim_windows" ("claimed_by_staff_id");
--> statement-breakpoint
CREATE INDEX "lead_outcome_snapshots_recorded_by_staff_idx"
  ON "app"."lead_outcome_snapshots" ("recorded_by_staff_id");
CREATE INDEX "lead_outcome_snapshots_invalidated_by_staff_idx"
  ON "app"."lead_outcome_snapshots" ("invalidated_by_staff_id");
