-- I7.4.9.7 provision the least-privilege offline backup role.
--
-- WARNING: BYPASSRLS is a high-sensitivity privilege. This role is for offline
-- backups only. Do not put it in a business connection pool, application
-- runtime, Worker environment, DATABASE_URL or DATABASE_MIGRATION_URL.
--
-- This script intentionally does not set a password and intentionally fails if
-- sfp_backup already exists. Set the password separately with an interactive
-- psql step, for example:
--   \password sfp_backup
-- Run this file only through an approved management connection. It prints the
-- privilege impact and never silently alters an existing role.

\set ON_ERROR_STOP on
\echo 'WARNING: creating sfp_backup with LOGIN, NOSUPERUSER, BYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION'
\echo 'WARNING: this role can read every tenant through FORCE RLS and must never be used by application traffic'

\if :{?backup_database}
\else
\set backup_database smart_floor_planner
\endif

CREATE ROLE sfp_backup LOGIN
  NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE :"backup_database" TO sfp_backup;
GRANT USAGE ON SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO sfp_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON SEQUENCES TO sfp_backup;

\echo 'sfp_backup created with SELECT-only coverage. No password was set.'
\echo 'Set the password separately with: \password sfp_backup'
