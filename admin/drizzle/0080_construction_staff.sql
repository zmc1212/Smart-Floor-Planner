-- Employee identity, project responsibilities and stage assignments are independent.
ALTER TABLE app.admin_users ADD COLUMN construction_trades text[] NOT NULL DEFAULT '{}';
ALTER TABLE app.construction_members ADD COLUMN work_label text NOT NULL DEFAULT '' CHECK(length(work_label)<=50);
CREATE TABLE app.construction_stage_assignments (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, stage_key text NOT NULL,
 admin_id bigint NOT NULL, is_primary boolean NOT NULL DEFAULT false,
 PRIMARY KEY(enterprise_id,project_id,stage_key,admin_id),
 CHECK(stage_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
 FOREIGN KEY(enterprise_id,project_id,admin_id) REFERENCES app.construction_members(enterprise_id,project_id,admin_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX construction_stage_primary ON app.construction_stage_assignments(enterprise_id,project_id,stage_key) WHERE is_primary;
ALTER TABLE app.construction_stage_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_stage_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.construction_stage_assignments
 USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_stage_assignments TO sfp_app;
INSERT INTO app.system_roles(role_key,label,menu_keys)
 VALUES('construction_staff','施工员工',ARRAY['construction-projects']) ON CONFLICT(role_key) DO NOTHING;
-- Phone/WeChat entry does not use an initial Web password. The existing Web
-- access function and its must_change_password guard remain authoritative.
CREATE FUNCTION app.construction_miniprogram_access(subject_id bigint,target_enterprise_id bigint,subject_user_id bigint) RETURNS text LANGUAGE plpgsql AS $$
DECLARE subject app.admin_users%ROWTYPE; permitted boolean;
BEGIN
 IF target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN NULL; END IF;
 SELECT a.* INTO subject FROM app.admin_users a JOIN app.users u ON u.id=a.user_id
 WHERE a.id=subject_id AND a.enterprise_id=target_enterprise_id AND a.user_id=subject_user_id
 AND a.status='active' AND coalesce(u.phone,'')<>'' FOR SHARE OF a,u;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT 'construction-projects'=ANY(menu_keys) INTO permitted FROM app.system_roles WHERE role_key=subject.role FOR SHARE;
 permitted:=coalesce(permitted,subject.role IN ('enterprise_admin','construction_staff'));
 IF NOT permitted THEN RETURN NULL; END IF;
 RETURN CASE WHEN subject.role='enterprise_admin' THEN 'owner' ELSE 'member' END;
END $$;
REVOKE ALL ON FUNCTION app.construction_miniprogram_access(bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.construction_miniprogram_access(bigint,bigint,bigint) TO sfp_app;
