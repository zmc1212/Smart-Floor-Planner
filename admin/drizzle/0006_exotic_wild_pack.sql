ALTER TABLE "app"."devices" DROP CONSTRAINT "devices_assigned_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "app"."floor_plans_staff_idx";--> statement-breakpoint
DROP INDEX "app"."leads_enterprise_assignee_idx";--> statement-breakpoint
DROP INDEX "app"."leads_promoter_idx";--> statement-breakpoint
DROP INDEX "app"."measurements_operator_idx";--> statement-breakpoint
ALTER TABLE "app"."devices" ADD CONSTRAINT "devices_assigned_user_id_admin_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floor_plans_enterprise_updated_idx" ON "app"."floor_plans" USING btree ("enterprise_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "floor_plans_creator_updated_idx" ON "app"."floor_plans" USING btree ("creator_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "floor_plans_staff_updated_idx" ON "app"."floor_plans" USING btree ("staff_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "floor_plans_staff_status_completed_idx" ON "app"."floor_plans" USING btree ("staff_id","status","completed_at");--> statement-breakpoint
CREATE INDEX "floor_plans_external_source_idx" ON "app"."floor_plans" USING btree ("enterprise_id",("external_source" ->> 'provider'),("external_source" ->> 'externalId'));--> statement-breakpoint
CREATE INDEX "leads_enterprise_created_idx" ON "app"."leads" USING btree ("enterprise_id","created_at","id");--> statement-breakpoint
CREATE INDEX "leads_enterprise_source_created_idx" ON "app"."leads" USING btree ("enterprise_id","source","created_at");--> statement-breakpoint
CREATE INDEX "leads_enterprise_phone_idx" ON "app"."leads" USING btree ("enterprise_id","phone");--> statement-breakpoint
CREATE INDEX "leads_enterprise_assignee_created_idx" ON "app"."leads" USING btree ("enterprise_id","assigned_to","created_at");--> statement-breakpoint
CREATE INDEX "leads_promoter_created_idx" ON "app"."leads" USING btree ("promoter_id","created_at");--> statement-breakpoint
CREATE INDEX "measurements_operator_measured_idx" ON "app"."measurements" USING btree ("operator_id","measured_at");--> statement-breakpoint
CREATE INDEX "measurements_device_measured_idx" ON "app"."measurements" USING btree ("device_id","measured_at");