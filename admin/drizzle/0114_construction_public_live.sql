-- Independent live consent. Photo/excerpt grants are deliberately untouched.
CREATE TABLE app.construction_public_live (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 public_key text NOT NULL, current_version_id bigint,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','pending_owner','owner_approved','published','declined','rejected','withdrawn')),
 prepared_by bigint NOT NULL REFERENCES app.admin_users(id), customer_id bigint NOT NULL REFERENCES app.users(id),
 conversation_id bigint, message_id bigint, previewed_version_id bigint, consented_version_id bigint,
 consented_by bigint REFERENCES app.users(id), reviewed_by bigint REFERENCES app.admin_users(id),
 reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,project_id,id), UNIQUE(enterprise_id,project_id), UNIQUE(public_key),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
 FOREIGN KEY(enterprise_id,conversation_id,message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id),
 CHECK(status NOT IN('owner_approved','published') OR(consented_version_id=current_version_id AND consented_by=customer_id AND consented_version_id IS NOT NULL AND consented_by IS NOT NULL)),
 CHECK(status<>'published' OR reviewed_by IS NOT NULL)
);
CREATE TABLE app.construction_public_live_versions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, live_id bigint NOT NULL,
 binding_id bigint NOT NULL, camera_id bigint NOT NULL, camera_version integer NOT NULL,
 alias text NOT NULL CHECK(length(alias) BETWEEN 1 AND 40),
 scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'), scope_hash text NOT NULL,
 prepared_by bigint NOT NULL REFERENCES app.admin_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,live_id,id), UNIQUE(enterprise_id,project_id,live_id,id),
 FOREIGN KEY(enterprise_id,project_id,live_id) REFERENCES app.construction_public_live(enterprise_id,project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,binding_id) REFERENCES app.construction_camera_bindings(enterprise_id,project_id,id),
 FOREIGN KEY(enterprise_id,camera_id) REFERENCES app.construction_cameras(enterprise_id,id)
);
ALTER TABLE app.construction_public_live ADD CONSTRAINT public_live_current_version_fk FOREIGN KEY(enterprise_id,id,current_version_id) REFERENCES app.construction_public_live_versions(enterprise_id,live_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.construction_public_live ADD CONSTRAINT public_live_preview_version_fk FOREIGN KEY(enterprise_id,id,previewed_version_id) REFERENCES app.construction_public_live_versions(enterprise_id,live_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.construction_public_live ADD CONSTRAINT public_live_consent_version_fk FOREIGN KEY(enterprise_id,id,consented_version_id) REFERENCES app.construction_public_live_versions(enterprise_id,live_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE app.construction_public_live_proxies (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, live_id bigint NOT NULL, version_id bigint NOT NULL,
 app text NOT NULL CHECK(app='sfp_public_live'), stream text NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN('intent','starting','ready','unknown','failed','stopping','stopped')),
 ownership_key text NOT NULL UNIQUE, error_code text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, start_finished_at timestamptz,
 UNIQUE(enterprise_id,id),
 FOREIGN KEY(enterprise_id,project_id,live_id,version_id) REFERENCES app.construction_public_live_versions(enterprise_id,project_id,live_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX public_live_active_proxy ON app.construction_public_live_proxies(enterprise_id,live_id,version_id) WHERE state NOT IN('stopped','failed');
CREATE TABLE app.construction_public_live_sessions (
 token_hash text PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, live_id bigint NOT NULL, version_id bigint NOT NULL,
 revision integer NOT NULL, proxy_id bigint NOT NULL, audience text NOT NULL CHECK(audience IN('public','owner','staff')), actor jsonb,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,project_id,live_id,version_id) REFERENCES app.construction_public_live_versions(enterprise_id,project_id,live_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,proxy_id) REFERENCES app.construction_public_live_proxies(enterprise_id,id) ON DELETE CASCADE
);
CREATE TABLE app.construction_public_live_audits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, live_id bigint NOT NULL, version_id bigint NOT NULL,
 actor_ref jsonb NOT NULL, action text NOT NULL, reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,project_id,live_id,version_id) REFERENCES app.construction_public_live_versions(enterprise_id,project_id,live_id,id) ON DELETE CASCADE
);
CREATE TRIGGER public_live_version_immutable BEFORE UPDATE ON app.construction_public_live_versions FOR EACH ROW EXECUTE FUNCTION app.construction_public_version_immutable();
-- Existing camera code is retained. DB guards cover every caller, including PTZ's
-- durable obligation before it sends a command. Explicitly stop and confirm our
-- proxy removal before changing an approved frame/binding/configuration.
CREATE FUNCTION app.public_live_camera_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid bigint; eid bigint;
BEGIN
 IF TG_OP='DELETE' THEN eid:=(to_jsonb(OLD)->>'enterprise_id')::bigint; ELSE eid:=(to_jsonb(NEW)->>'enterprise_id')::bigint; END IF;
 IF TG_TABLE_NAME='construction_cameras' THEN cid:=(to_jsonb(OLD)->>'id')::bigint;
 ELSIF TG_OP='DELETE' THEN cid:=(to_jsonb(OLD)->>'camera_id')::bigint; ELSE cid:=(to_jsonb(NEW)->>'camera_id')::bigint; END IF;
 IF EXISTS(SELECT 1 FROM app.construction_public_live l JOIN app.construction_public_live_versions v
  ON v.enterprise_id=l.enterprise_id AND v.live_id=l.id AND v.id=l.current_version_id
  WHERE l.enterprise_id=eid AND v.camera_id=cid AND (l.status IN('pending_owner','owner_approved','published')
    OR EXISTS(SELECT 1 FROM app.construction_public_live_proxies p WHERE p.enterprise_id=l.enterprise_id AND p.live_id=l.id AND p.state NOT IN('stopped','failed')))) THEN
  RAISE EXCEPTION 'public_live_stop_required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER public_live_camera_guard BEFORE UPDATE OR DELETE ON app.construction_cameras FOR EACH ROW EXECUTE FUNCTION app.public_live_camera_guard();
CREATE TRIGGER public_live_binding_guard BEFORE UPDATE OR DELETE ON app.construction_camera_bindings FOR EACH ROW EXECUTE FUNCTION app.public_live_camera_guard();
CREATE TRIGGER public_live_ptz_guard BEFORE INSERT OR UPDATE ON app.construction_camera_controls FOR EACH ROW WHEN(NEW.stop_required) EXECUTE FUNCTION app.public_live_camera_guard();
-- Source restoration never revives a previous approval. Scope loss is durable.
CREATE FUNCTION app.public_live_revoke_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='construction_members' THEN
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->'active'=to_jsonb(NEW)->'active' AND to_jsonb(OLD)->'role'=to_jsonb(NEW)->'role' THEN RETURN NEW; END IF;
  IF app.construction_actor_access((to_jsonb(OLD)->>'admin_id')::bigint,OLD.enterprise_id)='owner' THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
 END IF;
 UPDATE app.construction_public_live l SET status='withdrawn',revision=revision+1,consented_version_id=NULL,consented_by=NULL,reviewed_by=NULL,reason='source_access_changed',updated_at=now()
 WHERE l.enterprise_id=OLD.enterprise_id AND l.status NOT IN('draft','withdrawn') AND
  (TG_TABLE_NAME NOT IN('construction_projects','construction_members','leads') OR
   CASE WHEN TG_TABLE_NAME='construction_projects' THEN l.project_id=(to_jsonb(OLD)->>'id')::bigint
        WHEN TG_TABLE_NAME='construction_members' THEN l.project_id=(to_jsonb(OLD)->>'project_id')::bigint AND l.prepared_by=(to_jsonb(OLD)->>'admin_id')::bigint
        ELSE l.project_id IN(SELECT id FROM app.construction_projects WHERE enterprise_id=OLD.enterprise_id AND lead_id=(to_jsonb(OLD)->>'id')::bigint) END);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER public_live_project_revoke AFTER UPDATE OF status,customer_access ON app.construction_projects FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status OR OLD.customer_access IS DISTINCT FROM NEW.customer_access) EXECUTE FUNCTION app.public_live_revoke_scope();
