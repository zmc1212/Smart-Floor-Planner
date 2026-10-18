-- Bounded private originals; source files use the existing knowledge versions/jobs/RLS.
ALTER TABLE app.assistant_knowledge_documents DROP CONSTRAINT assistant_knowledge_documents_source_type_check;
ALTER TABLE app.assistant_knowledge_documents ADD CONSTRAINT assistant_knowledge_documents_source_type_check
 CHECK(source_type IN ('manual_text','faq','reference_case','file'));
CREATE TABLE app.assistant_knowledge_assets (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id), document_id bigint NOT NULL,
 name text NOT NULL, format text NOT NULL CHECK(format IN ('docx','pdf')),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 usage_rights text NOT NULL CHECK(length(usage_rights) BETWEEN 1 AND 500),
 data bytea NOT NULL CHECK(octet_length(data) BETWEEN 1 AND 4194304),
 uploaded_by bigint NOT NULL REFERENCES app.admin_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,document_id,id), UNIQUE(enterprise_id,document_id,source_hash),
 FOREIGN KEY(enterprise_id,document_id) REFERENCES app.assistant_knowledge_documents(enterprise_id,id)
);
ALTER TABLE app.assistant_knowledge_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_knowledge_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.assistant_knowledge_assets
 USING(enterprise_id=app.current_enterprise_id() OR app.has_platform_access())
 WITH CHECK(enterprise_id=app.current_enterprise_id() OR app.has_platform_access());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_knowledge_assets TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_knowledge_assets_id_seq TO sfp_app;
CREATE TRIGGER assistant_asset_manager_reference BEFORE INSERT OR UPDATE OF enterprise_id,uploaded_by ON app.assistant_knowledge_assets
 FOR EACH ROW EXECUTE FUNCTION app.assistant_guard_manager_reference('uploaded_by');
--> statement-breakpoint
ALTER TABLE app.assistant_knowledge_versions ADD COLUMN source_asset_id bigint;
ALTER TABLE app.assistant_knowledge_versions ADD COLUMN source_file jsonb;
ALTER TABLE app.assistant_knowledge_versions ADD CONSTRAINT assistant_version_asset_fk
 FOREIGN KEY(enterprise_id,document_id,source_asset_id) REFERENCES app.assistant_knowledge_assets(enterprise_id,document_id,id);
ALTER TABLE app.assistant_knowledge_versions ADD CONSTRAINT assistant_source_file_shape CHECK(
 (source_asset_id IS NULL AND source_file IS NULL) OR
 (source_asset_id IS NOT NULL AND jsonb_typeof(source_file)='object' AND source_file->>'version'='1'
 AND source_file->>'assetId'=source_asset_id::text AND source_file->>'format' IN ('docx','pdf')));
CREATE FUNCTION app.assistant_file_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='assistant_knowledge_assets' THEN RAISE EXCEPTION 'immutable knowledge original'; END IF;
 IF OLD.published_at IS NOT NULL AND (NEW.source_asset_id,NEW.source_file) IS DISTINCT FROM (OLD.source_asset_id,OLD.source_file)
 THEN RAISE EXCEPTION 'immutable published source file'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER assistant_asset_immutable BEFORE UPDATE ON app.assistant_knowledge_assets
 FOR EACH ROW EXECUTE FUNCTION app.assistant_file_immutable();
CREATE TRIGGER assistant_source_file_immutable BEFORE UPDATE ON app.assistant_knowledge_versions
 FOR EACH ROW EXECUTE FUNCTION app.assistant_file_immutable();
--> statement-breakpoint
ALTER TABLE app.assistant_jobs DROP CONSTRAINT assistant_job_target;
ALTER TABLE app.assistant_jobs ADD CONSTRAINT assistant_job_target CHECK(
 (kind='chat_turn' AND run_id IS NOT NULL AND knowledge_version_id IS NULL AND index_profile_id IS NULL AND requested_by IS NULL)
 OR (kind='knowledge_index' AND run_id IS NULL AND knowledge_version_id IS NOT NULL AND index_profile_id IS NOT NULL AND content_hash IS NOT NULL AND requested_by IS NOT NULL)
 OR (kind='knowledge_parse' AND run_id IS NULL AND knowledge_version_id IS NOT NULL AND index_profile_id IS NULL AND content_hash IS NOT NULL AND knowledge_edit_version IS NOT NULL AND requested_by IS NOT NULL));
ALTER TABLE app.assistant_knowledge_attempts DROP CONSTRAINT assistant_knowledge_attempts_operation_check;
ALTER TABLE app.assistant_knowledge_attempts ADD CONSTRAINT assistant_knowledge_attempts_operation_check CHECK(operation IN ('chunk','embed','parse'));
