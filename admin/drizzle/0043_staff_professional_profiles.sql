ALTER TABLE "app"."enterprises"
  ADD COLUMN IF NOT EXISTS "professional_designer_title" text NOT NULL DEFAULT '金牌设计师',
  ADD COLUMN IF NOT EXISTS "professional_measurer_title" text NOT NULL DEFAULT '资深测量师',
  ADD COLUMN IF NOT EXISTS "professional_default_experience_years" integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "professional_service_threshold" integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "professional_force_enterprise_profile" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "professional_title_visibility_policy" text NOT NULL DEFAULT 'follow_staff';
--> statement-breakpoint
ALTER TABLE "app"."enterprises"
  ADD CONSTRAINT "enterprises_professional_experience_years_check" CHECK ("professional_default_experience_years" BETWEEN 1 AND 100),
  ADD CONSTRAINT "enterprises_professional_service_threshold_check" CHECK ("professional_service_threshold" BETWEEN 100 AND 1000000),
  ADD CONSTRAINT "enterprises_professional_title_visibility_policy_check" CHECK ("professional_title_visibility_policy" IN ('follow_staff', 'force_show', 'force_hide'));
--> statement-breakpoint
ALTER TABLE "app"."admin_users"
  ADD COLUMN IF NOT EXISTS "professional_title" text,
  ADD COLUMN IF NOT EXISTS "professional_career_start_year" integer,
  ADD COLUMN IF NOT EXISTS "professional_title_visible" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "professional_title_admin_override" text,
  ADD COLUMN IF NOT EXISTS "professional_profile_locked" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "professional_show_actual_service_count" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "app"."admin_users"
  ADD CONSTRAINT "admin_users_professional_career_start_year_check" CHECK ("professional_career_start_year" IS NULL OR "professional_career_start_year" BETWEEN 1950 AND 2200);
--> statement-breakpoint
ALTER TABLE "app"."ai_generation_publications"
  ADD COLUMN IF NOT EXISTS "credited_designer_id" bigint REFERENCES "app"."admin_users"("id") ON DELETE SET NULL;
--> statement-breakpoint
UPDATE "app"."ai_generation_publications" publication
SET "credited_designer_id" = COALESCE(
  (
    SELECT assignment_event."designer_id"
    FROM "app"."lead_assignment_events" assignment_event
    WHERE assignment_event."lead_id" = publication."lead_id"
      AND assignment_event."designer_id" IS NOT NULL
      AND assignment_event."created_at" <= publication."published_at"
    ORDER BY assignment_event."created_at" DESC, assignment_event."id" DESC
    LIMIT 1
  ),
  lead_record."assigned_to"
)
FROM "app"."leads" lead_record
WHERE publication."lead_id" = lead_record."id"
  AND publication."credited_designer_id" IS NULL
  AND COALESCE(
    (
      SELECT assignment_event."designer_id"
      FROM "app"."lead_assignment_events" assignment_event
      WHERE assignment_event."lead_id" = publication."lead_id"
        AND assignment_event."designer_id" IS NOT NULL
        AND assignment_event."created_at" <= publication."published_at"
      ORDER BY assignment_event."created_at" DESC, assignment_event."id" DESC
      LIMIT 1
    ),
    lead_record."assigned_to"
  ) IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generation_publications_credited_designer_idx"
  ON "app"."ai_generation_publications" ("credited_designer_id", "lead_id");
