ALTER TABLE "app"."leads" ADD COLUMN "converted_on" date;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "converted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "converted_by" bigint;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "converted_from_status" text;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "contract_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "conversion_note" text;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_converted_by_admin_users_id_fk" FOREIGN KEY ("converted_by") REFERENCES "app"."admin_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_contract_amount_positive_check" CHECK ("contract_amount" IS NULL OR "contract_amount" > 0);
--> statement-breakpoint
ALTER TABLE "app"."leads" ADD CONSTRAINT "leads_conversion_note_length_check" CHECK ("conversion_note" IS NULL OR char_length("conversion_note") <= 200);
--> statement-breakpoint
CREATE INDEX "leads_converted_by_idx" ON "app"."leads" USING btree ("converted_by");
--> statement-breakpoint
CREATE INDEX "leads_enterprise_converted_at_idx" ON "app"."leads" USING btree ("enterprise_id", "converted_at", "id");
--> statement-breakpoint
ALTER TABLE "app"."lead_lifecycle_events" DROP CONSTRAINT "lead_lifecycle_events_action_check";
--> statement-breakpoint
ALTER TABLE "app"."lead_lifecycle_events" ADD CONSTRAINT "lead_lifecycle_events_action_check" CHECK ("action" IN ('archived', 'restored', 'purged', 'converted', 'conversion_reverted'));
