-- The citing message stays in its own tenant. A public source can live in the
-- separately administered platform corpus, with the same version/chunk FKs.
CREATE TABLE app.assistant_platform_knowledge_library (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enterprise_id bigint NOT NULL UNIQUE REFERENCES app.enterprises(id)
);
REVOKE ALL ON app.assistant_platform_knowledge_library FROM PUBLIC,sfp_app;
GRANT SELECT ON app.assistant_platform_knowledge_library TO sfp_app;

ALTER TABLE app.assistant_message_citations
  ADD COLUMN platform_knowledge_enterprise_id bigint REFERENCES app.assistant_platform_knowledge_library(enterprise_id),
  ADD COLUMN source_enterprise_id bigint;
ALTER TABLE app.assistant_message_citations NO FORCE ROW LEVEL SECURITY;
UPDATE app.assistant_message_citations SET source_enterprise_id=enterprise_id;
ALTER TABLE app.assistant_message_citations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_message_citations
  ALTER COLUMN source_enterprise_id SET NOT NULL,
  ADD CONSTRAINT assistant_citation_source_owner CHECK
    (source_enterprise_id=coalesce(platform_knowledge_enterprise_id,enterprise_id));

CREATE FUNCTION app.assistant_citation_bind_source_owner()
RETURNS trigger LANGUAGE plpgsql AS $cite$
BEGIN
  NEW.source_enterprise_id := coalesce(NEW.platform_knowledge_enterprise_id,NEW.enterprise_id);
  RETURN NEW;
END
$cite$;
CREATE TRIGGER assistant_citation_bind_source_owner BEFORE INSERT
  ON app.assistant_message_citations FOR EACH ROW EXECUTE FUNCTION app.assistant_citation_bind_source_owner();

DO $citations$
DECLARE old_fk text;
BEGIN
  FOR old_fk IN SELECT conname FROM pg_constraint
    WHERE conrelid='app.assistant_message_citations'::regclass AND contype='f'
      AND confrelid IN ('app.assistant_knowledge_versions'::regclass, 'app.assistant_knowledge_chunks'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE app.assistant_message_citations DROP CONSTRAINT %I', old_fk);
  END LOOP;
END
$citations$;

ALTER TABLE app.assistant_message_citations
  ADD CONSTRAINT assistant_citation_source_version_fk
    FOREIGN KEY(source_enterprise_id,document_id,document_version_id)
    REFERENCES app.assistant_knowledge_versions(enterprise_id,document_id,id),
  ADD CONSTRAINT assistant_citation_source_chunk_fk
    FOREIGN KEY(source_enterprise_id,document_version_id,chunk_id)
    REFERENCES app.assistant_knowledge_chunks(enterprise_id,document_version_id,id) ON DELETE SET NULL (chunk_id);

CREATE FUNCTION app.assistant_platform_knowledge_admin_is_current(subject_id bigint)
RETURNS boolean LANGUAGE plpgsql AS $admin$
DECLARE
  previous_scope text := current_setting('app.is_platform_admin', true);
  matched bigint;
BEGIN
  PERFORM set_config('app.is_platform_admin','true',true);
  SELECT id INTO matched FROM app.admin_users WHERE id=subject_id AND status='active'
    AND must_change_password=false AND role IN ('super_admin','admin') FOR SHARE;
  PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
  RETURN matched IS NOT NULL;
END
$admin$;
REVOKE ALL ON FUNCTION app.assistant_platform_knowledge_admin_is_current(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_platform_knowledge_admin_is_current(bigint) TO sfp_app;

-- Imports use the library join as their permanent backend index identity.
CREATE FUNCTION app.assistant_managed_knowledge_mapping_immutable()
RETURNS trigger LANGUAGE plpgsql AS $mapping$
BEGIN
  IF (NEW.enterprise_id,NEW.workspace_id,NEW.index_profile_id,NEW.index_name)
      IS DISTINCT FROM (OLD.enterprise_id,OLD.workspace_id,OLD.index_profile_id,OLD.index_name)
    OR (OLD.index_id IS NOT NULL AND NEW.index_id IS DISTINCT FROM OLD.index_id)
  THEN RAISE EXCEPTION 'immutable managed knowledge mapping'; END IF;
  RETURN NEW;
END
$mapping$;
CREATE TRIGGER assistant_managed_knowledge_mapping_immutable BEFORE UPDATE
  ON app.assistant_managed_knowledge_libraries FOR EACH ROW EXECUTE FUNCTION app.assistant_managed_knowledge_mapping_immutable();
