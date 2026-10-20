-- A private batch groups original evaluations; runs/jobs/leases/usage remain authoritative.
CREATE TABLE app.assistant_knowledge_batches (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_by bigint NOT NULL REFERENCES app.admin_users(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','blocked','cancelled')),
 concurrency integer NOT NULL CHECK(concurrency BETWEEN 1 AND 3),
 configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 knowledge_epoch bigint NOT NULL, index_profile_id bigint NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 last_error text CHECK(last_error IS NULL OR length(last_error)<=80),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id),
 FOREIGN KEY(enterprise_id,index_profile_id) REFERENCES app.assistant_knowledge_index_profiles(enterprise_id,id)
);
CREATE TABLE app.assistant_knowledge_batch_items (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id), batch_id bigint NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20), evaluation_id bigint NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','submitted','cancelled')),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,batch_id,ordinal), UNIQUE(enterprise_id,evaluation_id),
 FOREIGN KEY(enterprise_id,batch_id) REFERENCES app.assistant_knowledge_batches(enterprise_id,id),
 FOREIGN KEY(enterprise_id,evaluation_id) REFERENCES app.assistant_knowledge_evaluations(enterprise_id,id)
);
CREATE INDEX assistant_knowledge_batch_owner ON app.assistant_knowledge_batches(enterprise_id,created_by,id DESC);
CREATE INDEX assistant_knowledge_batch_dispatch ON app.assistant_knowledge_batches(updated_at,id) WHERE state='active';
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assistant_knowledge_batches','assistant_knowledge_batch_items'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON app.%I USING(enterprise_id=app.current_enterprise_id() OR app.has_platform_access()) WITH CHECK(enterprise_id=app.current_enterprise_id() OR app.has_platform_access())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE app.%I TO sfp_app',t||'_id_seq');
 END LOOP;
END; $$;
CREATE TRIGGER assistant_batch_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,created_by ON app.assistant_knowledge_batches
 FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('created_by');
CREATE FUNCTION app.assistant_knowledge_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='assistant_knowledge_batches' THEN
  IF (NEW.enterprise_id,NEW.created_by,NEW.title,NEW.concurrency,NEW.configuration,NEW.knowledge_epoch,NEW.index_profile_id,NEW.created_at)
  IS DISTINCT FROM (OLD.enterprise_id,OLD.created_by,OLD.title,OLD.concurrency,OLD.configuration,OLD.knowledge_epoch,OLD.index_profile_id,OLD.created_at)
  OR (OLD.state='cancelled' AND NEW.state<>'cancelled') THEN RAISE EXCEPTION 'immutable knowledge batch snapshot'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND (NEW.enterprise_id,NEW.batch_id,NEW.ordinal,NEW.evaluation_id)
  IS DISTINCT FROM (OLD.enterprise_id,OLD.batch_id,OLD.ordinal,OLD.evaluation_id) THEN RAISE EXCEPTION 'immutable knowledge batch item'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.assistant_knowledge_batches b JOIN app.assistant_knowledge_evaluations e
   ON e.enterprise_id=b.enterprise_id AND e.created_by=b.created_by AND e.knowledge_epoch=b.knowledge_epoch
   WHERE b.enterprise_id=NEW.enterprise_id AND b.id=NEW.batch_id AND e.id=NEW.evaluation_id)
  THEN RAISE EXCEPTION 'knowledge batch owner or epoch mismatch'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER assistant_batch_immutable BEFORE UPDATE ON app.assistant_knowledge_batches
 FOR EACH ROW EXECUTE FUNCTION app.assistant_knowledge_batch_guard();
CREATE TRIGGER assistant_batch_item_guard BEFORE INSERT OR UPDATE ON app.assistant_knowledge_batch_items
 FOR EACH ROW EXECUTE FUNCTION app.assistant_knowledge_batch_guard();
