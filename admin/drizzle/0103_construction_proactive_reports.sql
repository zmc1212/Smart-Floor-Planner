-- V1-02 independent deterministic foundation. Disabled until explicitly configured.
ALTER TABLE app.assistant_conversations DROP CONSTRAINT assistant_conversations_purpose_check;
ALTER TABLE app.assistant_conversations ADD CONSTRAINT assistant_conversations_purpose_check
 CHECK(purpose IN ('customer_consultation','knowledge_preview','project_collaboration','construction_followup'));
DROP INDEX app.assistant_run_active;
CREATE UNIQUE INDEX assistant_run_active ON app.assistant_runs(enterprise_id,conversation_id)
 WHERE status IN ('queued','running') AND purpose NOT IN ('site.record','construction.report.facts');

CREATE TABLE app.construction_report_settings (
 enterprise_id bigint PRIMARY KEY REFERENCES app.enterprises(id), enabled boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK(timezone='Asia/Shanghai'),
 daily_time text NOT NULL DEFAULT '20:00' CHECK(daily_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 weekly_time text NOT NULL DEFAULT '08:00' CHECK(weekly_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 project_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(project_ids)='array'),
 stage_keys jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(stage_keys)='array'),
 next_daily_at timestamptz NOT NULL, next_weekly_at timestamptz NOT NULL,
 stage_cursor bigint NOT NULL DEFAULT 0, last_error text, last_tick_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.construction_followup_bindings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 principal_key text NOT NULL, audience text NOT NULL CHECK(audience IN ('customer','worker','designer','boss')),
 user_id bigint REFERENCES app.users(id), admin_id bigint REFERENCES app.admin_users(id), project_id bigint,
 scope_key text NOT NULL, conversation_id bigint NOT NULL,
 status text NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','stopped','deleted')),
 last_read_seq bigint NOT NULL DEFAULT 0 CHECK(last_read_seq>=0),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,principal_key,audience,scope_key), UNIQUE(enterprise_id,conversation_id),
 CHECK((audience='customer' AND user_id IS NOT NULL AND admin_id IS NULL AND project_id IS NOT NULL AND principal_key='user:'||user_id::text AND scope_key='project:'||project_id::text)
  OR (audience<>'customer' AND user_id IS NULL AND admin_id IS NOT NULL AND project_id IS NULL AND principal_key='admin:'||admin_id::text AND scope_key='enterprise')),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id)
);
CREATE TABLE app.construction_reports (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, binding_id bigint NOT NULL,
 report_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('daily','weekly','stage')),
 period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, cutoff_at timestamptz NOT NULL,
 scheduled_at timestamptz NOT NULL, stage_event_id bigint, latest_revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(period_start<=period_end AND period_end<=cutoff_at),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,binding_id,report_key),
 FOREIGN KEY(enterprise_id,binding_id) REFERENCES app.construction_followup_bindings(enterprise_id,id),
 FOREIGN KEY(enterprise_id,stage_event_id) REFERENCES app.domain_event_outbox(enterprise_id,id)
);
CREATE TABLE app.construction_report_versions (
 enterprise_id bigint NOT NULL, report_id bigint NOT NULL, revision integer NOT NULL CHECK(revision>0),
 run_id bigint NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','facts_ready')),
 facts jsonb, facts_hash text, generated_at timestamptz, period_end timestamptz NOT NULL, cutoff_at timestamptz NOT NULL,
 knowledge_status text NOT NULL DEFAULT 'not_generated' CHECK(knowledge_status='not_generated'),
 PRIMARY KEY(enterprise_id,report_id,revision), UNIQUE(enterprise_id,run_id),
 FOREIGN KEY(enterprise_id,report_id) REFERENCES app.construction_reports(enterprise_id,id),
 FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id),
 CHECK((status='facts_ready')=(facts IS NOT NULL AND facts_hash IS NOT NULL AND generated_at IS NOT NULL))
);
CREATE TABLE app.construction_report_deliveries (
 enterprise_id bigint NOT NULL, report_id bigint NOT NULL, revision integer NOT NULL, binding_id bigint NOT NULL,
 event_id bigint NOT NULL, message_id bigint, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','held','delivered','revoked')),
 delivered_at timestamptz, read_at timestamptz,
 PRIMARY KEY(enterprise_id,report_id,revision,binding_id),
 FOREIGN KEY(enterprise_id,report_id,revision) REFERENCES app.construction_report_versions(enterprise_id,report_id,revision),
 FOREIGN KEY(enterprise_id,binding_id) REFERENCES app.construction_followup_bindings(enterprise_id,id),
 FOREIGN KEY(enterprise_id,event_id) REFERENCES app.domain_event_outbox(enterprise_id,id),
 FOREIGN KEY(enterprise_id,message_id) REFERENCES app.assistant_messages(enterprise_id,id),
 CHECK((state='delivered')=(message_id IS NOT NULL AND delivered_at IS NOT NULL))
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_report_settings','construction_followup_bindings','construction_reports','construction_report_versions','construction_report_deliveries'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;

-- Background work has no browser/password session. Delegate to the existing
-- Web or current phone-authorized construction policy; do not grant preview access.
CREATE FUNCTION app.construction_followup_staff_access(subject_id bigint,target_enterprise_id bigint)
 RETURNS text LANGUAGE plpgsql AS $$
DECLARE access_role text; uid bigint; cv integer; previous_scope text;
BEGIN
 IF target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN NULL; END IF;
 access_role:=app.construction_actor_access(subject_id,target_enterprise_id);
 IF access_role IS NOT NULL THEN RETURN access_role; END IF;
 SELECT user_id INTO uid FROM app.admin_users WHERE id=subject_id AND enterprise_id=target_enterprise_id AND status='active' FOR SHARE;
 IF uid IS NULL THEN RETURN NULL; END IF;
 previous_scope:=current_setting('app.is_platform_admin',true);
 PERFORM set_config('app.is_platform_admin','true',true);
 SELECT context_version INTO cv FROM app.users WHERE id=uid FOR SHARE;
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
 RETURN app.construction_miniprogram_access(subject_id,target_enterprise_id,uid,cv);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true); RAISE;
