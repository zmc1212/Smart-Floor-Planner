-- Local development roles only. Production passwords must be supplied by the
-- deployment secret manager and must not reuse these values.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sfp_migrator') THEN
    CREATE ROLE sfp_migrator LOGIN PASSWORD 'sfp_migrator_local_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sfp_app') THEN
    CREATE ROLE sfp_app LOGIN PASSWORD 'sfp_app_local_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sfp_auditor') THEN
    CREATE ROLE sfp_auditor LOGIN PASSWORD 'sfp_auditor_local_only';
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE smart_floor_planner FROM PUBLIC;
GRANT CONNECT ON DATABASE smart_floor_planner TO sfp_migrator, sfp_app, sfp_auditor;
GRANT CREATE ON DATABASE smart_floor_planner TO sfp_migrator;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION sfp_migrator;
ALTER SCHEMA app OWNER TO sfp_migrator;
GRANT USAGE ON SCHEMA app TO sfp_app, sfp_auditor;

ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sfp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO sfp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO sfp_auditor;
