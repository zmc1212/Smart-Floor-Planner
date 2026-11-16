-- Production role initialization for Smart Floor Planner V1.0.
--
-- This file contains no passwords. Supply them as psql variables:
--   psql -v ON_ERROR_STOP=1 \
--     -v app_password='...' -v migrator_password='...' \
--     -v auditor_password='...' -v backup_password='...' \
--     -v database='smart_floor_planner' \
--     -f postgres-roles.sql
--
-- The script is idempotent: it creates missing roles and re-applies the supplied
-- passwords. Run it as a role that can create roles (usually the database owner).
-- Never reuse the local compose passwords.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE sfp_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sfp_app')\gexec
SELECT format('ALTER ROLE sfp_app LOGIN PASSWORD %L', :'app_password')\gexec

SELECT format('CREATE ROLE sfp_migrator LOGIN PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sfp_migrator')\gexec
SELECT format('ALTER ROLE sfp_migrator LOGIN PASSWORD %L', :'migrator_password')\gexec

SELECT format('CREATE ROLE sfp_auditor LOGIN PASSWORD %L', :'auditor_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sfp_auditor')\gexec
SELECT format('ALTER ROLE sfp_auditor LOGIN PASSWORD %L', :'auditor_password')\gexec

SELECT format('CREATE ROLE sfp_backup LOGIN BYPASSRLS PASSWORD %L', :'backup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sfp_backup')\gexec
SELECT format('ALTER ROLE sfp_backup LOGIN BYPASSRLS PASSWORD %L', :'backup_password')\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO sfp_migrator, sfp_app, sfp_auditor, sfp_backup;
GRANT CREATE ON DATABASE :"database" TO sfp_migrator;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION sfp_migrator;
ALTER SCHEMA app OWNER TO sfp_migrator;
GRANT USAGE ON SCHEMA app TO sfp_app, sfp_auditor, sfp_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sfp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO sfp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO sfp_auditor;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO sfp_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON SEQUENCES TO sfp_backup;

-- Existing objects may predate the default privileges above.
GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_backup;
