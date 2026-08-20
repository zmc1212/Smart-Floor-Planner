ALTER TABLE "app"."measurement_appointments"
  ADD COLUMN "location_name" text,
  ADD COLUMN "latitude" numeric(10, 7),
  ADD COLUMN "longitude" numeric(10, 7),
  ADD COLUMN "coordinate_system" text;

ALTER TABLE "app"."measurement_appointments"
  ADD CONSTRAINT "measurement_appointments_coordinate_system_check"
  CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL AND "coordinate_system" IS NULL)
    OR (
      "latitude" BETWEEN -90 AND 90
      AND "longitude" BETWEEN -180 AND 180
      AND "coordinate_system" = 'gcj02'
    )
  );
