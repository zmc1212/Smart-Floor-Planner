-- Share the existing durable tasks, immutable snapshots, forced tenant RLS,
-- provider attempts and enterprise cleanup; do not add a content/Agent store.
ALTER TABLE app.assistant_model_tasks DROP CONSTRAINT assistant_model_tasks_kind_check;
ALTER TABLE app.assistant_model_tasks ADD CONSTRAINT assistant_model_tasks_kind_check
 CHECK(kind IN ('offline_batch','public_search','draft_continuation','portfolio_copy'));
DROP TRIGGER assistant_model_task_manager ON app.assistant_model_tasks;
CREATE TRIGGER assistant_model_task_manager BEFORE INSERT OR UPDATE OF enterprise_id,created_by ON app.assistant_model_tasks
 FOR EACH ROW WHEN (NEW.kind<>'portfolio_copy') EXECUTE FUNCTION app.assistant_guard_manager_reference('created_by');
CREATE FUNCTION app.portfolio_copy_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF app.portfolio_actor_access(NEW.created_by,NEW.enterprise_id) IS NULL THEN
  RAISE EXCEPTION 'invalid portfolio task actor';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER portfolio_copy_actor_guard BEFORE INSERT OR UPDATE OF enterprise_id,created_by ON app.assistant_model_tasks
 FOR EACH ROW WHEN (NEW.kind='portfolio_copy') EXECUTE FUNCTION app.portfolio_copy_actor_guard();
CREATE INDEX portfolio_copy_pending ON app.assistant_model_tasks(kind,state,updated_at,id) WHERE kind='portfolio_copy';
