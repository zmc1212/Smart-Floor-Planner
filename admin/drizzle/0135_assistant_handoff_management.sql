-- Resolve the real reception identity while preserving selected-tenant RLS.
-- Global managers act in the selected enterprise without a second staff account.
CREATE FUNCTION app.assistant_handoff_staff_identity(subject_id bigint, target_enterprise_id bigint)
RETURNS TABLE(id bigint, display_name text, username text, user_id bigint, role text)
LANGUAGE plpgsql AS $$
DECLARE previous_scope text;
BEGIN
  IF target_enterprise_id IS NULL OR target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN
    RETURN;
  END IF;

  previous_scope := current_setting('app.is_platform_admin', true);
  PERFORM set_config('app.is_platform_admin','true',true);
  RETURN QUERY
    SELECT a.id,a.display_name,a.username,a.user_id,a.role
    FROM app.admin_users a
    WHERE a.id=subject_id AND a.status='active' AND NOT a.must_change_password
      AND (a.role IN ('admin','super_admin')
        OR (a.enterprise_id=target_enterprise_id AND a.role IN ('designer','enterprise_admin')))
    FOR SHARE OF a;
  PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
  RAISE;
END $$;
REVOKE ALL ON FUNCTION app.assistant_handoff_staff_identity(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_handoff_staff_identity(bigint,bigint) TO sfp_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assistant_guard_conversation_staff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.assistant_conversations%ROWTYPE; h jsonb;
BEGIN
 IF NEW.admin_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM app.assistant_conversations WHERE enterprise_id=NEW.enterprise_id AND id=NEW.conversation_id;
 IF c.purpose='construction_followup' AND EXISTS(SELECT 1 FROM app.construction_followup_bindings b
   WHERE b.enterprise_id=NEW.enterprise_id AND b.conversation_id=NEW.conversation_id AND b.admin_id=NEW.admin_id) THEN
  IF TG_TABLE_NAME='assistant_participants' THEN
   IF NEW.participant_role<>'owner'
    OR (NEW.status='active' AND NOT app.assistant_followup_conversation_access('admin',NEW.admin_id,NEW.enterprise_id,NEW.conversation_id)) THEN
    RAISE EXCEPTION 'assistant private followup grant unavailable' USING ERRCODE='23514';
   END IF;
  ELSE
   IF c.status<>'open' OR c.mode<>'ai' OR NEW.author_kind<>'admin' OR NEW.purpose<>'reply'
    OR NOT app.assistant_followup_conversation_access('admin',NEW.admin_id,NEW.enterprise_id,NEW.conversation_id)
    OR NOT EXISTS(SELECT 1 FROM app.assistant_participants p WHERE p.enterprise_id=NEW.enterprise_id
      AND p.conversation_id=NEW.conversation_id AND p.admin_id=NEW.admin_id AND p.participant_role='owner' AND p.status='active') THEN
    RAISE EXCEPTION 'assistant private followup question unavailable' USING ERRCODE='23514';
   END IF;
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
 h:=c.entry_snapshot->'handoff';
 IF c.status<>'open' OR c.purpose NOT IN ('customer_consultation','construction_followup') OR h IS NULL
  OR NOT EXISTS(SELECT 1 FROM app.assistant_handoff_staff_identity(NEW.admin_id,NEW.enterprise_id)) THEN
  RAISE EXCEPTION 'assistant handoff grant unavailable' USING ERRCODE='23514';
 END IF;
 IF c.purpose='construction_followup' AND NOT EXISTS(
  SELECT 1 FROM app.construction_followup_bindings b
  WHERE b.enterprise_id=NEW.enterprise_id AND b.conversation_id=NEW.conversation_id AND b.audience='customer'
   AND app.assistant_followup_conversation_access('user',b.user_id,b.enterprise_id,b.conversation_id)) THEN
  RAISE EXCEPTION 'assistant private followup customer unavailable' USING ERRCODE='23514';
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
