-- Reconcile the two observed migration histories without inserting legacy receipts.
-- The accepted hashes are the immutable branch SQL bytes (LF and CRLF).
DO $integration$
BEGIN
  IF EXISTS (SELECT 1 FROM app.__drizzle_migrations
    WHERE created_at BETWEEN 1795075200000 AND 1795248000000 AND NOT (
      (created_at=1795075200000 AND hash IN ('ee3046e4687f03c804a3df4405adf2fff32551b35687fee44d92216986230342','44d68be736ae90cfb73fafe497866a9198a0e50c026014a87bb6c47abafd66df'))
      OR (created_at=1795161600000 AND hash IN ('bdcfb7dda785e38d4459884aefc650db61d4eecc5fdeb5c8e6d79ffb2ff4117a','3a96056a6ea7008ab7eb34f95f34b31773f87f0b944f23b17c93c78edbb6bd7a'))
      OR (created_at=1795248000000 AND hash IN ('45b8585507130396ca4659acc58f86a6bcdafa7b54dd5fa8a76f03f68a9e12a6','b0a4d1b61c85705f0ff2ba3d6fa3f0cca14e61165b2eb1feca22a44c67775d1d'))
      OR (created_at=1795075200000 AND hash IN ('86aabfda7cd31ce59aea2e68ab8ad93289293bd118b62202826f593e88635450','b49129c59fb74b0ec2ea0cf17facf9339c0a7c19053766a67bb5e01f82a31656'))
      OR (created_at=1795161600000 AND hash IN ('4ccfc1d4495008190cc137b9f31ad94b1ff183914ca5fa0f95168621d1082d4a','9223d48fdcc4ecdde1a39b628d32996553da609a1bd1a2070784fd358403de5f'))
      OR (created_at=1795248000000 AND hash IN ('4230eb03af9febf260d4d5700f7b21ef85a8306f2efd8e4b93d677a873a82a2f','04e0304f26a35e0a3a8193b262226ad68f9a18471776771bec20f44dccc1d814'))
    )) THEN
    RAISE EXCEPTION 'Unrecognized XiaoK fork migration. Compare the original ledger and SQL before upgrading.';
  END IF;
  IF EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795075200000 AND hash IN ('ee3046e4687f03c804a3df4405adf2fff32551b35687fee44d92216986230342','44d68be736ae90cfb73fafe497866a9198a0e50c026014a87bb6c47abafd66df')) AND EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795075200000 AND hash IN ('86aabfda7cd31ce59aea2e68ab8ad93289293bd118b62202826f593e88635450','b49129c59fb74b0ec2ea0cf17facf9339c0a7c19053766a67bb5e01f82a31656')) THEN
    RAISE EXCEPTION 'Mixed XiaoK fork ledger requires reconciliation before upgrading.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795075200000 AND hash IN ('ee3046e4687f03c804a3df4405adf2fff32551b35687fee44d92216986230342','44d68be736ae90cfb73fafe497866a9198a0e50c026014a87bb6c47abafd66df')) THEN
    -- Keep a deleted project's documents private and preserve their version history.
    ALTER TABLE app.assistant_knowledge_documents
     ADD COLUMN scope text NOT NULL DEFAULT 'enterprise',
     ADD COLUMN project_id bigint,
     ADD CONSTRAINT assistant_knowledge_document_scope CHECK (
       (scope='enterprise' AND project_id IS NULL) OR scope='project'
     ),
     ADD CONSTRAINT assistant_knowledge_document_project_fk FOREIGN KEY (enterprise_id,project_id)
       REFERENCES app.construction_projects(enterprise_id,id) ON DELETE SET NULL (project_id);
    CREATE INDEX assistant_knowledge_project_documents ON app.assistant_knowledge_documents(enterprise_id,project_id)
     WHERE scope='project';
    CREATE FUNCTION app.assistant_knowledge_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
     IF NEW.scope IS DISTINCT FROM OLD.scope
        OR (NEW.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id)
     THEN RAISE EXCEPTION 'immutable knowledge document scope'; END IF;
     RETURN NEW;
    END;
    $$;
    CREATE TRIGGER assistant_knowledge_document_scope_immutable BEFORE UPDATE OF scope,project_id ON app.assistant_knowledge_documents
     FOR EACH ROW EXECUTE FUNCTION app.assistant_knowledge_scope_immutable();

    ALTER TABLE app.assistant_knowledge_assets DROP CONSTRAINT assistant_knowledge_assets_format_check;
    ALTER TABLE app.assistant_knowledge_assets ADD CONSTRAINT assistant_knowledge_assets_format_check
     CHECK(format IN ('docx','pdf','xlsx','txt','md'));
    ALTER TABLE app.assistant_knowledge_versions DROP CONSTRAINT assistant_source_file_shape;
    ALTER TABLE app.assistant_knowledge_versions ADD CONSTRAINT assistant_source_file_shape CHECK(
     (source_asset_id IS NULL AND source_file IS NULL) OR
     (source_asset_id IS NOT NULL AND jsonb_typeof(source_file)='object' AND source_file->>'version'='1'
     AND source_file->>'assetId'=source_asset_id::text AND source_file->>'format' IN ('docx','pdf','xlsx','txt','md')));
  ELSIF to_regprocedure('app.assistant_knowledge_scope_immutable()') IS NULL THEN
    RAISE EXCEPTION 'The applied XiaoK RAG scope is missing its scope guard.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.__drizzle_migrations WHERE created_at=1795161600000 AND hash IN ('bdcfb7dda785e38d4459884aefc650db61d4eecc5fdeb5c8e6d79ffb2ff4117a','3a96056a6ea7008ab7eb34f95f34b31773f87f0b944f23b17c93c78edbb6bd7a')) THEN
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

    DO $$ DECLARE t text; BEGIN
     FOREACH t IN ARRAY ARRAY['assistant_managed_knowledge_libraries','assistant_managed_knowledge_imports'] LOOP
      EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL TO sfp_app USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id())) WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))',t||'_tenant',t);
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
     END LOOP;
    END $$;
  ELSIF to_regclass('app.assistant_managed_knowledge_libraries') IS NULL
    OR to_regclass('app.assistant_managed_knowledge_imports') IS NULL THEN
    RAISE EXCEPTION 'The applied managed knowledge tables are missing.';
  END IF;
END
$integration$;
