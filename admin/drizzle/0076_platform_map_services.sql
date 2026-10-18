ALTER TABLE app.platform_configs
  ADD COLUMN map_service_config jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE app.platform_configs
  ADD CONSTRAINT platform_configs_map_service_object_check
  CHECK (jsonb_typeof(map_service_config) = 'object');
