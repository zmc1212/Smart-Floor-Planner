CREATE TABLE app.assistant_long_term_memories (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  owner_id bigint NOT NULL REFERENCES app.users(id),
  memory_key text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  project_id bigint,
  lead_id bigint,
  category text NOT NULL CHECK (category IN ('preference','project_fact','decision','delegation')),
  topic text NOT NULL,
  room text NOT NULL DEFAULT '',
  state text NOT NULL CHECK (state IN ('current','candidate','conflict','superseded','invalidated','deleted')),
  value text,
  source_conversation_id bigint NOT NULL,
  source_message_id bigint NOT NULL,
  source_hash text NOT NULL,
  operation_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, owner_id, memory_key, revision),
  UNIQUE (enterprise_id, owner_id, operation_key),
  FOREIGN KEY (enterprise_id, project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, source_conversation_id, source_message_id)
    REFERENCES app.assistant_messages(enterprise_id,conversation_id,id) ON DELETE CASCADE,
  CHECK ((state='deleted') = (value IS NULL))
);
CREATE INDEX assistant_long_term_memory_scope
  ON app.assistant_long_term_memories(enterprise_id,owner_id,lead_id,created_at DESC)
  WHERE state IN ('current','candidate','conflict');
ALTER TABLE app.assistant_long_term_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_long_term_memories FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_long_term_memory_tenant ON app.assistant_long_term_memories FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_long_term_memories TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.native_workflow_delegations (
  enterprise_id bigint NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id bigint NOT NULL,
  owner_id bigint NOT NULL REFERENCES app.users(id),
  conversation_id bigint NOT NULL,
  origin_message_id bigint NOT NULL,
  origin_hash text NOT NULL,
  title text NOT NULL,
  objective text NOT NULL,
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope)='object'),
  completion_criteria text NOT NULL,
  current_status text NOT NULL CHECK (current_status IN ('pending','running','waiting_for_user',
    'waiting_for_worker','waiting_for_designer','waiting_for_external','waiting_for_authorization',
    'failed','paused','cancelled','completed')),
  assigned_to bigint,
  waiting_for text,
  next_action text NOT NULL,
  due_at timestamptz NOT NULL,
  next_wake_at timestamptz,
  authorization_scope jsonb NOT NULL CHECK (jsonb_typeof(authorization_scope)='object'),
  evidence jsonb,
  version integer NOT NULL DEFAULT 1,
  activation_event_id bigint,
  operation_key text NOT NULL,
  reminder_stage integer NOT NULL DEFAULT 0 CHECK (reminder_stage BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (enterprise_id,id),
  UNIQUE (enterprise_id,owner_id,operation_key),
  FOREIGN KEY (enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id,conversation_id,origin_message_id)
    REFERENCES app.assistant_messages(enterprise_id,conversation_id,id) ON DELETE CASCADE,
  CHECK ((current_status='completed') = (completed_at IS NOT NULL))
);
CREATE INDEX native_delegation_project_scope ON app.native_workflow_delegations(enterprise_id,project_id,owner_id,updated_at DESC);
CREATE INDEX native_delegation_wake ON app.native_workflow_delegations(enterprise_id,next_wake_at) WHERE next_wake_at IS NOT NULL;
ALTER TABLE app.native_workflow_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.native_workflow_delegations FORCE ROW LEVEL SECURITY;
CREATE POLICY native_delegation_tenant ON app.native_workflow_delegations FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.native_workflow_delegations TO sfp_app;

CREATE TABLE app.native_workflow_delegation_events (
  enterprise_id bigint NOT NULL,
  delegation_id uuid NOT NULL,
  event_id bigint NOT NULL,
  from_status text,
  to_status text NOT NULL,
  delegation_version integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied','unchanged','paused','unavailable','control','failed')),
  receipt jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id,delegation_id,event_id),
  FOREIGN KEY (enterprise_id,delegation_id) REFERENCES app.native_workflow_delegations(enterprise_id,id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id,event_id) REFERENCES app.domain_event_outbox(enterprise_id,id) ON DELETE CASCADE
);
ALTER TABLE app.native_workflow_delegation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.native_workflow_delegation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY native_delegation_event_tenant ON app.native_workflow_delegation_events FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.native_workflow_delegation_events TO sfp_app;
CREATE INDEX native_delegation_delivery_open ON app.domain_event_deliveries(enterprise_id,available_at,event_id)
  WHERE consumer_key='native.delegation.v1' AND status IN ('pending','retry_wait');
--> statement-breakpoint
CREATE FUNCTION app.queue_native_delegation_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE
  project text := NEW.payload->>'projectId';
BEGIN
  CASE NEW.type
    WHEN 'native.delegation.refresh.v1','native.delegation.timeout.v1','native.delegation.owner_input.v1',
      'native.delegation.external_result.v1','construction.record.captured.v1','construction.record.publish.v1',
      'construction.record.edit.v1','construction.record.withdraw.v1','construction.record.request_changes.v1',
      'construction.record.resubmit.v1','construction.material.shared.v1','construction.plan.published.v1',
      'construction.site.issue.opened.v1','construction.site.issue.progress.v1',
      'construction.site.issue.evidence.v1','construction.site.issue.lifecycle.v1',
      'construction.site.issue.result.v1','construction.project.changed.v1' THEN
        NULL;
    WHEN 'construction.material.revoked.v1','construction.plan.status.v1' THEN
      SELECT e.payload->>'projectId' INTO project FROM app.domain_event_outbox e
        WHERE e.enterprise_id=NEW.enterprise_id AND e.id::text=NEW.aggregate_id
        AND e.type=CASE WHEN NEW.type='construction.material.revoked.v1'
          THEN 'construction.material.shared.v1' ELSE 'construction.plan.published.v1' END;
    WHEN 'assistant.run.terminal.v1' THEN
      SELECT r.project_id::text INTO project FROM app.construction_site_records r
        WHERE r.enterprise_id=NEW.enterprise_id AND r.run_id::text=NEW.aggregate_id;
    ELSE RETURN NEW;
  END CASE;
  IF project ~ '^[1-9][0-9]{0,17}$' AND EXISTS (
    SELECT 1 FROM app.native_workflow_delegations d
    WHERE d.enterprise_id=NEW.enterprise_id AND d.project_id=project::bigint
      AND d.current_status NOT IN ('cancelled','failed')
  ) THEN
    INSERT INTO app.domain_event_deliveries(enterprise_id,event_id,consumer_key)
      VALUES (NEW.enterprise_id,NEW.id,'native.delegation.v1') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER native_delegation_event_delivery AFTER INSERT ON app.domain_event_outbox
  FOR EACH ROW EXECUTE FUNCTION app.queue_native_delegation_event();
--> statement-breakpoint
CREATE FUNCTION app.emit_native_delegation_project_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.native_workflow_delegations d WHERE d.enterprise_id=NEW.enterprise_id AND d.project_id=NEW.id
      AND d.current_status NOT IN ('cancelled','failed')) THEN
    INSERT INTO app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      VALUES(NEW.enterprise_id,'construction.project.changed.v1','construction_project',NEW.id::text,NEW.version,
        '{"kind":"system"}',NEW.id::text,jsonb_build_object('projectId',NEW.id::text)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER native_delegation_project_change AFTER UPDATE OF version ON app.construction_projects
  FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version) EXECUTE FUNCTION app.emit_native_delegation_project_change();
