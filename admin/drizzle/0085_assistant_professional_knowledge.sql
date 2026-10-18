-- Additive, nullable metadata preserves existing version hashes and knowledge indexes.
ALTER TABLE app.assistant_knowledge_versions ADD COLUMN professional jsonb;
ALTER TABLE app.assistant_knowledge_versions ADD CONSTRAINT assistant_professional_shape CHECK (
 professional IS NULL OR (jsonb_typeof(professional)='object' AND octet_length(professional::text)<=16000
 AND professional->>'version'='1' AND professional->>'kind' IN ('construction','material','service','explanation','internal')
 AND jsonb_typeof(professional->'conditions')='array' AND jsonb_typeof(professional->'origin')='object'
 AND jsonb_typeof(professional->'review')='object'));
CREATE FUNCTION app.assistant_professional_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.published_at IS NOT NULL AND NEW.professional IS DISTINCT FROM OLD.professional THEN
  RAISE EXCEPTION 'immutable published professional knowledge';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assistant_professional_immutable BEFORE UPDATE ON app.assistant_knowledge_versions
 FOR EACH ROW EXECUTE FUNCTION app.assistant_professional_immutable();
