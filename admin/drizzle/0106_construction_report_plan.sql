-- The original report service remains the only scheduler and authority.
ALTER TABLE app.construction_report_settings
 ADD COLUMN stage_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN weekly_day smallint NOT NULL DEFAULT 1 CHECK(weekly_day BETWEEN 1 AND 7),
 ADD COLUMN audiences jsonb NOT NULL DEFAULT '["customer","worker","designer","boss"]'
  CHECK(jsonb_typeof(audiences)='array' AND audiences <@ '["customer","worker","designer","boss"]'::jsonb),
 ADD COLUMN inactive_policy text NOT NULL DEFAULT 'pause_inactive' CHECK(inactive_policy='pause_inactive'),
 ADD COLUMN dispatch_epoch integer NOT NULL DEFAULT 1 CHECK(dispatch_epoch>0);
