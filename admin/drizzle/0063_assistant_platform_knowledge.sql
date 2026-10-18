-- Knowledge managers may be global platform admins or explicitly granted
-- enterprise admins. Expose only a boolean; hold the identity lock until commit.
CREATE FUNCTION app.assistant_knowledge_admin_is_current(subject_id bigint, target_enterprise_id bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE previous_scope text; matched bigint;
BEGIN
  IF NOT app.has_platform_access() AND target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN
    RETURN false;
  END IF;
  previous_scope := current_setting('app.is_platform_admin', true);
  PERFORM set_config('app.is_platform_admin','true',true);
  SELECT id INTO matched FROM app.admin_users
  WHERE id=subject_id AND status='active' AND must_change_password=false
    AND (role IN ('super_admin','admin') OR
      (role='enterprise_admin' AND enterprise_id=target_enterprise_id AND 'assistant-knowledge'=ANY(menu_permissions)))
  FOR SHARE;
  PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
  RETURN matched IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION app.assistant_knowledge_admin_is_current(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_knowledge_admin_is_current(bigint,bigint) TO sfp_app;
--> statement-breakpoint
-- Keep the actual operator ID for audit; never impersonate a tenant account.
-- Business-resource FKs stay composite. Only seven manager references become
-- global-ID FKs, with a tenant/role guard for every new or changed reference.
CREATE FUNCTION app.assistant_guard_manager_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name text; subject_id bigint; changed boolean;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    subject_id := (to_jsonb(NEW)->>field_name)::bigint;
    changed := TG_OP='INSERT';
    IF TG_OP='UPDATE' THEN
      changed := (to_jsonb(OLD)->>field_name) IS DISTINCT FROM (to_jsonb(NEW)->>field_name)
        OR OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id;
    END IF;
    IF changed AND subject_id IS NOT NULL AND NOT app.assistant_knowledge_admin_is_current(subject_id,NEW.enterprise_id) THEN
      RAISE EXCEPTION 'assistant manager does not have access to this enterprise' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.assistant_guard_manager_reference() FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE relation_name text; constraint_row record;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['assistant_knowledge_documents','assistant_knowledge_versions','assistant_jobs','assistant_participants','assistant_messages'] LOOP
    FOR constraint_row IN SELECT conname FROM pg_constraint
      WHERE conrelid=('app.'||relation_name)::regclass AND confrelid='app.admin_users'::regclass AND contype='f'
    LOOP
      EXECUTE format('ALTER TABLE app.%I DROP CONSTRAINT %I',relation_name,constraint_row.conname);
    END LOOP;
  END LOOP;
END;
$$;
ALTER TABLE app.assistant_knowledge_documents
  ADD CONSTRAINT assistant_document_creator_fk FOREIGN KEY(created_by) REFERENCES app.admin_users(id),
  ADD CONSTRAINT assistant_document_updater_fk FOREIGN KEY(updated_by) REFERENCES app.admin_users(id);
ALTER TABLE app.assistant_knowledge_versions
  ADD CONSTRAINT assistant_version_creator_fk FOREIGN KEY(created_by) REFERENCES app.admin_users(id),
  ADD CONSTRAINT assistant_version_publisher_fk FOREIGN KEY(published_by) REFERENCES app.admin_users(id);
ALTER TABLE app.assistant_jobs ADD CONSTRAINT assistant_job_requester_fk FOREIGN KEY(requested_by) REFERENCES app.admin_users(id);
ALTER TABLE app.assistant_participants ADD CONSTRAINT assistant_participant_admin_fk FOREIGN KEY(admin_id) REFERENCES app.admin_users(id);
ALTER TABLE app.assistant_messages ADD CONSTRAINT assistant_message_admin_fk FOREIGN KEY(admin_id) REFERENCES app.admin_users(id);
CREATE TRIGGER assistant_document_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,created_by,updated_by ON app.assistant_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('created_by','updated_by');
CREATE TRIGGER assistant_version_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,created_by,published_by ON app.assistant_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('created_by','published_by');
CREATE TRIGGER assistant_job_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,requested_by ON app.assistant_jobs
  FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('requested_by');
CREATE TRIGGER assistant_participant_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,admin_id ON app.assistant_participants
  FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('admin_id');
CREATE TRIGGER assistant_message_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,admin_id ON app.assistant_messages
  FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('admin_id');
