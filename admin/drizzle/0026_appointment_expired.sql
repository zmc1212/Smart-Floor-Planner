ALTER TABLE "app"."measurement_appointments"
  DROP CONSTRAINT IF EXISTS "measurement_appointments_status_check";
--> statement-breakpoint
ALTER TABLE "app"."measurement_appointments"
  ADD CONSTRAINT "measurement_appointments_status_check"
  CHECK ("status" IN ('confirmed', 'cancelled', 'completed', 'expired'));
