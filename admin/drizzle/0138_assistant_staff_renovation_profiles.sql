-- Keep old customer grants separate from staff-only consultation sources.
ALTER TABLE app.assistant_renovation_profiles
  ADD COLUMN automatic_field_sources jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(automatic_field_sources) = 'object'),
  ADD COLUMN automatic_revoked_at timestamptz;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.revoke_lead_renovation_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
    OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
    OR (OLD.status <> 'closed' AND NEW.status = 'closed') THEN
    UPDATE app.assistant_renovation_profiles
    SET shared=false, field_sources='{}'::jsonb, automatic_field_sources='{}'::jsonb,
        automatic_revoked_at=clock_timestamp(), version=version+1, updated_at=now()
    WHERE enterprise_id=NEW.enterprise_id AND lead_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
