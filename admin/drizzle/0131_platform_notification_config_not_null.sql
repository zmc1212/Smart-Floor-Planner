-- I7.4.9.3 aligns platform_configs.notification_config with the Drizzle model:
-- NOT NULL DEFAULT '{}'::jsonb. Only NULL rows are backfilled; existing non-null
-- configuration, templates, version and subscription switch are never rewritten.
-- The migration runner owns the transaction; this file must not manage one.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
LOCK TABLE app.platform_configs IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
UPDATE app.platform_configs
SET notification_config = '{}'::jsonb
WHERE notification_config IS NULL;
--> statement-breakpoint
ALTER TABLE app.platform_configs
  ALTER COLUMN notification_config SET DEFAULT '{}'::jsonb,
  ALTER COLUMN notification_config SET NOT NULL;
