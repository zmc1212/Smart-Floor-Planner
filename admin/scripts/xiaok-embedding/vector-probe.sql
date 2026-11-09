-- Dependency acceptance ONLY: run in the explicitly isolated clone, never app startup.
CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.2';
CREATE TABLE app.assistant_embedding_probe (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  id text NOT NULL,
  profile text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  published_version integer NOT NULL DEFAULT 1,
  audience text NOT NULL DEFAULT 'customer_public',
  state text NOT NULL DEFAULT 'published',
  valid_from timestamptz NOT NULL DEFAULT '2020-01-01',
  valid_until timestamptz,
  body text NOT NULL,
  terms text[] NOT NULL,
  embedding vector(1024) NOT NULL,
  PRIMARY KEY (enterprise_id, id, profile)
);
ALTER TABLE app.assistant_embedding_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_embedding_probe FORCE ROW LEVEL SECURITY;
CREATE POLICY embedding_probe_tenant ON app.assistant_embedding_probe
  USING (enterprise_id = nullif(current_setting('app.current_enterprise_id', true), '')::bigint)
  WITH CHECK (enterprise_id = nullif(current_setting('app.current_enterprise_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.assistant_embedding_probe TO sfp_app;
