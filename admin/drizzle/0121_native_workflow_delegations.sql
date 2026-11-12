CREATE TABLE app.native_workflow_delegations (
  enterprise_id bigint NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id bigint NOT NULL,
  requester_id bigint NOT NULL REFERENCES app.users(id),
  conversation_id bigint NOT NULL,
  origin_message_id bigint NOT NULL,
  origin_hash text NOT NULL,
  goal text NOT NULL,
  authorization_scope jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('active','processing','waiting','blocked','awaiting_authorization','paused','completed','failed','cancelled','expired')),
  tasks jsonb NOT NULL CHECK (jsonb_typeof(tasks) = 'array'),
  next_action text,
  latest_event_id bigint,
  activation_event_id bigint,
  paused_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz NOT NULL,
  next_wake_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id,id),
  UNIQUE (enterprise_id,conversation_id,origin_message_id),
  FOREIGN KEY (enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id,conversation_id,origin_message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id) ON DELETE CASCADE
);
CREATE INDEX native_delegation_project_open ON app.native_workflow_delegations(enterprise_id,project_id)
  WHERE state NOT IN ('completed','failed','cancelled','expired');
CREATE INDEX native_delegation_conversation ON app.native_workflow_delegations(enterprise_id,conversation_id,requester_id,created_at DESC);
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
  outcome text NOT NULL CHECK (outcome IN ('applied','unchanged','paused','unavailable','control')),
  task_changes jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id,delegation_id,event_id),
  FOREIGN KEY (enterprise_id,delegation_id) REFERENCES app.native_workflow_delegations(enterprise_id,id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id,event_id) REFERENCES app.domain_event_outbox(enterprise_id,id) ON DELETE CASCADE
);
CREATE INDEX native_delegation_by_event ON app.native_workflow_delegation_events(enterprise_id,event_id);
ALTER TABLE app.native_workflow_delegation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.native_workflow_delegation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY native_delegation_event_tenant ON app.native_workflow_delegation_events FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.native_workflow_delegation_events TO sfp_app;
CREATE INDEX native_delegation_delivery_open ON app.domain_event_deliveries(enterprise_id,event_id)
  WHERE consumer_key='native.delegation.v1' AND status IN ('pending','retry_wait');
--> statement-breakpoint
-- Source writers and delivery enrollment commit together. Sources keep their own
-- version and audience contracts. Only enterprises with an open delegation queue work.
CREATE FUNCTION app.queue_native_delegation_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE
  project text;
  consultation text;
  stream_room text;
BEGIN
  CASE NEW.type
    WHEN 'native.delegation.refresh.v1', 'native.delegation.timeout.v1',
      'construction.record.captured.v1', 'construction.record.publish.v1',
      'construction.record.edit.v1', 'construction.record.withdraw.v1', 'construction.record.request_changes.v1',
      'construction.record.resubmit.v1', 'construction.material.shared.v1',
      'construction.site.issue.opened.v1', 'construction.site.issue.progress.v1', 'construction.site.issue.lifecycle.v1',
      'construction.plan.published.v1', 'construction.project.changed.v1', 'construction.schedule.changed.v1' THEN
        project := NEW.payload->>'projectId';
        stream_room := NEW.payload->>'roomId';
    WHEN 'native.delegation.requirement.v1' THEN
        consultation := NEW.payload->>'conversationId';
    WHEN 'assistant.run.terminal.v1' THEN
        SELECT r.project_id::text, r.room_id::text INTO project, stream_room
        FROM app.construction_site_records r
        WHERE r.enterprise_id=NEW.enterprise_id AND r.run_id=NEW.aggregate_id::bigint;
    WHEN 'construction.material.revoked.v1', 'construction.plan.status.v1' THEN
        SELECT e.payload->>'projectId', e.payload->>'roomId' INTO project, stream_room
        FROM app.domain_event_outbox e
        WHERE e.enterprise_id=NEW.enterprise_id AND e.id=NEW.aggregate_id::bigint
          AND e.type=CASE WHEN NEW.type='construction.material.revoked.v1' THEN 'construction.material.shared.v1' ELSE 'construction.plan.published.v1' END;
    ELSE RETURN NEW;
  END CASE;

  IF (project IS NOT NULL OR consultation IS NOT NULL) AND EXISTS (
    SELECT 1 FROM app.native_workflow_delegations d
    WHERE d.enterprise_id=NEW.enterprise_id AND d.state NOT IN ('completed','failed','cancelled','expired')
      AND (d.project_id::text=project OR d.conversation_id::text=consultation)
      AND (stream_room IS NULL OR d.tasks @> jsonb_build_array(jsonb_build_object('roomId',stream_room)))
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
-- A dated schedule is distinct from the customer-approved issue plan.
CREATE FUNCTION app.emit_native_schedule_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE
  schedule app.construction_plans;
  prior_room bigint;
  revision integer;
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(NEW)-'updated_at'-'version' = to_jsonb(OLD)-'updated_at'-'version' THEN
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN schedule := OLD; ELSE schedule := NEW; END IF;
  IF TG_OP<>'INSERT' THEN prior_room := OLD.room_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.native_workflow_delegations d
    WHERE d.enterprise_id=schedule.enterprise_id AND d.project_id=schedule.project_id AND d.state NOT IN ('completed','failed','cancelled','expired')) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(max(e.aggregate_version),0)+1 INTO revision FROM app.domain_event_outbox e
    WHERE e.enterprise_id=schedule.enterprise_id AND e.aggregate_id=schedule.id::text AND e.type='construction.schedule.changed.v1';
  INSERT INTO app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    VALUES(schedule.enterprise_id,'construction.schedule.changed.v1','construction_schedule',schedule.id::text,revision,
      '{"kind":"system"}',schedule.id::text,jsonb_build_object('projectId',schedule.project_id::text,
      'roomId',CASE WHEN TG_OP='UPDATE' AND prior_room IS DISTINCT FROM schedule.room_id THEN NULL ELSE schedule.room_id::text END,
      'previousRoomId',prior_room::text,'currentRoomId',schedule.room_id::text,'operation',TG_OP,'sourceVersion',schedule.version));
  RETURN NULL;
END
$$;
CREATE TRIGGER native_delegation_schedule_change AFTER INSERT OR UPDATE OR DELETE ON app.construction_plans
  FOR EACH ROW EXECUTE FUNCTION app.emit_native_schedule_change();
