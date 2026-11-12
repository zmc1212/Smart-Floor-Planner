-- Keep original task IDs, history, message bindings and delivery state.
CREATE FUNCTION app.native_delegation_review_state(review_status text)
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
DO $integration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795248000000 AND hash IN ('45b8585507130396ca4659acc58f86a6bcdafa7b54dd5fa8a76f03f68a9e12a6','b0a4d1b61c85705f0ff2ba3d6fa3f0cca14e61165b2eb1feca22a44c67775d1d')) THEN
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
  ELSIF to_regclass('app.assistant_long_term_memories') IS NULL THEN
    RAISE EXCEPTION 'The applied XiaoK long-term memory table is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795075200000 AND hash IN ('86aabfda7cd31ce59aea2e68ab8ad93289293bd118b62202826f593e88635450','b49129c59fb74b0ec2ea0cf17facf9339c0a7c19053766a67bb5e01f82a31656')) AND NOT EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795248000000 AND hash IN ('45b8585507130396ca4659acc58f86a6bcdafa7b54dd5fa8a76f03f68a9e12a6','b0a4d1b61c85705f0ff2ba3d6fa3f0cca14e61165b2eb1feca22a44c67775d1d')) THEN
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
  END IF;
  IF EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795248000000 AND hash IN ('45b8585507130396ca4659acc58f86a6bcdafa7b54dd5fa8a76f03f68a9e12a6','b0a4d1b61c85705f0ff2ba3d6fa3f0cca14e61165b2eb1feca22a44c67775d1d')) THEN
    ALTER TABLE app.native_workflow_delegations
      ADD COLUMN requester_id bigint REFERENCES app.users(id),
      ADD COLUMN goal text,
      ADD COLUMN state text,
      ADD COLUMN tasks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tasks)='array'),
      ADD COLUMN latest_event_id bigint,
      ADD COLUMN paused_at timestamptz,
      ADD COLUMN cancelled_at timestamptz,
      ADD COLUMN expires_at timestamptz;
    -- Existing RLS policies stay in force. This transactional policy grants
    -- the migration role a backfill path only while holding the DDL lock.
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
      ADD CONSTRAINT native_workflow_delegations_state_check CHECK (state IN
        ('active','processing','waiting','blocked','awaiting_authorization','paused','completed','failed','cancelled','expired')),
      ADD CONSTRAINT native_workflow_delegations_origin_unique UNIQUE (enterprise_id,conversation_id,origin_message_id);
    ALTER TABLE app.native_workflow_delegation_events
      ADD COLUMN task_changes jsonb,
      ALTER COLUMN to_status DROP NOT NULL,
      ALTER COLUMN delegation_version DROP NOT NULL;
  ELSE
    ALTER TABLE app.native_workflow_delegations
      ADD COLUMN owner_id bigint REFERENCES app.users(id),
      ADD COLUMN title text,
      ADD COLUMN objective text,
      ADD COLUMN scope jsonb CHECK (jsonb_typeof(scope)='object'),
      ADD COLUMN completion_criteria text,
      ADD COLUMN current_status text CHECK (current_status IN
        ('pending','running','waiting_for_user','waiting_for_worker','waiting_for_designer','waiting_for_external',
         'waiting_for_authorization','failed','paused','cancelled','completed')),
      ADD COLUMN assigned_to bigint,
      ADD COLUMN waiting_for text,
      ADD COLUMN due_at timestamptz,
      ADD COLUMN evidence jsonb,
      ADD COLUMN version integer NOT NULL DEFAULT 1,
      ADD COLUMN operation_key text,
      ADD COLUMN reminder_stage integer NOT NULL DEFAULT 0 CHECK (reminder_stage BETWEEN 0 AND 2),
      ADD COLUMN completed_at timestamptz,
      ADD CONSTRAINT native_workflow_delegations_review_operation_unique UNIQUE (enterprise_id,owner_id,operation_key);
    ALTER TABLE app.native_workflow_delegation_events
      ALTER COLUMN task_changes DROP NOT NULL,
      ADD COLUMN from_status text,
      ADD COLUMN to_status text,
      ADD COLUMN delegation_version integer,
      ADD COLUMN receipt jsonb,
      DROP CONSTRAINT native_workflow_delegation_events_outcome_check,
      ADD CONSTRAINT native_workflow_delegation_events_outcome_check CHECK
        (outcome IN ('applied','unchanged','paused','unavailable','control','failed'));
  END IF;
  ALTER TABLE app.native_workflow_delegations ADD CONSTRAINT native_delegation_review_contract CHECK
    ((scope IS NULL AND current_status IS NULL AND owner_id IS NULL)
      OR (scope IS NOT NULL AND current_status IS NOT NULL AND owner_id IS NOT NULL AND owner_id=requester_id
        AND title IS NOT NULL AND objective IS NOT NULL AND completion_criteria IS NOT NULL AND due_at IS NOT NULL
        AND operation_key IS NOT NULL AND authorization_scope IS NOT NULL AND jsonb_typeof(authorization_scope)='object'
        AND state=app.native_delegation_review_state(current_status) AND ((current_status='completed')=(completed_at IS NOT NULL))));
  ALTER TABLE app.native_workflow_delegation_events ADD CONSTRAINT native_delegation_event_projection_check CHECK
    ((task_changes IS NOT NULL AND to_status IS NULL AND delegation_version IS NULL)
      OR (task_changes IS NULL AND to_status IS NOT NULL AND delegation_version IS NOT NULL));
END
$integration$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS native_delegation_project_scope ON app.native_workflow_delegations(enterprise_id,project_id,owner_id,updated_at DESC);
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
  RETURN NEW;
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
    WHERE d.enterprise_id=schedule.enterprise_id AND d.project_id=schedule.project_id AND d.scope IS NULL AND d.state NOT IN ('completed','failed','cancelled','expired')) THEN
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

DO $integration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='app.domain_event_outbox'::regclass
    AND tgname='native_delegation_event_delivery') THEN
    CREATE TRIGGER native_delegation_event_delivery AFTER INSERT ON app.domain_event_outbox
      FOR EACH ROW EXECUTE FUNCTION app.queue_native_delegation_event();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='app.construction_projects'::regclass
    AND tgname='native_delegation_project_change') THEN
    CREATE TRIGGER native_delegation_project_change AFTER UPDATE OF version ON app.construction_projects
      FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version) EXECUTE FUNCTION app.emit_native_delegation_project_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='app.construction_plans'::regclass
    AND tgname='native_delegation_schedule_change') THEN
    CREATE TRIGGER native_delegation_schedule_change AFTER INSERT OR UPDATE OR DELETE ON app.construction_plans
      FOR EACH ROW EXECUTE FUNCTION app.emit_native_schedule_change();
  END IF;
END
$integration$;
