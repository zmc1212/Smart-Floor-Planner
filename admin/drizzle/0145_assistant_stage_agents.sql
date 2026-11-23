-- Enterprise overrides of the ten built-in stage agents. Published workflow definitions
-- are shared platform assets. A binding holds immutable version references only.
CREATE TABLE app.assistant_stage_agents (
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id) ON DELETE CASCADE,
  stage_id text NOT NULL CHECK (stage_id IN ('pre_construction','design','demolition','utilities','masonry','painting','installation','furnishing','completion','occupancy')),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 240),
  enabled boolean NOT NULL,
  workflow_refs jsonb NOT NULL CHECK (jsonb_typeof(workflow_refs) = 'array' AND jsonb_array_length(workflow_refs) BETWEEN 0 AND 12),
  default_workflow_id text,
  suggested_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggested_questions) = 'array' AND jsonb_array_length(suggested_questions) <= 3),
  CHECK ((jsonb_array_length(workflow_refs) = 0) = (default_workflow_id IS NULL)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, stage_id)
);
ALTER TABLE app.assistant_stage_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_stage_agents FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_stage_agents_tenant ON app.assistant_stage_agents FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()));
GRANT SELECT, INSERT, UPDATE ON app.assistant_stage_agents TO sfp_app;
