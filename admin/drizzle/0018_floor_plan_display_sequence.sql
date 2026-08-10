ALTER TABLE "app"."lead_floor_plans"
  ADD COLUMN IF NOT EXISTS "measurement_sequence" integer;

--> statement-breakpoint

ALTER TABLE "app"."lead_floor_plans"
  NO FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "app"."floor_plans"
  NO FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

WITH ranked_links AS (
  SELECT
    lead_floor_plans.lead_id,
    lead_floor_plans.floor_plan_id,
    ROW_NUMBER() OVER (
      PARTITION BY lead_floor_plans.lead_id
      ORDER BY floor_plans.created_at ASC, floor_plans.id ASC
    )::integer AS measurement_sequence
  FROM "app"."lead_floor_plans"
  INNER JOIN "app"."floor_plans"
    ON floor_plans.id = lead_floor_plans.floor_plan_id
)
UPDATE "app"."lead_floor_plans" AS lead_floor_plans
SET "measurement_sequence" = ranked_links.measurement_sequence
FROM ranked_links
WHERE lead_floor_plans.lead_id = ranked_links.lead_id
  AND lead_floor_plans.floor_plan_id = ranked_links.floor_plan_id
  AND lead_floor_plans.measurement_sequence IS NULL;

--> statement-breakpoint

ALTER TABLE "app"."lead_floor_plans"
  FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "app"."floor_plans"
  FORCE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE "app"."lead_floor_plans"
  ALTER COLUMN "measurement_sequence" SET NOT NULL;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "lead_floor_plans_lead_measurement_sequence_key"
  ON "app"."lead_floor_plans" ("lead_id", "measurement_sequence");
