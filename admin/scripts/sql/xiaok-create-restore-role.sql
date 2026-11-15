-- I7.4.9.8 provision the independent restore maintenance role.
--
-- WARNING: sfp_restore is a maintenance-only role. It must never be used by
-- application traffic, a Worker, DATABASE_URL, DATABASE_MIGRATION_URL or the
-- backup role. It intentionally has no password here.
--
-- Real app objects are expected to be owned by sfp_migrator. Mixed ownership
-- requires a separately approved membership in each non-superuser owner role;
-- never grant a superuser owner role merely to restore ownership.
--
-- Set the password separately with an interactive psql step:
--   \password sfp_restore
-- Run this file only through an approved management connection.

\set ON_ERROR_STOP on
\echo 'WARNING: creating sfp_restore with LOGIN, NOSUPERUSER, CREATEDB, BYPASSRLS, NOCREATEROLE, NOREPLICATION'
\echo 'WARNING: this role is for disposable restore databases only and must not connect to application traffic'

\if :{?restore_owner_role}
\else
\set restore_owner_role sfp_migrator
\endif

CREATE ROLE sfp_restore LOGIN
  NOSUPERUSER CREATEDB BYPASSRLS NOCREATEROLE NOREPLICATION;

-- Required to restore ownership and ACLs for objects owned by sfp_migrator.
GRANT :"restore_owner_role" TO sfp_restore;

\echo 'sfp_restore created for disposable restores. No source database CONNECT was granted.'
\echo 'Set the password separately with: \password sfp_restore'
