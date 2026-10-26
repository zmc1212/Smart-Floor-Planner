-- P2C.3: author-owned public portrait with explicit consent.
CREATE TABLE app.portfolio_portraits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 author_id bigint NOT NULL,
 image_base64 text NOT NULL CHECK(length(image_base64)<=409600),
 content_hash text NOT NULL,
 consent_at timestamptz NOT NULL,
 consent_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,author_id),
 UNIQUE(enterprise_id,id),
 FOREIGN KEY(enterprise_id,author_id) REFERENCES app.admin_users(enterprise_id,id)
);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['portfolio_portraits'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
