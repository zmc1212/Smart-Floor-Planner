-- Bailian admitted multiple distinct delegations from the same message. Its
-- original operation key, rather than an all-rows origin constraint, protects
-- those writes. Native electrical follow-ups still have one task per origin.
CREATE OR REPLACE FUNCTION app.native_delegation_review_state(review_status text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT CASE review_status
    WHEN 'pending' THEN 'active'
    WHEN 'running' THEN 'processing'
    WHEN 'waiting_for_authorization' THEN 'awaiting_authorization'
    WHEN 'waiting_for_user' THEN 'waiting'
    WHEN 'waiting_for_worker' THEN 'waiting'
    WHEN 'waiting_for_designer' THEN 'waiting'
    WHEN 'waiting_for_external' THEN 'waiting'
    ELSE review_status
  END
$$;
--> statement-breakpoint
DO $migration$
DECLARE
  has_requester boolean;
  has_owner boolean;
  has_tasks boolean;
  has_receipt boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('app.native_workflow_delegations')
      AND attname='requester_id' AND NOT attisdropped),
    EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('app.native_workflow_delegations')
      AND attname='owner_id' AND NOT attisdropped),
    EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('app.native_workflow_delegation_events')
      AND attname='task_changes' AND NOT attisdropped),
    EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('app.native_workflow_delegation_events')
      AND attname='receipt' AND NOT attisdropped)
    INTO has_requester,has_owner,has_tasks,has_receipt;
  IF NOT has_owner OR NOT has_receipt OR has_requester IS DISTINCT FROM has_tasks THEN
    RAISE EXCEPTION 'Expected original Bailian or integrated delegation tables.';
  END IF;

  IF NOT has_requester THEN
    ALTER TABLE app.native_workflow_delegations
      ADD COLUMN requester_id bigint REFERENCES app.users(id),
      ADD COLUMN goal text,
      ADD COLUMN state text CHECK (state IN
        ('active','processing','waiting','blocked','awaiting_authorization','paused','completed','failed','cancelled','expired')),
      ADD COLUMN tasks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tasks)='array'),
      ADD COLUMN latest_event_id bigint,
      ADD COLUMN paused_at timestamptz,
      ADD COLUMN cancelled_at timestamptz,
      ADD COLUMN expires_at timestamptz;

    -- The table is locked by the DDL. Give only this transaction's migration
    -- role access for the backfill, with the original FORCE RLS policy intact.
    CREATE POLICY xiaok_integration_delegation_backfill ON app.native_workflow_delegations
      TO CURRENT_USER USING (true) WITH CHECK (true);
    UPDATE app.native_workflow_delegations SET requester_id=owner_id,goal=title,
      state=app.native_delegation_review_state(current_status),expires_at=due_at,
      paused_at=CASE WHEN current_status='paused' THEN updated_at END,
      cancelled_at=CASE WHEN current_status='cancelled' THEN updated_at END;
    DROP POLICY xiaok_integration_delegation_backfill ON app.native_workflow_delegations;

    ALTER TABLE app.native_workflow_delegations
      ALTER COLUMN requester_id SET NOT NULL,
      ALTER COLUMN goal SET NOT NULL,
      ALTER COLUMN state SET NOT NULL,
      ALTER COLUMN expires_at SET NOT NULL,
      ALTER COLUMN owner_id DROP NOT NULL,
      ALTER COLUMN title DROP NOT NULL,
      ALTER COLUMN objective DROP NOT NULL,
      ALTER COLUMN scope DROP NOT NULL,
      ALTER COLUMN completion_criteria DROP NOT NULL,
      ALTER COLUMN current_status DROP NOT NULL,
      ALTER COLUMN next_action DROP NOT NULL,
      ALTER COLUMN due_at DROP NOT NULL,
      ALTER COLUMN operation_key DROP NOT NULL,
      ADD CONSTRAINT native_delegation_review_contract CHECK
        ((scope IS NULL AND current_status IS NULL AND owner_id IS NULL)
          OR (scope IS NOT NULL AND current_status IS NOT NULL AND owner_id IS NOT NULL AND owner_id=requester_id
            AND title IS NOT NULL AND objective IS NOT NULL AND completion_criteria IS NOT NULL AND due_at IS NOT NULL
            AND operation_key IS NOT NULL AND jsonb_typeof(authorization_scope)='object'
            AND state=app.native_delegation_review_state(current_status) AND ((current_status='completed')=(completed_at IS NOT NULL))));
    ALTER TABLE app.native_workflow_delegation_events
      ADD COLUMN task_changes jsonb,
      ALTER COLUMN to_status DROP NOT NULL,
      ALTER COLUMN delegation_version DROP NOT NULL,
      ADD CONSTRAINT native_delegation_event_projection_check CHECK
        ((task_changes IS NOT NULL AND to_status IS NULL AND delegation_version IS NULL)
          OR (task_changes IS NULL AND to_status IS NOT NULL AND delegation_version IS NOT NULL));
  END IF;
END
$migration$;
--> statement-breakpoint
ALTER TABLE app.native_workflow_delegations
  DROP CONSTRAINT IF EXISTS native_workflow_delegations_enterprise_id_conversation_id_o_key,
  DROP CONSTRAINT IF EXISTS native_workflow_delegations_origin_unique;
