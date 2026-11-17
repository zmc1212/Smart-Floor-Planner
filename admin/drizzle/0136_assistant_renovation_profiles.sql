-- A profile points to the customer's confirmed requirement fields for one lead.
-- The confirmed summaries continue to own the requirement text and provenance.
CREATE TABLE app.assistant_renovation_profiles (
  enterprise_id bigint NOT NULL,
  lead_id bigint NOT NULL,
  customer_user_id bigint NOT NULL REFERENCES app.users(id),
  version integer NOT NULL CHECK (version > 0),
  shared boolean NOT NULL,
  field_sources jsonb NOT NULL CHECK (jsonb_typeof(field_sources) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, lead_id),
  FOREIGN KEY (enterprise_id, lead_id) REFERENCES app.leads(enterprise_id, id) ON DELETE CASCADE,
  CHECK (shared = (field_sources <> '{}'::jsonb))
);
ALTER TABLE app.assistant_renovation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_renovation_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_renovation_profiles_tenant ON app.assistant_renovation_profiles FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON app.assistant_renovation_profiles TO sfp_app;
--> statement-breakpoint
-- Losing the original customer or closing the archive ends the sharing grant.
-- Reopening a record requires a new explicit share by its present owner.
CREATE FUNCTION app.revoke_lead_renovation_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
    OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
    OR (OLD.status <> 'closed' AND NEW.status = 'closed') THEN
    UPDATE app.assistant_renovation_profiles
    SET shared=false, field_sources='{}'::jsonb, version=version+1, updated_at=now()
    WHERE enterprise_id=NEW.enterprise_id AND lead_id=NEW.id AND shared;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.revoke_lead_renovation_profile() FROM PUBLIC;
CREATE TRIGGER lead_renovation_profile_scope
AFTER UPDATE OF customer_user_id, archived_at, status ON app.leads
FOR EACH ROW EXECUTE FUNCTION app.revoke_lead_renovation_profile();
