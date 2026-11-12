-- Reuse verified existing runtime tables or initialize them on this timeline.
DO $integration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795161600000 AND hash IN ('4ccfc1d4495008190cc137b9f31ad94b1ff183914ca5fa0f95168621d1082d4a','9223d48fdcc4ecdde1a39b628d32996553da609a1bd1a2070784fd358403de5f')) THEN
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
  ELSIF (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='app' AND c.relrowsecurity AND c.relforcerowsecurity
    AND c.relname IN ('native_workflow_runs','native_workflow_schedule_runs','native_workflow_report_batches',
      'native_workflow_schedule_controls','native_workflow_schedule_ledgers')) <> 5 THEN
    RAISE EXCEPTION 'The applied Native runtime tables or their forced RLS are missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795248000000 AND hash IN ('4230eb03af9febf260d4d5700f7b21ef85a8306f2efd8e4b93d677a873a82a2f','04e0304f26a35e0a3a8193b262226ad68f9a18471776771bec20f44dccc1d814')) THEN
    CREATE TABLE app.native_workflow_durable_tasks (
      enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
      id text NOT NULL,
      kind text NOT NULL,
      business_key text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending','queued','running','waiting','retrying','succeeded','failed','cancelled','expired')),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      state jsonb NOT NULL,
      next_attempt_at timestamptz,
      deadline_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      lease_owner text,
      lease_token text,
      lease_acquired_at timestamptz,
      lease_heartbeat_at timestamptz,
      lease_until timestamptz,
      PRIMARY KEY (enterprise_id,id),
      UNIQUE (enterprise_id,kind,business_key),
      CHECK (state->>'enterpriseId' IS NOT DISTINCT FROM enterprise_id::text),
      CHECK (state->>'taskId' IS NOT DISTINCT FROM id),
      CHECK (state->>'kind' IS NOT DISTINCT FROM kind),
      CHECK (state->>'businessKey' IS NOT DISTINCT FROM business_key),
      CHECK (state->>'status' IS NOT DISTINCT FROM status),
      CHECK (num_nonnulls(lease_owner,lease_token,lease_acquired_at,lease_heartbeat_at,lease_until) IN (0,5))
    );

    CREATE INDEX native_workflow_durable_ready ON app.native_workflow_durable_tasks
      (enterprise_id,kind,(state#>>'{data,tool}'),next_attempt_at,updated_at,id)
      WHERE status IN ('pending','queued','running','waiting','retrying');
    CREATE INDEX native_workflow_durable_manual ON app.native_workflow_durable_tasks (enterprise_id,updated_at DESC,id)
      WHERE state->'manual' IS NOT NULL AND state->'manual' <> 'null'::jsonb AND state#>>'{manual,resolvedAt}' IS NULL;
    ALTER TABLE app.native_workflow_durable_tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.native_workflow_durable_tasks FORCE ROW LEVEL SECURITY;
    CREATE POLICY native_durable_tenant ON app.native_workflow_durable_tasks FOR ALL TO sfp_app
      USING (enterprise_id=(SELECT app.current_enterprise_id()))
      WITH CHECK (enterprise_id=(SELECT app.current_enterprise_id()));
    GRANT SELECT,INSERT,UPDATE,DELETE ON app.native_workflow_durable_tasks TO sfp_app;

    CREATE INDEX native_workflow_tool_callback_due ON app.domain_event_deliveries(enterprise_id,available_at,id)
      WHERE consumer_key='native.tool.result.v1' AND status IN ('pending','retry_wait');
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='app' AND c.relname='native_workflow_durable_tasks' AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'The applied Native durable tasks table or its forced RLS is missing.';
  END IF;
END
$integration$;
