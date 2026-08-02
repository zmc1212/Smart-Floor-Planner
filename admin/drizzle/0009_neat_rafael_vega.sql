DROP INDEX "app"."workflow_notification_logs_dedupe_uidx";--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "claim_status" text;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "claim_requested_by" bigint;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "claim_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "claim_reviewed_by" bigint;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "claim_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "claim_reject_reason" text;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_task_status" text DEFAULT 'unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_assigned_to" bigint;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_last_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "measure_result_summary" text;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "design_task_status" text DEFAULT 'unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "design_assigned_to" bigint;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "design_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "design_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "design_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "design_last_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "design_latest_note" text;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "conflict_reason" text;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "conflicting_record_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "conflict_reviewed_by" bigint;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "conflict_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD COLUMN "conflict_resolution" text;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD CONSTRAINT "promotion_enterprise_records_claim_requested_by_admin_users_id_fk" FOREIGN KEY ("claim_requested_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD CONSTRAINT "promotion_enterprise_records_claim_reviewed_by_admin_users_id_fk" FOREIGN KEY ("claim_reviewed_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD CONSTRAINT "promotion_enterprise_records_measure_assigned_to_admin_users_id_fk" FOREIGN KEY ("measure_assigned_to") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD CONSTRAINT "promotion_enterprise_records_design_assigned_to_admin_users_id_fk" FOREIGN KEY ("design_assigned_to") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_enterprise_records" ADD CONSTRAINT "promotion_enterprise_records_conflict_reviewed_by_admin_users_id_fk" FOREIGN KEY ("conflict_reviewed_by") REFERENCES "app"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotion_records_measure_assignee_created_idx" ON "app"."promotion_enterprise_records" USING btree ("measure_assigned_to","created_at");--> statement-breakpoint
CREATE INDEX "promotion_records_design_assignee_created_idx" ON "app"."promotion_enterprise_records" USING btree ("design_assigned_to","created_at");--> statement-breakpoint
CREATE INDEX "promotion_records_claim_request_idx" ON "app"."promotion_enterprise_records" USING btree ("claim_requested_by","claim_requested_at") WHERE "app"."promotion_enterprise_records"."claim_status" = 'pending';--> statement-breakpoint
CREATE INDEX "promotion_records_ownership_stage_idx" ON "app"."promotion_enterprise_records" USING btree ("ownership_status","business_stage");--> statement-breakpoint
CREATE INDEX "promotion_records_pending_followup_idx" ON "app"."promotion_enterprise_records" USING btree ("pending_action_role","next_follow_up_at");--> statement-breakpoint
CREATE INDEX "promotion_records_credit_code_idx" ON "app"."promotion_enterprise_records" USING btree ("credit_code");--> statement-breakpoint
CREATE INDEX "promotion_records_name_phone_idx" ON "app"."promotion_enterprise_records" USING btree ("enterprise_name","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_notification_logs_dedupe_uidx" ON "app"."workflow_notification_logs" USING btree ("dedupe_key","channel") WHERE "app"."workflow_notification_logs"."dedupe_key" is not null;