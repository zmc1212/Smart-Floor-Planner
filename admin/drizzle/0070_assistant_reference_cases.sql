-- Reuse the existing versioned publication, citation, tenant and withdrawal contracts.
ALTER TABLE app.assistant_knowledge_documents DROP CONSTRAINT assistant_knowledge_documents_source_type_check;
ALTER TABLE app.assistant_knowledge_documents ADD CONSTRAINT assistant_knowledge_documents_source_type_check
 CHECK(source_type IN ('faq','manual_text','reference_case'));
ALTER TABLE app.assistant_knowledge_versions ADD COLUMN reference_case jsonb;
ALTER TABLE app.assistant_knowledge_versions ADD CONSTRAINT assistant_reference_case_shape CHECK (
 reference_case IS NULL OR (jsonb_typeof(reference_case)='object' AND octet_length(reference_case::text)<=420000
 AND reference_case ?& ARRAY['source','authorization','tags','imageBase64','mimeType']
 AND length(reference_case->>'source') BETWEEN 1 AND 500
 AND length(reference_case->>'authorization') BETWEEN 1 AND 500
 AND jsonb_typeof(reference_case->'tags')='array' AND jsonb_array_length(reference_case->'tags') BETWEEN 1 AND 12
 AND reference_case->>'mimeType'='image/jpeg'));
CREATE FUNCTION app.assistant_reference_case_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.published_at IS NOT NULL AND NEW.reference_case IS DISTINCT FROM OLD.reference_case THEN
  RAISE EXCEPTION 'immutable published reference case';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assistant_reference_case_immutable BEFORE UPDATE ON app.assistant_knowledge_versions
 FOR EACH ROW EXECUTE FUNCTION app.assistant_reference_case_immutable();
