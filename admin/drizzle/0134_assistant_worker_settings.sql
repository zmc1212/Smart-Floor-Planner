-- Platform-level start/stop switch for the assistant Worker.
--
-- The deployment gate used to be configured only through XIAOK_* environment
-- variables, so enabling or disabling the Worker required editing the runtime
-- env file and restarting containers. Every save now appends a new immutable
-- version here, which gives the platform super admin a UI-managed switch and a
-- complete audit trail (who changed what, when).
--
-- This table is platform-scoped on purpose: it names the pilot enterprise and
-- pilot id explicitly and is never written by tenant accounts. The Worker still
-- re-resolves the saved pilot project scope on every tick, so enabling the
-- switch never widens delivery beyond the saved scope.
--
-- enterprise_id / updated_by intentionally carry no foreign keys: enterprise
-- purge and admin deletion are hard deletes, and an audit log must not block
-- them or lose rows. They are point-in-time references, not live relations.
CREATE TABLE app.assistant_worker_settings (
 version integer PRIMARY KEY CHECK (version>0),
 enabled boolean NOT NULL,
 enterprise_id bigint,
 pilot_id text CHECK (pilot_id IS NULL OR pilot_id ~ '^[a-zA-Z0-9._:-]{1,128}$'),
 updated_by bigint NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT assistant_worker_settings_enabled_scope CHECK (
  NOT enabled OR (enterprise_id IS NOT NULL AND pilot_id IS NOT NULL)
 ),
 CONSTRAINT assistant_worker_settings_pilot_enterprise CHECK (
  pilot_id IS NULL OR enterprise_id IS NOT NULL
 )
);

CREATE INDEX assistant_worker_settings_enterprise_idx ON app.assistant_worker_settings(enterprise_id);

GRANT SELECT,INSERT ON app.assistant_worker_settings TO sfp_app;
REVOKE UPDATE,DELETE ON app.assistant_worker_settings FROM sfp_app;
