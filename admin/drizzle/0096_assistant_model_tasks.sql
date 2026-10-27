-- Native provider tasks are internal synthetic evaluation/generation only.
-- Provider attempts remain the original audit; this is not a second Agent.
CREATE TABLE app.assistant_model_tasks (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_by bigint NOT NULL REFERENCES app.admin_users(id),
 operation_key text NOT NULL CHECK(length(operation_key) BETWEEN 1 AND 128),
 kind text NOT NULL CHECK(kind IN ('offline_batch','public_search','draft_continuation')),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','uploading','uploaded','submitting','submitted','running','cancelling','completed','failed','cancelled','indeterminate')),
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 authorization_id text,
 reserved_tokens bigint NOT NULL CHECK(reserved_tokens>0),
 reserved_cost_micros bigint NOT NULL CHECK(reserved_cost_micros>0),
 input_file_id text, remote_batch_id text, remote_status text,
 last_error text, result jsonb, revoked_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,created_by,operation_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_attempts_enterprise_identity ON app.ai_provider_attempts(enterprise_id,id);
CREATE TABLE app.assistant_model_task_items (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id), task_id bigint NOT NULL,
 custom_id text NOT NULL CHECK(length(custom_id) BETWEEN 1 AND 64),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','submitted','succeeded','failed','unknown','cancelled')),
 attempt_id bigint, response_hash text, result jsonb,
 reserved_tokens bigint NOT NULL CHECK(reserved_tokens>0),
 reserved_cost_micros bigint NOT NULL CHECK(reserved_cost_micros>0),
 UNIQUE(enterprise_id,task_id,custom_id), UNIQUE(enterprise_id,attempt_id),
 FOREIGN KEY(enterprise_id,task_id) REFERENCES app.assistant_model_tasks(enterprise_id,id),
 FOREIGN KEY(enterprise_id,attempt_id) REFERENCES app.ai_provider_attempts(enterprise_id,id)
);
CREATE INDEX assistant_model_task_owner ON app.assistant_model_tasks(enterprise_id,created_by,id DESC);
CREATE TRIGGER assistant_model_task_manager BEFORE INSERT OR UPDATE OF enterprise_id,created_by ON app.assistant_model_tasks
 FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('created_by');
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assistant_model_tasks','assistant_model_task_items'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON app.%I USING(enterprise_id=app.current_enterprise_id() OR app.has_platform_access()) WITH CHECK(enterprise_id=app.current_enterprise_id() OR app.has_platform_access())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE app.%I TO sfp_app',t||'_id_seq');
 END LOOP;
END; $$;
CREATE FUNCTION app.assistant_model_task_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='assistant_model_tasks' THEN
  IF (NEW.enterprise_id,NEW.created_by,NEW.operation_key,NEW.kind,NEW.binding,NEW.request,NEW.request_hash,NEW.reserved_tokens,NEW.reserved_cost_micros,NEW.created_at)
   IS DISTINCT FROM (OLD.enterprise_id,OLD.created_by,OLD.operation_key,OLD.kind,OLD.binding,OLD.request,OLD.request_hash,OLD.reserved_tokens,OLD.reserved_cost_micros,OLD.created_at)
   OR OLD.authorization_id IS NOT NULL AND NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
   OR OLD.input_file_id IS NOT NULL AND NEW.input_file_id IS DISTINCT FROM OLD.input_file_id
   OR OLD.remote_batch_id IS NOT NULL AND NEW.remote_batch_id IS DISTINCT FROM OLD.remote_batch_id
   OR OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
   THEN RAISE EXCEPTION 'immutable model task binding'; END IF;
 ELSE
  IF (NEW.enterprise_id,NEW.task_id,NEW.custom_id,NEW.request,NEW.reserved_tokens,NEW.reserved_cost_micros)
   IS DISTINCT FROM (OLD.enterprise_id,OLD.task_id,OLD.custom_id,OLD.request,OLD.reserved_tokens,OLD.reserved_cost_micros)
   OR OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
   OR OLD.response_hash IS NOT NULL AND (NEW.response_hash,NEW.result,NEW.state) IS DISTINCT FROM (OLD.response_hash,OLD.result,OLD.state)
   THEN RAISE EXCEPTION 'immutable model task item'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER assistant_model_task_immutable BEFORE UPDATE ON app.assistant_model_tasks
 FOR EACH ROW EXECUTE FUNCTION app.assistant_model_task_immutable();
CREATE TRIGGER assistant_model_task_item_immutable BEFORE UPDATE ON app.assistant_model_task_items
 FOR EACH ROW EXECUTE FUNCTION app.assistant_model_task_immutable();
