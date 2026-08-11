CREATE INDEX "enterprise_role_capabilities_updated_by_idx" ON "app"."enterprise_role_capabilities" USING btree ("updated_by");
--> statement-breakpoint
CREATE INDEX "admin_user_capability_overrides_updated_by_idx" ON "app"."admin_user_capability_overrides" USING btree ("updated_by");
--> statement-breakpoint
CREATE INDEX "lead_lifecycle_events_actor_idx" ON "app"."lead_lifecycle_events" USING btree ("actor_id");
