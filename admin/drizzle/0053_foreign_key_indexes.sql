CREATE INDEX IF NOT EXISTS "leads_finalized_by_idx"
  ON "app"."leads" ("finalized_by");
CREATE INDEX IF NOT EXISTS "leads_terminated_by_user_idx"
  ON "app"."leads" ("terminated_by_user_id");
CREATE INDEX IF NOT EXISTS "leads_terminated_by_referrer_membership_idx"
  ON "app"."leads" ("terminated_by_referrer_membership_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_site_photos_created_by_user_idx"
  ON "app"."lead_site_photos" ("created_by_user_id");
CREATE INDEX IF NOT EXISTS "lead_site_photos_created_by_staff_idx"
  ON "app"."lead_site_photos" ("created_by_staff_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_service_needs_updated_by_user_idx"
  ON "app"."lead_service_needs" ("updated_by_user_id");
CREATE INDEX IF NOT EXISTS "lead_service_needs_updated_by_staff_idx"
  ON "app"."lead_service_needs" ("updated_by_staff_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_lifecycle_events_actor_referrer_membership_idx"
  ON "app"."lead_lifecycle_events" ("actor_referrer_membership_id");