END $$;

CREATE FUNCTION app.assistant_followup_conversation_access(subject_kind text,subject_id bigint,target_enterprise_id bigint,target_conversation_id bigint)
 RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE b app.construction_followup_bindings%ROWTYPE; access_role text; staff_role text;
BEGIN
 IF target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.enterprises WHERE id=target_enterprise_id AND status='active' FOR SHARE) THEN RETURN false; END IF;
 SELECT binding.* INTO b FROM app.construction_followup_bindings binding
 JOIN app.assistant_conversations c ON c.enterprise_id=binding.enterprise_id AND c.id=binding.conversation_id
 WHERE binding.enterprise_id=target_enterprise_id AND binding.conversation_id=target_conversation_id
 AND binding.principal_key=subject_kind||':'||subject_id::text AND binding.status<>'deleted'
 AND c.purpose='construction_followup' AND c.status<>'closed' FOR SHARE OF binding;
 IF NOT FOUND THEN RETURN false; END IF;
 IF subject_kind='user' THEN
  RETURN EXISTS(SELECT 1 FROM app.construction_projects p JOIN app.leads l ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
   WHERE p.enterprise_id=target_enterprise_id AND p.id=b.project_id AND p.status<>'archived' AND p.customer_access
   AND l.customer_user_id=subject_id AND l.archived_at IS NULL FOR SHARE OF p,l);
 END IF;
 access_role:=app.construction_followup_staff_access(subject_id,target_enterprise_id);
 IF access_role IS NULL THEN RETURN false; END IF;
 IF b.audience='boss' THEN RETURN access_role='owner'; END IF;
 IF access_role='owner' THEN RETURN false; END IF;
 SELECT role INTO staff_role FROM app.admin_users WHERE id=subject_id AND enterprise_id=target_enterprise_id AND status='active' FOR SHARE;
 IF (b.audience='designer' AND staff_role<>'designer') OR (b.audience='worker' AND staff_role<>'construction_staff') THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM app.construction_projects p JOIN app.leads l ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
  JOIN app.construction_members m ON m.enterprise_id=p.enterprise_id AND m.project_id=p.id AND m.admin_id=subject_id AND m.active
  WHERE p.enterprise_id=target_enterprise_id AND p.status<>'archived' AND l.archived_at IS NULL FOR SHARE OF p,l,m);
