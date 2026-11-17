-- Acquisition entry copy and brand visibility for XiaoK's QR landing.
--
-- The same enterprise can run anonymous promoter codes (no company name before
-- phone authorization) and branded staff codes. Keeping the setting beside the
-- existing guidance configuration gives every change the same tenant RLS,
-- manager authorization and optimistic version fence as other XiaoK settings.
ALTER TABLE app.assistant_enterprise_settings ADD COLUMN acquisition_config jsonb;
--> statement-breakpoint
ALTER TABLE app.assistant_enterprise_settings ADD CONSTRAINT assistant_acquisition_config_object
  CHECK (acquisition_config IS NULL OR jsonb_typeof(acquisition_config) = 'object');
