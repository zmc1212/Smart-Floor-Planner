-- Customer-authorized human participation is distinct from knowledge management.
CREATE FUNCTION app.assistant_guard_conversation_staff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.assistant_conversations%ROWTYPE; a app.admin_users%ROWTYPE; h jsonb;
BEGIN
  IF NEW.admin_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO c FROM app.assistant_conversations WHERE enterprise_id=NEW.enterprise_id AND id=NEW.conversation_id;
  IF c.purpose='knowledge_preview' THEN
    IF NOT app.assistant_knowledge_admin_is_current(NEW.admin_id,NEW.enterprise_id) THEN
      RAISE EXCEPTION 'assistant manager does not have access to this enterprise' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  -- Revocation must remain possible after an employee leaves.
  IF TG_TABLE_NAME='assistant_participants' AND to_jsonb(NEW)->>'status'='revoked' THEN RETURN NEW; END IF;
  SELECT * INTO a FROM app.admin_users WHERE id=NEW.admin_id AND enterprise_id=NEW.enterprise_id
    AND status='active' AND role IN ('designer','enterprise_admin') AND must_change_password=false FOR SHARE;
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
      OR NOT EXISTS(SELECT 1 FROM app.assistant_participants p WHERE p.enterprise_id=NEW.enterprise_id AND p.conversation_id=NEW.conversation_id
        AND p.admin_id=NEW.admin_id AND p.participant_role='handoff_staff' AND p.status='active') THEN
      RAISE EXCEPTION 'assistant human reply unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.assistant_guard_conversation_staff() FROM PUBLIC;
DROP TRIGGER assistant_participant_manager_reference ON app.assistant_participants;
DROP TRIGGER assistant_message_manager_reference ON app.assistant_messages;
CREATE TRIGGER assistant_participant_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,admin_id,status,participant_role,grant_basis ON app.assistant_participants
  FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_conversation_staff();
CREATE TRIGGER assistant_message_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,admin_id,conversation_id ON app.assistant_messages
  FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_conversation_staff();
