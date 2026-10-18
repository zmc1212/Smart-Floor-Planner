-- 0080 is already applied. Fix scope and session-revocation checks additively.
UPDATE app.system_roles SET menu_keys=array_append(coalesce(menu_keys,'{}'::text[]),'construction-projects')
 WHERE role_key='designer' AND NOT ('construction-projects'=ANY(coalesce(menu_keys,'{}'::text[])));
DROP FUNCTION app.construction_miniprogram_access(bigint,bigint,bigint);
CREATE FUNCTION app.construction_miniprogram_access(subject_id bigint,target_enterprise_id bigint,subject_user_id bigint,subject_context_version integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE subject app.admin_users%ROWTYPE; permitted boolean; previous_scope text;
BEGIN
 IF target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN NULL; END IF;
 previous_scope:=current_setting('app.is_platform_admin',true);
 PERFORM set_config('app.is_platform_admin','true',true);
 SELECT a.* INTO subject FROM app.admin_users a JOIN app.users u ON u.id=a.user_id
 WHERE a.id=subject_id AND a.enterprise_id=target_enterprise_id AND a.user_id=subject_user_id
 AND a.status='active' AND u.context_version=subject_context_version AND coalesce(u.phone,'')<>'' FOR SHARE OF a,u;
 IF FOUND THEN
  SELECT 'construction-projects'=ANY(menu_keys) INTO permitted FROM app.system_roles WHERE role_key=subject.role FOR SHARE;
  permitted:=coalesce(permitted,subject.role IN ('enterprise_admin','construction_staff','designer'));
 ELSE permitted:=false; END IF;
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
 IF NOT permitted THEN RETURN NULL; END IF;
 RETURN CASE WHEN subject.role='enterprise_admin' THEN 'owner' ELSE 'member' END;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true); RAISE;
END $$;
REVOKE ALL ON FUNCTION app.construction_miniprogram_access(bigint,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.construction_miniprogram_access(bigint,bigint,bigint,integer) TO sfp_app;
