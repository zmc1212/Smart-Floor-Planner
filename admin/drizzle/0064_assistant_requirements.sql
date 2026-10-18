CREATE UNIQUE INDEX IF NOT EXISTS leads_enterprise_id_requirements_uidx ON app.leads(enterprise_id,id);
--> statement-breakpoint
CREATE TABLE app.assistant_requirement_summaries (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 conversation_id bigint NOT NULL,
 customer_user_id bigint NOT NULL REFERENCES app.users(id),
 source_seq bigint NOT NULL CHECK(source_seq>=0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','redacted')),
 draft_fields jsonb NOT NULL,
 confirmed_fields jsonb,
 lead_id bigint,
 confirmed_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
 FOREIGN KEY(enterprise_id,lead_id) REFERENCES app.leads(enterprise_id,id),
 CHECK(status!='confirmed' OR (confirmed_fields IS NOT NULL AND confirmed_at IS NOT NULL)),
 CHECK(lead_id IS NULL OR confirmed_at IS NOT NULL),
 UNIQUE(enterprise_id,id)
);
CREATE INDEX assistant_requirement_conversation_idx ON app.assistant_requirement_summaries(enterprise_id,conversation_id,id DESC);
ALTER TABLE app.assistant_requirement_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_requirement_summaries FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_requirement_summaries_tenant ON app.assistant_requirement_summaries FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_requirement_summaries TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_requirement_summaries_id_seq TO sfp_app;
