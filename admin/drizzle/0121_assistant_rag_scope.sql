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
--> statement-breakpoint
ALTER TABLE app.assistant_knowledge_assets DROP CONSTRAINT assistant_knowledge_assets_format_check;
ALTER TABLE app.assistant_knowledge_assets ADD CONSTRAINT assistant_knowledge_assets_format_check
 CHECK(format IN ('docx','pdf','xlsx','txt','md'));
ALTER TABLE app.assistant_knowledge_versions DROP CONSTRAINT assistant_source_file_shape;
ALTER TABLE app.assistant_knowledge_versions ADD CONSTRAINT assistant_source_file_shape CHECK(
 (source_asset_id IS NULL AND source_file IS NULL) OR
 (source_asset_id IS NOT NULL AND jsonb_typeof(source_file)='object' AND source_file->>'version'='1'
 AND source_file->>'assetId'=source_asset_id::text AND source_file->>'format' IN ('docx','pdf','xlsx','txt','md')));
