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
