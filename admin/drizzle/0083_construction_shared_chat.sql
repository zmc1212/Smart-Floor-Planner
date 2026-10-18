-- P4A: one shared internal conversation per project; customer consultation stays private.
ALTER TABLE app.assistant_conversations DROP CONSTRAINT assistant_conversations_purpose_check;
ALTER TABLE app.assistant_conversations ADD CONSTRAINT assistant_conversations_purpose_check
 CHECK(purpose IN ('customer_consultation','knowledge_preview','project_collaboration'));
DROP INDEX app.assistant_run_active;
CREATE UNIQUE INDEX assistant_run_active ON app.assistant_runs(enterprise_id,conversation_id)
 WHERE status IN ('queued','running') AND purpose<>'site.record';

CREATE TABLE app.construction_chats (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, conversation_id bigint NOT NULL,
 PRIMARY KEY(enterprise_id,project_id), UNIQUE(enterprise_id,conversation_id), UNIQUE(enterprise_id,project_id,conversation_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id)
);
CREATE TABLE app.construction_site_media (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 uploader_id bigint NOT NULL, request_key text NOT NULL, source_hash text NOT NULL, mime_type text NOT NULL CHECK(mime_type='image/jpeg'),
 width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0), byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 4194304),
 data bytea, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(enterprise_id,project_id,id), UNIQUE(enterprise_id,project_id,uploader_id,request_key),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(uploader_id) REFERENCES app.admin_users(id),
 CHECK((deleted_at IS NULL)=(data IS NOT NULL))
);
CREATE TABLE app.construction_site_records (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 conversation_id bigint NOT NULL, source_message_id bigint, author_id bigint NOT NULL, run_id bigint,
 status text NOT NULL DEFAULT 'organizing' CHECK(status IN ('organizing','draft','published','withdrawn')),
 data jsonb NOT NULL DEFAULT '{}', room_id bigint, room_name_snapshot text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 audience text NOT NULL DEFAULT 'internal' CHECK(audience IN ('internal','customer')), published_version integer, published_customer_id bigint REFERENCES app.users(id),
 approved_by bigint, published_at timestamptz, withdrawal_reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,project_id,id), UNIQUE(enterprise_id,run_id), UNIQUE(enterprise_id,source_message_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,conversation_id) REFERENCES app.construction_chats(enterprise_id,project_id,conversation_id),
 FOREIGN KEY(enterprise_id,conversation_id,source_message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id) ON DELETE SET NULL(source_message_id),
 FOREIGN KEY(author_id) REFERENCES app.admin_users(id),
 FOREIGN KEY(approved_by) REFERENCES app.admin_users(id),
 FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id) ON DELETE SET NULL(run_id),
 FOREIGN KEY(enterprise_id,project_id,room_id) REFERENCES app.construction_rooms(enterprise_id,project_id,id),
 CHECK((status='published')=(published_version IS NOT NULL)),
 CHECK(audience<>'customer' OR (status='published' AND published_customer_id IS NOT NULL)),
 CHECK(status<>'published' OR (approved_by IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE app.construction_site_record_versions (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, record_id bigint NOT NULL, version integer NOT NULL,
 actor_id bigint NOT NULL, action text NOT NULL CHECK(action IN ('organized','edit','publish','withdraw')),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(enterprise_id,project_id,record_id,version),
 FOREIGN KEY(enterprise_id,project_id,record_id) REFERENCES app.construction_site_records(enterprise_id,project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(actor_id) REFERENCES app.admin_users(id)
);
CREATE TABLE app.construction_site_attachments (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, record_id bigint NOT NULL, media_id bigint NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 3),
 PRIMARY KEY(enterprise_id,project_id,record_id,media_id), UNIQUE(enterprise_id,project_id,media_id), UNIQUE(enterprise_id,project_id,record_id,position),
 FOREIGN KEY(enterprise_id,project_id,record_id) REFERENCES app.construction_site_records(enterprise_id,project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,media_id) REFERENCES app.construction_site_media(enterprise_id,project_id,id)
);
CREATE TABLE app.construction_watches (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 customer_id bigint NOT NULL REFERENCES app.users(id), room_id bigint, room_name_snapshot text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, photos_only boolean NOT NULL DEFAULT true,
 source_message_id bigint REFERENCES app.assistant_messages(id) ON DELETE SET NULL, started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT(enterprise_id,project_id,customer_id,room_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,room_id) REFERENCES app.construction_rooms(enterprise_id,project_id,id)
);
CREATE INDEX construction_site_records_history ON app.construction_site_records(enterprise_id,project_id,id DESC);
CREATE INDEX construction_watches_customer ON app.construction_watches(enterprise_id,customer_id) WHERE active;

-- Database adapters expose a generic shared-conversation policy to the assistant core.
-- No caller can use this capability to read a customer consultation or knowledge preview.
CREATE FUNCTION app.assistant_shared_actor_access(subject_id bigint,target_enterprise_id bigint,subject_user_id bigint,subject_context_version integer)
 RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 IF target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.enterprises WHERE id=target_enterprise_id AND status='active' FOR SHARE) THEN RETURN false; END IF;
 RETURN CASE WHEN subject_user_id IS NULL THEN app.construction_actor_access(subject_id,target_enterprise_id)
  ELSE app.construction_miniprogram_access(subject_id,target_enterprise_id,subject_user_id,subject_context_version) END IS NOT NULL;
END $$;
CREATE FUNCTION app.assistant_shared_conversation_access(subject_id bigint,target_enterprise_id bigint,target_conversation_id bigint,subject_user_id bigint,subject_context_version integer)
 RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE project app.construction_projects%ROWTYPE; access_role text;
BEGIN
 IF target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN false; END IF;
 -- Construction APIs already validate the signed Mini identity; this function also rechecks live staff/menu access.
 access_role:=CASE WHEN subject_user_id IS NULL THEN app.construction_actor_access(subject_id,target_enterprise_id)
  ELSE app.construction_miniprogram_access(subject_id,target_enterprise_id,subject_user_id,subject_context_version) END;
 IF access_role IS NULL THEN RETURN false; END IF;
 SELECT p.* INTO project FROM app.construction_projects p JOIN app.construction_chats c ON c.enterprise_id=p.enterprise_id AND c.project_id=p.id
  JOIN app.leads l ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
  WHERE c.enterprise_id=target_enterprise_id AND c.conversation_id=target_conversation_id AND p.status<>'archived' AND l.archived_at IS NULL FOR SHARE OF p,l;
 IF NOT FOUND THEN RETURN false; END IF;
 IF access_role='owner' THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM app.construction_members WHERE enterprise_id=target_enterprise_id AND project_id=project.id AND admin_id=subject_id AND active FOR SHARE);
END $$;
REVOKE ALL ON FUNCTION app.assistant_shared_actor_access(bigint,bigint,bigint,integer),app.assistant_shared_conversation_access(bigint,bigint,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_shared_actor_access(bigint,bigint,bigint,integer),app.assistant_shared_conversation_access(bigint,bigint,bigint,bigint,integer) TO sfp_app;

-- Keep both existing private-consultation/preview guards; shared messages use project authority.
CREATE OR REPLACE FUNCTION app.assistant_guard_conversation_staff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.assistant_conversations%ROWTYPE; a app.admin_users%ROWTYPE; h jsonb;
BEGIN
 IF NEW.admin_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM app.assistant_conversations WHERE enterprise_id=NEW.enterprise_id AND id=NEW.conversation_id;
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

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_chats','construction_site_media','construction_site_records','construction_site_record_versions','construction_site_attachments','construction_watches'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
