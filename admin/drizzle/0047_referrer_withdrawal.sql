ALTER TABLE "app"."leads"
  ADD COLUMN IF NOT EXISTS "referrer_record_code" text,
  ADD COLUMN IF NOT EXISTS "termination_type" text,
  ADD COLUMN IF NOT EXISTS "terminated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "terminated_by_user_id" bigint,
  ADD COLUMN IF NOT EXISTS "terminated_by_referrer_membership_id" bigint,
  ADD COLUMN IF NOT EXISTS "termination_previous_status" text,
  ADD COLUMN IF NOT EXISTS "termination_note" text;
--> statement-breakpoint

ALTER TABLE "app"."leads"
  ADD CONSTRAINT "leads_termination_type_check"
  CHECK ("termination_type" IS NULL OR "termination_type" IN ('referrer_withdrawn'));
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "leads_referrer_record_code_uidx"
  ON "app"."leads" ("referrer_record_code")
  WHERE "referrer_record_code" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "leads_termination_type_idx"
  ON "app"."leads" ("enterprise_id", "termination_type", "terminated_at");
--> statement-breakpoint

ALTER TABLE "app"."leads"
  ADD CONSTRAINT "leads_terminated_by_user_id_fkey"
  FOREIGN KEY ("terminated_by_user_id") REFERENCES "app"."users"("id") ON DELETE SET NULL;
ALTER TABLE "app"."leads"
  ADD CONSTRAINT "leads_terminated_by_referrer_membership_id_fkey"
  FOREIGN KEY ("terminated_by_referrer_membership_id") REFERENCES "app"."referrer_enterprise_memberships"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "app"."lead_lifecycle_events"
  ADD COLUMN IF NOT EXISTS "actor_user_id" bigint,
  ADD COLUMN IF NOT EXISTS "actor_referrer_membership_id" bigint;
ALTER TABLE "app"."lead_lifecycle_events"
  ADD CONSTRAINT "lead_lifecycle_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE SET NULL;
ALTER TABLE "app"."lead_lifecycle_events"
  ADD CONSTRAINT "lead_lifecycle_events_actor_referrer_membership_id_fkey"
  FOREIGN KEY ("actor_referrer_membership_id") REFERENCES "app"."referrer_enterprise_memberships"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_lifecycle_events_actor_user_idx"
  ON "app"."lead_lifecycle_events" ("actor_user_id");
--> statement-breakpoint

ALTER TABLE "app"."lead_lifecycle_events"
  DROP CONSTRAINT IF EXISTS "lead_lifecycle_events_action_check";
ALTER TABLE "app"."lead_lifecycle_events"
  ADD CONSTRAINT "lead_lifecycle_events_action_check"
  CHECK ("action" IN ('archived','restored','purged','converted','conversion_reverted','closed_lost','reopened','referrer_withdrawn','referrer_withdrawal_reverted'));
