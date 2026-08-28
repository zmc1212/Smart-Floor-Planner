ALTER TABLE "app"."devices"
  ADD COLUMN IF NOT EXISTS "serial_number" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_serial_number_uidx"
  ON "app"."devices" ("serial_number")
  WHERE "serial_number" IS NOT NULL;
