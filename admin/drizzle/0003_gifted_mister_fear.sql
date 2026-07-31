ALTER TABLE "app"."floor_plans" ALTER COLUMN "layout_data" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "app"."floor_plans"
  DROP CONSTRAINT "floor_plans_formal_layout_check",
  ADD CONSTRAINT "floor_plans_formal_layout_check"
    CHECK (
      "layout_data"->>'version' = '4'
      AND "layout_data"->>'measurementMode' = 'surveying'
      AND jsonb_typeof("layout_data"->'surveyGraph') = 'object'
    );
