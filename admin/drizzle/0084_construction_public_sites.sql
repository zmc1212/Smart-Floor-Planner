-- P4B: an immutable, homeowner-approved public projection; never a public chat grant.
CREATE TABLE app.construction_public_sites (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 current_version_id bigint, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_owner','owner_approved','rejected','published','declined','withdrawn')),
 prepared_by bigint NOT NULL REFERENCES app.admin_users(id), customer_id bigint REFERENCES app.users(id),
 previewed_version_id bigint, consented_version_id bigint, consented_by bigint REFERENCES app.users(id), reviewed_by bigint REFERENCES app.admin_users(id),
 reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,project_id,id), UNIQUE(enterprise_id,project_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 CHECK(status NOT IN ('owner_approved','published') OR (consented_version_id IS NOT NULL AND current_version_id IS NOT NULL AND consented_by IS NOT NULL AND customer_id IS NOT NULL AND consented_version_id=current_version_id AND consented_by=customer_id)),
 CHECK(status<>'published' OR reviewed_by IS NOT NULL)
);
CREATE TABLE app.construction_public_versions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, site_id bigint NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>0), content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'), content_hash text NOT NULL,
 prepared_by bigint NOT NULL REFERENCES app.admin_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,site_id,id), UNIQUE(enterprise_id,project_id,site_id,id), UNIQUE(enterprise_id,site_id,ordinal),
 FOREIGN KEY(enterprise_id,project_id,site_id) REFERENCES app.construction_public_sites(enterprise_id,project_id,id) ON DELETE CASCADE
);
ALTER TABLE app.construction_public_sites ADD CONSTRAINT construction_public_current_version_fk
 FOREIGN KEY(enterprise_id,id,current_version_id) REFERENCES app.construction_public_versions(enterprise_id,site_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.construction_public_sites ADD CONSTRAINT construction_public_preview_version_fk
 FOREIGN KEY(enterprise_id,id,previewed_version_id) REFERENCES app.construction_public_versions(enterprise_id,site_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.construction_public_sites ADD CONSTRAINT construction_public_consent_version_fk
 FOREIGN KEY(enterprise_id,id,consented_version_id) REFERENCES app.construction_public_versions(enterprise_id,site_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE app.construction_public_sources (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, site_id bigint NOT NULL, version_id bigint NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 7),
 kind text NOT NULL CHECK(kind IN ('site_record','consultation_message')), record_id bigint, record_version integer,
 conversation_id bigint, message_id bigint, source_hash text NOT NULL,
 PRIMARY KEY(enterprise_id,site_id,version_id,position),
 FOREIGN KEY(enterprise_id,project_id,site_id,version_id) REFERENCES app.construction_public_versions(enterprise_id,project_id,site_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,record_id,record_version) REFERENCES app.construction_site_record_versions(enterprise_id,project_id,record_id,version) ON DELETE SET NULL(record_id,record_version),
 FOREIGN KEY(enterprise_id,conversation_id,message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id) ON DELETE SET NULL(message_id),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id) ON DELETE SET NULL(conversation_id)
);
CREATE TABLE app.construction_public_media (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, site_id bigint NOT NULL, version_id bigint NOT NULL,
 source_record_id bigint, source_media_id bigint, position integer NOT NULL CHECK(position BETWEEN 0 AND 3),
 masks jsonb NOT NULL DEFAULT '[]', source_hash text NOT NULL, content_hash text NOT NULL, mime_type text NOT NULL CHECK(mime_type='image/jpeg'),
 width integer NOT NULL CHECK(width>0),height integer NOT NULL CHECK(height>0),data bytea NOT NULL, byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 4194304),
 UNIQUE(enterprise_id,site_id,version_id,id), UNIQUE(enterprise_id,site_id,version_id,position),
 FOREIGN KEY(enterprise_id,project_id,site_id,version_id) REFERENCES app.construction_public_versions(enterprise_id,project_id,site_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,source_record_id,source_media_id) REFERENCES app.construction_site_attachments(enterprise_id,project_id,record_id,media_id) ON DELETE SET NULL(source_record_id,source_media_id)
);
CREATE TABLE app.construction_public_audits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,site_id bigint NOT NULL,version_id bigint NOT NULL,
 actor_ref jsonb NOT NULL,action text NOT NULL,reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,project_id,site_id,version_id) REFERENCES app.construction_public_versions(enterprise_id,project_id,site_id,id) ON DELETE CASCADE
);
CREATE INDEX construction_public_discovery ON app.construction_public_sites(enterprise_id,status,id DESC);
CREATE FUNCTION app.construction_public_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='construction_public_versions' OR NEW.data IS DISTINCT FROM OLD.data OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
  OR NEW.masks IS DISTINCT FROM OLD.masks OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.position IS DISTINCT FROM OLD.position THEN
  RAISE EXCEPTION 'public material versions are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
-- Separate triggers avoid reading media-only columns on a version row.
CREATE FUNCTION app.construction_public_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'public material versions are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER construction_public_version_immutable BEFORE UPDATE ON app.construction_public_versions FOR EACH ROW EXECUTE FUNCTION app.construction_public_version_immutable();
CREATE TRIGGER construction_public_media_immutable BEFORE UPDATE ON app.construction_public_media FOR EACH ROW EXECUTE FUNCTION app.construction_public_immutable();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_public_sites','construction_public_versions','construction_public_sources','construction_public_media','construction_public_audits'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