END $$;
REVOKE ALL ON FUNCTION app.construction_followup_staff_access(bigint,bigint),app.assistant_followup_conversation_access(text,bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.construction_followup_staff_access(bigint,bigint),app.assistant_followup_conversation_access(text,bigint,bigint,bigint) TO sfp_app;

-- The established trigger remains authoritative for every other conversation.
CREATE OR REPLACE FUNCTION app.assistant_guard_conversation_staff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.assistant_conversations%ROWTYPE; a app.admin_users%ROWTYPE; h jsonb;
BEGIN
 IF NEW.admin_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM app.assistant_conversations WHERE enterprise_id=NEW.enterprise_id AND id=NEW.conversation_id;
 IF c.purpose='construction_followup' THEN
  IF TG_TABLE_NAME<>'assistant_participants' THEN
   RAISE EXCEPTION 'assistant private followup user message not enabled' USING ERRCODE='23514';
  END IF;
  IF NEW.participant_role<>'owner'
   OR NOT EXISTS(SELECT 1 FROM app.construction_followup_bindings b WHERE b.enterprise_id=NEW.enterprise_id AND b.conversation_id=NEW.conversation_id AND b.admin_id=NEW.admin_id)
   OR (NEW.status='active' AND NOT app.assistant_followup_conversation_access('admin',NEW.admin_id,NEW.enterprise_id,NEW.conversation_id)) THEN
   RAISE EXCEPTION 'assistant private followup grant unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF c.purpose='project_collaboration' THEN
  IF TG_TABLE_NAME<>'assistant_messages' OR NOT EXISTS(
   SELECT 1 FROM app.construction_chats cc JOIN app.construction_projects p ON p.enterprise_id=cc.enterprise_id AND p.id=cc.project_id
   JOIN app.leads l ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
   LEFT JOIN app.construction_members m ON m.enterprise_id=p.enterprise_id AND m.project_id=p.id AND m.admin_id=NEW.admin_id AND m.active
   LEFT JOIN app.admin_users staff ON staff.enterprise_id=p.enterprise_id AND staff.id=NEW.admin_id AND staff.status='active'
   WHERE cc.enterprise_id=NEW.enterprise_id AND cc.conversation_id=NEW.conversation_id AND p.status='active' AND l.archived_at IS NULL
   AND (app.construction_actor_access(NEW.admin_id,NEW.enterprise_id)='owner'
     OR (staff.id IS NOT NULL AND (staff.role='enterprise_admin' OR (m.admin_id IS NOT NULL AND m.role<>'observer'))))) THEN
   RAISE EXCEPTION 'assistant shared project grant unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF c.purpose='knowledge_preview' THEN
  IF NOT app.assistant_knowledge_admin_is_current(NEW.admin_id,NEW.enterprise_id) THEN
   RAISE EXCEPTION 'assistant manager does not have access to this enterprise' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='assistant_participants' AND to_jsonb(NEW)->>'status'='revoked' THEN RETURN NEW; END IF;
 SELECT * INTO a FROM app.admin_users WHERE id=NEW.admin_id AND enterprise_id=NEW.enterprise_id AND status='active' AND role IN ('designer','enterprise_admin') AND must_change_password=false FOR SHARE;
 h:=c.entry_snapshot->'handoff';
 IF a.id IS NULL OR c.status<>'open' OR c.purpose<>'customer_consultation' OR h IS NULL THEN
  RAISE EXCEPTION 'assistant handoff grant unavailable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='assistant_participants' THEN
  IF NEW.participant_role<>'handoff_staff' OR h->>'state' NOT IN ('waiting','active')
   OR (h->>'recipientId' IS NOT NULL AND h->>'recipientId'<>NEW.admin_id::text)
   OR (h->>'state'='active' AND h->>'ownerId' IS DISTINCT FROM NEW.admin_id::text)
   OR NEW.grant_basis->>'requestId' IS DISTINCT FROM h->>'requestId' THEN
   RAISE EXCEPTION 'assistant handoff consent mismatch' USING ERRCODE='23514';
  END IF;
 ELSE
  IF c.mode<>'human' OR h->>'state'<>'active' OR h->>'ownerId' IS DISTINCT FROM NEW.admin_id::text
   OR NOT EXISTS(SELECT 1 FROM app.assistant_participants p WHERE p.enterprise_id=NEW.enterprise_id AND p.conversation_id=NEW.conversation_id AND p.admin_id=NEW.admin_id AND p.participant_role='handoff_staff' AND p.status='active') THEN
   RAISE EXCEPTION 'assistant human reply unavailable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