CREATE TRIGGER public_live_customer_revoke AFTER UPDATE OF customer_user_id,archived_at,status ON app.leads FOR EACH ROW WHEN(OLD.customer_user_id IS DISTINCT FROM NEW.customer_user_id OR OLD.archived_at IS DISTINCT FROM NEW.archived_at OR OLD.status IS DISTINCT FROM NEW.status AND NEW.status='closed') EXECUTE FUNCTION app.public_live_revoke_scope();
CREATE TRIGGER public_live_member_revoke AFTER UPDATE OR DELETE ON app.construction_members FOR EACH ROW EXECUTE FUNCTION app.public_live_revoke_scope();
CREATE TRIGGER public_live_settings_revoke AFTER UPDATE OF enabled ON app.assistant_enterprise_settings FOR EACH ROW WHEN(OLD.enabled IS DISTINCT FROM NEW.enabled) EXECUTE FUNCTION app.public_live_revoke_scope();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_public_live','construction_public_live_versions','construction_public_live_proxies','construction_public_live_sessions','construction_public_live_audits'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
-- Identity/management restoration also requires a fresh live decision.
CREATE FUNCTION app.public_live_identity_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE app.construction_public_live l SET status='withdrawn',revision=revision+1,consented_version_id=NULL,consented_by=NULL,reviewed_by=NULL,reason='identity_access_changed',updated_at=now()
 WHERE l.status NOT IN('draft','withdrawn') AND
  CASE WHEN TG_TABLE_NAME='admin_users' THEN l.prepared_by=(to_jsonb(OLD)->>'id')::bigint OR l.reviewed_by=(to_jsonb(OLD)->>'id')::bigint
       WHEN TG_TABLE_NAME='enterprises' THEN l.enterprise_id=(to_jsonb(OLD)->>'id')::bigint
       ELSE l.customer_id=(to_jsonb(OLD)->>'id')::bigint OR EXISTS(SELECT 1 FROM app.construction_public_live_versions v
          WHERE v.enterprise_id=l.enterprise_id AND v.id=l.current_version_id AND v.scope->'preparedActor'->>'miniProgramUserId'=to_jsonb(OLD)->>'id') END;
 RETURN NEW;
