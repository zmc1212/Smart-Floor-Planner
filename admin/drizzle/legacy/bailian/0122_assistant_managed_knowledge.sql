-- Managed indices reuse the knowledge lifecycle, not the local vector store.
ALTER TABLE app.assistant_knowledge_chunks ALTER COLUMN embedding DROP NOT NULL;
ALTER TABLE app.assistant_knowledge_attempts DROP CONSTRAINT assistant_knowledge_attempts_operation_check;
ALTER TABLE app.assistant_knowledge_attempts ADD CONSTRAINT assistant_knowledge_attempts_operation_check
 CHECK (operation IN ('chunk','embed','parse','managed_upload','managed_create','managed_import'));
ALTER TABLE app.assistant_knowledge_attempts ADD COLUMN provider_request_id text;
CREATE TABLE app.assistant_managed_knowledge_libraries (
 enterprise_id bigint PRIMARY KEY REFERENCES app.enterprises(id),
 index_profile_id bigint NOT NULL,
 workspace_id text NOT NULL,
 index_name text NOT NULL,
 index_id text,
 provision_job_id bigint,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (enterprise_id,workspace_id),
 UNIQUE (workspace_id,index_name),
 UNIQUE (workspace_id,index_id),
 FOREIGN KEY (enterprise_id,index_profile_id) REFERENCES app.assistant_knowledge_index_profiles(enterprise_id,id),
 FOREIGN KEY (enterprise_id,provision_job_id) REFERENCES app.assistant_jobs(enterprise_id,id) ON DELETE SET NULL (provision_job_id)
);
CREATE TABLE app.assistant_managed_knowledge_imports (
 enterprise_id bigint NOT NULL, job_id bigint NOT NULL, version_id bigint NOT NULL, edit_version integer NOT NULL,
 content_hash text NOT NULL, workspace_id text NOT NULL, version_tag text NOT NULL UNIQUE,
 file_id text, index_document_id text, ingestion_id text, created_index boolean NOT NULL DEFAULT false, ready boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz, removed_at timestamptz, cleanup_after timestamptz NOT NULL DEFAULT now(),
 cleanup_attempts integer NOT NULL DEFAULT 0, cleanup_error text, cleanup_request_id text, indexed_request_id text,
 PRIMARY KEY (enterprise_id,job_id),
 UNIQUE (workspace_id,file_id),
 UNIQUE (workspace_id,index_document_id),
 CHECK (NOT ready OR (file_id IS NOT NULL AND index_document_id IS NOT NULL)),
 FOREIGN KEY (enterprise_id,job_id) REFERENCES app.assistant_jobs(enterprise_id,id),
 FOREIGN KEY (enterprise_id,version_id) REFERENCES app.assistant_knowledge_versions(enterprise_id,id),
 FOREIGN KEY (enterprise_id,workspace_id) REFERENCES app.assistant_managed_knowledge_libraries(enterprise_id,workspace_id)
);
CREATE INDEX assistant_managed_version ON app.assistant_managed_knowledge_imports(enterprise_id,version_id,edit_version,content_hash)
 WHERE ready AND revoked_at IS NULL;
CREATE INDEX assistant_managed_cleanup ON app.assistant_managed_knowledge_imports(cleanup_after) WHERE revoked_at IS NOT NULL AND removed_at IS NULL;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assistant_managed_knowledge_libraries','assistant_managed_knowledge_imports'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))',t||'_tenant',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
