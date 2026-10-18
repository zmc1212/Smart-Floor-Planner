-- P3A: team-owned construction facts; a visit intent is not a measuring appointment.
CREATE TABLE app.construction_projects (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 lead_id bigint NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
 customer_access boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), FOREIGN KEY(enterprise_id,lead_id) REFERENCES app.leads(enterprise_id,id)
);
CREATE TABLE app.construction_members (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, admin_id bigint NOT NULL,
 role text NOT NULL CHECK(role IN ('manager','designer','worker','observer')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(enterprise_id,project_id,admin_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,admin_id) REFERENCES app.admin_users(enterprise_id,id)
);
CREATE TABLE app.construction_rooms (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 50), UNIQUE(enterprise_id,project_id,id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE
);
CREATE TABLE app.construction_plans (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL, room_id bigint,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','confirmed','paused','cancelled')), note text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at), UNIQUE(enterprise_id,project_id,id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,room_id) REFERENCES app.construction_rooms(enterprise_id,project_id,id)
);
CREATE TABLE app.construction_visits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 conversation_id bigint NOT NULL, source_message_id bigint NOT NULL, customer_id bigint NOT NULL REFERENCES app.users(id),
 request_text text NOT NULL CHECK(length(request_text) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','declined','cancelled')),
 starts_at timestamptz, ends_at timestamptz, note text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='confirmed' AND starts_at IS NOT NULL AND ends_at>starts_at) OR status<>'confirmed'),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,conversation_id,source_message_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,source_message_id) REFERENCES app.assistant_messages(enterprise_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX construction_one_open_visit ON app.construction_visits(enterprise_id,project_id,customer_id) WHERE status IN ('pending','confirmed');
CREATE TABLE app.construction_audits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL, project_id bigint NOT NULL,
 actor_ref jsonb NOT NULL, action text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE
);
CREATE TABLE app.construction_links (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, conversation_id bigint NOT NULL,
 PRIMARY KEY(enterprise_id,project_id,conversation_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id) ON DELETE CASCADE
);
CREATE INDEX construction_project_lead ON app.construction_projects(enterprise_id,lead_id,id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_projects','construction_members','construction_rooms','construction_plans','construction_visits','construction_audits','construction_links'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
UPDATE app.system_roles SET menu_keys=array_append(menu_keys,'construction-projects')
 WHERE role_key IN ('super_admin','admin','enterprise_admin') AND NOT ('construction-projects'=ANY(menu_keys));
-- Live staff/menu checks use the existing scoped-access pattern. A project role never grants a global role.
CREATE FUNCTION app.construction_actor_access(subject_id bigint,target_enterprise_id bigint) RETURNS text LANGUAGE plpgsql AS $$
DECLARE previous_scope text; subject app.admin_users%ROWTYPE; permitted boolean;
BEGIN
 IF NOT app.has_platform_access() AND target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN NULL; END IF;
 previous_scope:=current_setting('app.is_platform_admin',true);
 PERFORM set_config('app.is_platform_admin','true',true);
 SELECT * INTO subject FROM app.admin_users WHERE id=subject_id AND status='active' AND must_change_password=false FOR SHARE;
 IF FOUND AND (subject.role IN ('super_admin','admin') OR subject.enterprise_id=target_enterprise_id) THEN
  SELECT 'construction-projects'=ANY(menu_keys) INTO permitted FROM app.system_roles WHERE role_key=subject.role FOR SHARE;
  permitted:=coalesce(permitted,subject.role IN ('super_admin','admin','enterprise_admin'));
 ELSE permitted:=false; END IF;
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
 IF NOT permitted THEN RETURN NULL; END IF;
 RETURN CASE WHEN subject.role IN ('super_admin','admin','enterprise_admin') THEN 'owner' ELSE 'member' END;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true); RAISE;
END $$;
REVOKE ALL ON FUNCTION app.construction_actor_access(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.construction_actor_access(bigint,bigint) TO sfp_app;
