ALTER TABLE app.assistant_enterprise_settings ADD COLUMN guidance_config jsonb;
--> statement-breakpoint
ALTER TABLE app.assistant_enterprise_settings ADD CONSTRAINT assistant_guidance_config_object CHECK (guidance_config IS NULL OR jsonb_typeof(guidance_config)='object');
