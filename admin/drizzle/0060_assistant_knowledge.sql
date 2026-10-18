-- Requires the validated PG17/pgvector image. Explicit migration only; never install at app startup.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE app.assistant_knowledge_index_profiles (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 profile_key text NOT NULL, configuration jsonb NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,profile_key)
);
CREATE TABLE app.assistant_knowledge_documents (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), category text NOT NULL DEFAULT '',
 source_type text NOT NULL CHECK(source_type IN ('faq','manual_text')), audience text NOT NULL CHECK(audience IN ('customer_public','staff_internal')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')), published_version_id bigint,
 version integer NOT NULL DEFAULT 1, created_by bigint NOT NULL, updated_by bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), FOREIGN KEY(enterprise_id,created_by) REFERENCES app.admin_users(enterprise_id,id),
 FOREIGN KEY(enterprise_id,updated_by) REFERENCES app.admin_users(enterprise_id,id)
);
CREATE TABLE app.assistant_knowledge_versions (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id), document_id bigint NOT NULL,
 version_number integer NOT NULL, body text NOT NULL DEFAULT '', faq jsonb NOT NULL DEFAULT '[]', content_hash text NOT NULL,
 edit_version integer NOT NULL DEFAULT 1, index_status text NOT NULL DEFAULT 'pending' CHECK(index_status IN ('pending','indexing','ready','failed')),
 index_profile_id bigint, indexed_hash text, chunk_count integer NOT NULL DEFAULT 0,
 effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz, published_at timestamptz, published_by bigint,
 created_by bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_to IS NULL OR effective_to>effective_from), CHECK(length(body)<=16000), CHECK(jsonb_typeof(faq)='array'),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,document_id,id), UNIQUE(enterprise_id,document_id,version_number),
 FOREIGN KEY(enterprise_id,document_id) REFERENCES app.assistant_knowledge_documents(enterprise_id,id),
 FOREIGN KEY(enterprise_id,index_profile_id) REFERENCES app.assistant_knowledge_index_profiles(enterprise_id,id),
 FOREIGN KEY(enterprise_id,created_by) REFERENCES app.admin_users(enterprise_id,id),
 FOREIGN KEY(enterprise_id,published_by) REFERENCES app.admin_users(enterprise_id,id)
);
ALTER TABLE app.assistant_knowledge_documents ADD CONSTRAINT assistant_document_published_version_fk
 FOREIGN KEY(enterprise_id,id,published_version_id) REFERENCES app.assistant_knowledge_versions(enterprise_id,document_id,id);
CREATE TABLE app.assistant_knowledge_chunks (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 document_version_id bigint NOT NULL, index_profile_id bigint NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0),
 text text NOT NULL, text_hash text NOT NULL, content_hash text NOT NULL, locator jsonb NOT NULL,
 terms text[] NOT NULL, embedding vector(1024) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,document_version_id,index_profile_id,ordinal),
 FOREIGN KEY(enterprise_id,document_version_id) REFERENCES app.assistant_knowledge_versions(enterprise_id,id),
 FOREIGN KEY(enterprise_id,index_profile_id) REFERENCES app.assistant_knowledge_index_profiles(enterprise_id,id)
);
ALTER TABLE app.assistant_enterprise_settings ADD COLUMN active_index_profile_id bigint;
ALTER TABLE app.assistant_enterprise_settings ADD FOREIGN KEY(enterprise_id,active_index_profile_id) REFERENCES app.assistant_knowledge_index_profiles(enterprise_id,id);
ALTER TABLE app.assistant_jobs DROP CONSTRAINT assistant_jobs_kind_check;
ALTER TABLE app.assistant_jobs ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE app.assistant_jobs ADD COLUMN knowledge_version_id bigint;
ALTER TABLE app.assistant_jobs ADD COLUMN index_profile_id bigint;
ALTER TABLE app.assistant_jobs ADD COLUMN content_hash text;
ALTER TABLE app.assistant_jobs ADD COLUMN knowledge_edit_version integer;
ALTER TABLE app.assistant_jobs ADD COLUMN requested_by bigint;
ALTER TABLE app.assistant_jobs ADD CONSTRAINT assistant_job_target CHECK(
 (kind='chat_turn' AND run_id IS NOT NULL AND knowledge_version_id IS NULL AND index_profile_id IS NULL AND requested_by IS NULL)
 OR (kind='knowledge_index' AND run_id IS NULL AND knowledge_version_id IS NOT NULL AND index_profile_id IS NOT NULL AND content_hash IS NOT NULL AND requested_by IS NOT NULL));
ALTER TABLE app.assistant_jobs ADD FOREIGN KEY(enterprise_id,knowledge_version_id) REFERENCES app.assistant_knowledge_versions(enterprise_id,id);
ALTER TABLE app.assistant_jobs ADD FOREIGN KEY(enterprise_id,index_profile_id) REFERENCES app.assistant_knowledge_index_profiles(enterprise_id,id);
ALTER TABLE app.assistant_jobs ADD FOREIGN KEY(enterprise_id,requested_by) REFERENCES app.admin_users(enterprise_id,id);
CREATE TABLE app.assistant_knowledge_attempts (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id), job_id bigint NOT NULL,
 lease_token text NOT NULL, operation text NOT NULL CHECK(operation IN ('chunk','embed')), batch_ordinal integer NOT NULL,
 profile_key text NOT NULL, model_revision text NOT NULL, status text NOT NULL CHECK(status IN ('started','succeeded','failed','unknown')),
 input_tokens bigint, error_code text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,job_id,lease_token,operation,batch_ordinal),
 FOREIGN KEY(enterprise_id,job_id) REFERENCES app.assistant_jobs(enterprise_id,id),
 CHECK(input_tokens IS NULL OR input_tokens>=0)
);
ALTER TABLE app.ai_provider_attempts ADD FOREIGN KEY(enterprise_id,knowledge_job_id) REFERENCES app.assistant_jobs(enterprise_id,id);
CREATE INDEX assistant_chunks_version_profile ON app.assistant_knowledge_chunks(enterprise_id,document_version_id,index_profile_id);
CREATE INDEX assistant_knowledge_document_list ON app.assistant_knowledge_documents(enterprise_id,id DESC);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assistant_knowledge_index_profiles','assistant_knowledge_documents','assistant_knowledge_versions','assistant_knowledge_chunks','assistant_knowledge_attempts'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))',t||'_tenant',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE app.%I TO sfp_app',t||'_id_seq');
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.assistant_knowledge_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='assistant_knowledge_index_profiles' THEN
  IF NEW.configuration IS DISTINCT FROM OLD.configuration OR NEW.profile_key IS DISTINCT FROM OLD.profile_key THEN RAISE EXCEPTION 'immutable index profile'; END IF;
 ELSE
  IF OLD.published_at IS NOT NULL AND (NEW.body,NEW.faq,NEW.content_hash,NEW.effective_from,NEW.effective_to,NEW.published_at,NEW.published_by)
    IS DISTINCT FROM (OLD.body,OLD.faq,OLD.content_hash,OLD.effective_from,OLD.effective_to,OLD.published_at,OLD.published_by) THEN RAISE EXCEPTION 'immutable published version'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assistant_profile_immutable BEFORE UPDATE ON app.assistant_knowledge_index_profiles FOR EACH ROW EXECUTE FUNCTION app.assistant_knowledge_immutable();
CREATE TRIGGER assistant_version_immutable BEFORE UPDATE ON app.assistant_knowledge_versions FOR EACH ROW EXECUTE FUNCTION app.assistant_knowledge_immutable();
