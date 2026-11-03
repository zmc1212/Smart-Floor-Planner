-- Customer reports and private video are independent, explicit grants.
CREATE TABLE app.construction_camera_customer_grants (
 enterprise_id bigint NOT NULL, project_id bigint NOT NULL, user_id bigint NOT NULL REFERENCES app.users(id),
 enabled boolean NOT NULL DEFAULT false, capture_enabled boolean NOT NULL DEFAULT false, ptz_enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_by bigint REFERENCES app.admin_users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(enterprise_id,project_id,user_id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 CHECK(enabled OR (NOT capture_enabled AND NOT ptz_enabled))
);
ALTER TABLE app.construction_camera_customer_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_camera_customer_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.construction_camera_customer_grants
 USING(app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK(app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_camera_customer_grants TO sfp_app;

-- Preserve all staff captures and their original idempotency constraint.
ALTER TABLE app.construction_camera_snapshots ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE app.construction_camera_snapshots ADD COLUMN actor_user_id bigint REFERENCES app.users(id);
ALTER TABLE app.construction_camera_snapshots ADD CONSTRAINT construction_camera_snapshot_principal
 CHECK((actor_id IS NOT NULL)::integer+(actor_user_id IS NOT NULL)::integer=1);
CREATE UNIQUE INDEX construction_camera_snapshot_customer_key
 ON app.construction_camera_snapshots(enterprise_id,project_id,actor_user_id,request_key) WHERE actor_user_id IS NOT NULL;

-- Ownership/lifecycle revocation cannot revive an earlier customer's grant on
-- reassignment or restore. No provider writes are performed by these triggers.
CREATE FUNCTION app.revoke_camera_customer_grants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='leads' THEN
  IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL) THEN
   UPDATE app.construction_camera_customer_grants g SET enabled=false,capture_enabled=false,ptz_enabled=false,version=version+1,updated_at=now()
    WHERE g.enterprise_id=NEW.enterprise_id AND g.project_id IN (SELECT id FROM app.construction_projects WHERE enterprise_id=NEW.enterprise_id AND lead_id=NEW.id);
  END IF;
 ELSE
  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id OR (NEW.status<>'active' AND NEW.status IS DISTINCT FROM OLD.status) THEN
   UPDATE app.construction_camera_customer_grants SET enabled=false,capture_enabled=false,ptz_enabled=false,version=version+1,updated_at=now()
    WHERE enterprise_id=NEW.enterprise_id AND project_id=NEW.id;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.revoke_camera_customer_grants() FROM PUBLIC;
CREATE TRIGGER construction_camera_customer_lead_revocation AFTER UPDATE OF customer_user_id,archived_at ON app.leads
 FOR EACH ROW EXECUTE FUNCTION app.revoke_camera_customer_grants();
CREATE TRIGGER construction_camera_customer_project_revocation AFTER UPDATE OF lead_id,status ON app.construction_projects
 FOR EACH ROW EXECUTE FUNCTION app.revoke_camera_customer_grants();