END $$;
CREATE TRIGGER public_live_admin_revoke AFTER UPDATE OF status,role,enterprise_id,menu_permissions,must_change_password,user_id ON app.admin_users FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status OR OLD.role IS DISTINCT FROM NEW.role OR OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR OLD.menu_permissions IS DISTINCT FROM NEW.menu_permissions OR OLD.must_change_password IS DISTINCT FROM NEW.must_change_password OR OLD.user_id IS DISTINCT FROM NEW.user_id) EXECUTE FUNCTION app.public_live_identity_revoke();
CREATE TRIGGER public_live_user_revoke AFTER UPDATE OF context_version ON app.users FOR EACH ROW WHEN(OLD.context_version IS DISTINCT FROM NEW.context_version) EXECUTE FUNCTION app.public_live_identity_revoke();
CREATE TRIGGER public_live_enterprise_revoke AFTER UPDATE OF status ON app.enterprises FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION app.public_live_identity_revoke();
CREATE FUNCTION app.public_live_role_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE app.construction_public_live l SET status='withdrawn',revision=revision+1,consented_version_id=NULL,consented_by=NULL,reviewed_by=NULL,reason='role_access_changed',updated_at=now()
 WHERE l.status NOT IN('draft','withdrawn') AND EXISTS(SELECT 1 FROM app.admin_users a WHERE a.role=OLD.role_key AND (a.id=l.prepared_by OR a.id=l.reviewed_by));
 RETURN NEW;
END $$;
CREATE TRIGGER public_live_role_revoke AFTER UPDATE OF menu_keys,role_key ON app.system_roles FOR EACH ROW WHEN(OLD.menu_keys IS DISTINCT FROM NEW.menu_keys OR OLD.role_key IS DISTINCT FROM NEW.role_key) EXECUTE FUNCTION app.public_live_role_revoke();
