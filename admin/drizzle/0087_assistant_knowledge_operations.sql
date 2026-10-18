-- Curated enterprise questions and private links to the existing preview/Worker protocol.
CREATE TABLE app.assistant_knowledge_cases (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 question text NOT NULL CHECK(length(question) BETWEEN 1 AND 2000),
 expectation jsonb NOT NULL CHECK(jsonb_typeof(expectation)='object'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 gap_status text NOT NULL DEFAULT 'open' CHECK(gap_status IN ('open','verified')),
 gap_note text NOT NULL DEFAULT '' CHECK(length(gap_note)<=2000), verified_epoch bigint,
 created_by bigint NOT NULL REFERENCES app.admin_users(id), updated_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id)
);
CREATE TABLE app.assistant_knowledge_evaluations (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id), case_id bigint NOT NULL,
 case_revision integer NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 knowledge_epoch bigint NOT NULL, created_by bigint NOT NULL REFERENCES app.admin_users(id),
 create_key uuid NOT NULL, send_key uuid NOT NULL, conversation_id bigint, run_id bigint,
 review jsonb CHECK(review IS NULL OR jsonb_typeof(review)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,create_key), UNIQUE(enterprise_id,send_key),
 FOREIGN KEY(enterprise_id,case_id) REFERENCES app.assistant_knowledge_cases(enterprise_id,id),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
 FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id)
);
CREATE INDEX assistant_evaluation_case_owner ON app.assistant_knowledge_evaluations(enterprise_id,case_id,created_by,id DESC);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assistant_knowledge_cases','assistant_knowledge_evaluations'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON app.%I USING(enterprise_id=app.current_enterprise_id() OR app.has_platform_access()) WITH CHECK(enterprise_id=app.current_enterprise_id() OR app.has_platform_access())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE app.%I TO sfp_app',t||'_id_seq');
 END LOOP;
END; $$;
CREATE TRIGGER assistant_case_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,created_by,updated_by ON app.assistant_knowledge_cases
 FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('created_by','updated_by');
CREATE TRIGGER assistant_evaluation_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,created_by ON app.assistant_knowledge_evaluations
 FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('created_by');
CREATE FUNCTION app.assistant_evaluation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.enterprise_id,NEW.case_id,NEW.case_revision,NEW.snapshot,NEW.knowledge_epoch,NEW.created_by,NEW.create_key,NEW.send_key,NEW.created_at)
 IS DISTINCT FROM (OLD.enterprise_id,OLD.case_id,OLD.case_revision,OLD.snapshot,OLD.knowledge_epoch,OLD.created_by,OLD.create_key,OLD.send_key,OLD.created_at)
 OR (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS DISTINCT FROM OLD.conversation_id)
 OR (OLD.run_id IS NOT NULL AND NEW.run_id IS DISTINCT FROM OLD.run_id)
 THEN RAISE EXCEPTION 'immutable knowledge evaluation snapshot'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER assistant_evaluation_immutable BEFORE UPDATE ON app.assistant_knowledge_evaluations
 FOR EACH ROW EXECUTE FUNCTION app.assistant_evaluation_immutable();