CREATE UNIQUE INDEX native_delegation_electrical_origin
  ON app.native_workflow_delegations(enterprise_id,conversation_id,origin_message_id) WHERE scope IS NULL;
CREATE INDEX IF NOT EXISTS native_delegation_project_open ON app.native_workflow_delegations(enterprise_id,project_id)
  WHERE state NOT IN ('completed','failed','cancelled','expired');
CREATE INDEX IF NOT EXISTS native_delegation_conversation
  ON app.native_workflow_delegations(enterprise_id,conversation_id,requester_id,created_at DESC);
CREATE INDEX IF NOT EXISTS native_delegation_by_event ON app.native_workflow_delegation_events(enterprise_id,event_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.queue_native_delegation_event()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE
  project text;
  consultation text;
  stream_room text;
  target text := NEW.payload->>'delegationId';
BEGIN
  CASE NEW.type
    WHEN 'native.delegation.refresh.v1','native.delegation.timeout.v1','native.delegation.owner_input.v1',
      'native.delegation.external_result.v1','construction.record.captured.v1','construction.record.publish.v1',
      'construction.record.edit.v1','construction.record.withdraw.v1','construction.record.request_changes.v1',
      'construction.record.resubmit.v1','construction.material.shared.v1','construction.plan.published.v1',
      'construction.site.issue.opened.v1','construction.site.issue.progress.v1','construction.site.issue.evidence.v1',
      'construction.site.issue.lifecycle.v1','construction.site.issue.result.v1','construction.project.changed.v1',
      'construction.schedule.changed.v1' THEN
        project := NEW.payload->>'projectId';
        stream_room := nullif(NEW.payload->>'roomId','');
    WHEN 'native.delegation.requirement.v1' THEN
      consultation := NEW.payload->>'conversationId';
    WHEN 'assistant.run.terminal.v1' THEN
      SELECT r.project_id::text,r.room_id::text INTO project,stream_room
        FROM app.construction_site_records r WHERE r.enterprise_id=NEW.enterprise_id AND r.run_id::text=NEW.aggregate_id;
    WHEN 'construction.material.revoked.v1','construction.plan.status.v1' THEN
      SELECT e.payload->>'projectId',e.payload->>'roomId' INTO project,stream_room
        FROM app.domain_event_outbox e WHERE e.enterprise_id=NEW.enterprise_id AND e.id::text=NEW.aggregate_id
        AND e.type=CASE WHEN NEW.type='construction.material.revoked.v1'
          THEN 'construction.material.shared.v1' ELSE 'construction.plan.published.v1' END;
    ELSE RETURN NEW;
  END CASE;
  IF EXISTS (
    SELECT 1 FROM app.native_workflow_delegations d
      WHERE d.enterprise_id=NEW.enterprise_id
        AND (d.project_id::text=project OR d.conversation_id::text=consultation)
        AND (target IS NULL OR d.id::text=target)
        AND ((d.scope IS NOT NULL AND d.state NOT IN ('failed','cancelled','expired'))
          OR (d.scope IS NULL AND (d.state NOT IN ('completed','failed','cancelled','expired')
            OR (d.state='completed' AND NEW.type='construction.site.issue.lifecycle.v1' AND NEW.payload->>'state'='reopened'
              AND NEW.payload->>'issueId' IS NOT NULL
              AND d.tasks @> jsonb_build_array(jsonb_build_object('issueId',NEW.payload->>'issueId'))))
            AND (stream_room IS NULL OR d.tasks @> jsonb_build_array(jsonb_build_object('roomId',stream_room)))))
  ) THEN
    INSERT INTO app.domain_event_deliveries(enterprise_id,event_id,consumer_key)
      VALUES (NEW.enterprise_id,NEW.id,'native.delegation.v1') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.emit_native_delegation_project_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.native_workflow_delegations d WHERE d.enterprise_id=NEW.enterprise_id AND d.project_id=NEW.id
      AND d.scope IS NOT NULL AND d.state NOT IN ('cancelled','failed','expired')) THEN
    INSERT INTO app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      VALUES(NEW.enterprise_id,'construction.project.changed.v1','construction_project',NEW.id::text,NEW.version,
        '{"kind":"system"}',NEW.id::text,jsonb_build_object('projectId',NEW.id::text)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.emit_native_schedule_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
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
    WHERE d.enterprise_id=schedule.enterprise_id AND d.project_id=schedule.project_id AND d.scope IS NULL
      AND d.state NOT IN ('completed','failed','cancelled','expired')) THEN
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
--> statement-breakpoint
CREATE OR REPLACE TRIGGER native_delegation_event_delivery AFTER INSERT ON app.domain_event_outbox
  FOR EACH ROW EXECUTE FUNCTION app.queue_native_delegation_event();
CREATE OR REPLACE TRIGGER native_delegation_project_change AFTER UPDATE OF version ON app.construction_projects
  FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version) EXECUTE FUNCTION app.emit_native_delegation_project_change();
CREATE OR REPLACE TRIGGER native_delegation_schedule_change AFTER INSERT OR UPDATE OR DELETE ON app.construction_plans
  FOR EACH ROW EXECUTE FUNCTION app.emit_native_schedule_change();
