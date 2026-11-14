CREATE TABLE app.xiaok_pilot_project_scopes (
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id) ON DELETE CASCADE,
 pilot_id text NOT NULL CHECK (pilot_id ~ '^[a-zA-Z0-9._:-]{1,128}$'),
 project_ids bigint[] NOT NULL CHECK (cardinality(project_ids)>0),
 created_by bigint NOT NULL CHECK (created_by>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 scope_version integer NOT NULL CHECK (scope_version>0),
 status text NOT NULL CHECK (status IN ('active','inactive')),
 PRIMARY KEY (enterprise_id,pilot_id,scope_version)
);

-- Keep the original selection after a project is archived or removed, and
-- recheck availability at preflight. Validate and lock every reference on save.
CREATE FUNCTION app.xiaok_validate_pilot_projects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='inactive' AND EXISTS (
  SELECT 1 FROM app.xiaok_pilot_project_scopes previous
   WHERE previous.enterprise_id=NEW.enterprise_id AND previous.pilot_id=NEW.pilot_id
   AND previous.scope_version=NEW.scope_version-1 AND previous.project_ids=NEW.project_ids
 ) THEN
  RETURN NEW;
 END IF;
 IF cardinality(NEW.project_ids) <> (
  SELECT count(*) FROM (
   SELECT p.id FROM app.construction_projects p
    JOIN app.leads l ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
    WHERE p.enterprise_id=NEW.enterprise_id AND p.id=ANY(NEW.project_ids)
    AND p.status<>'archived' AND l.archived_at IS NULL
    ORDER BY p.id FOR SHARE OF p,l
  ) selected
 ) THEN
  RAISE EXCEPTION 'Pilot project unavailable' USING ERRCODE='23514',CONSTRAINT='xiaok_pilot_projects_available';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER xiaok_pilot_projects_available
 BEFORE INSERT OR UPDATE OF enterprise_id,project_ids ON app.xiaok_pilot_project_scopes
 FOR EACH ROW EXECUTE FUNCTION app.xiaok_validate_pilot_projects();

ALTER TABLE app.xiaok_pilot_project_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.xiaok_pilot_project_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.xiaok_pilot_project_scopes
 USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT ON app.xiaok_pilot_project_scopes TO sfp_app;
REVOKE UPDATE,DELETE ON app.xiaok_pilot_project_scopes FROM sfp_app;
