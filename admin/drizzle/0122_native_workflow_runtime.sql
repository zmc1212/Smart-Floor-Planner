CREATE TABLE app.native_workflow_runs (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (enterprise_id,id),
  CHECK (state->>'enterpriseId' IS NOT DISTINCT FROM enterprise_id::text),
  CHECK (state#>>'{binding,runId}' IS NOT DISTINCT FROM id)
);
CREATE INDEX native_workflow_run_recent ON app.native_workflow_runs(enterprise_id,updated_at DESC,id);

CREATE TABLE app.native_workflow_schedule_runs (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  id text NOT NULL,
  period_start date NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  lease_owner text,
  lease_token text,
  lease_until timestamptz,
  PRIMARY KEY (enterprise_id,id),
  UNIQUE (enterprise_id,period_start),
  CHECK (state->>'enterpriseId' IS NOT DISTINCT FROM enterprise_id::text),
  CHECK (state->>'runId' IS NOT DISTINCT FROM id),
  CHECK (num_nonnulls(lease_owner,lease_token,lease_until) IN (0,3))
);
CREATE INDEX native_workflow_schedule_recent ON app.native_workflow_schedule_runs(enterprise_id,updated_at DESC,id);

CREATE TABLE app.native_workflow_report_batches (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  lease_owner text,
  lease_token text,
  lease_until timestamptz,
  PRIMARY KEY (enterprise_id,id),
  CHECK (state->>'enterpriseId' IS NOT DISTINCT FROM enterprise_id::text),
  CHECK (state->>'requestId' IS NOT DISTINCT FROM id),
  CHECK (num_nonnulls(lease_owner,lease_token,lease_until) IN (0,3))
);

CREATE TABLE app.native_workflow_schedule_controls (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  id text NOT NULL CHECK (id = enterprise_id::text),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (enterprise_id,id),
  CHECK (state->>'enterpriseId' IS NOT DISTINCT FROM enterprise_id::text)
);

CREATE TABLE app.native_workflow_schedule_ledgers (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (enterprise_id,id),
  CHECK (state->>'enterpriseId' IS NOT DISTINCT FROM enterprise_id::text),
  CHECK (state->>'projectId' IS NOT DISTINCT FROM id)
);
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['native_workflow_runs','native_workflow_schedule_runs',
    'native_workflow_report_batches','native_workflow_schedule_controls','native_workflow_schedule_ledgers']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format('CREATE POLICY native_runtime_tenant ON app.%I FOR ALL TO sfp_app
      USING (enterprise_id=(SELECT app.current_enterprise_id()))
      WITH CHECK (enterprise_id=(SELECT app.current_enterprise_id()))', relation);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app', relation);
  END LOOP;
END $$;
