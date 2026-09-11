CREATE TABLE app.design_reports (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id) ON DELETE restrict,
  lead_id bigint NOT NULL REFERENCES app.leads(id) ON DELETE cascade,
  created_by bigint NOT NULL REFERENCES app.admin_users(id) ON DELETE restrict,
  draft jsonb NOT NULL,
  previous_draft jsonb,
  version integer NOT NULL DEFAULT 1,
  published_draft jsonb,
  published_version integer,
  share_token text,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX design_reports_enterprise_lead_idx ON app.design_reports(enterprise_id, lead_id);
CREATE INDEX design_reports_lead_idx ON app.design_reports(lead_id);
CREATE INDEX design_reports_creator_idx ON app.design_reports(created_by);
CREATE UNIQUE INDEX design_reports_share_token_idx ON app.design_reports(share_token);
--> statement-breakpoint
ALTER TABLE app.design_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.design_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY design_reports_tenant_isolation ON app.design_reports FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()));
CREATE POLICY design_reports_auditor_read_all ON app.design_reports FOR SELECT TO sfp_auditor USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.design_reports TO sfp_app;
GRANT SELECT ON app.design_reports TO sfp_auditor;
GRANT USAGE, SELECT ON SEQUENCE app.design_reports_id_seq TO sfp_app;
