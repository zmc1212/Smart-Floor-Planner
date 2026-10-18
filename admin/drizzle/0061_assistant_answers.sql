ALTER TABLE app.assistant_messages ADD COLUMN answer_kind text CHECK(answer_kind IN ('grounded','insufficient_evidence'));
ALTER TABLE app.assistant_runs ADD COLUMN answer_kind text CHECK(answer_kind IN ('grounded','insufficient_evidence'));
CREATE UNIQUE INDEX assistant_message_admin_key ON app.assistant_messages(enterprise_id,conversation_id,admin_id,client_message_id) WHERE admin_id IS NOT NULL AND client_message_id IS NOT NULL;
ALTER TABLE app.assistant_knowledge_chunks ADD UNIQUE(enterprise_id,document_version_id,id);
CREATE TABLE app.assistant_message_citations (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 conversation_id bigint NOT NULL, message_id bigint NOT NULL, run_id bigint NOT NULL,
 source_kind text NOT NULL CHECK(source_kind='knowledge'), resource_type text NOT NULL CHECK(resource_type='knowledge_chunk'),
 resource_id text NOT NULL, resource_version text NOT NULL,
 document_id bigint NOT NULL, document_version_id bigint NOT NULL, chunk_id bigint,
 source_hash text NOT NULL, quote_snapshot text NOT NULL CHECK(length(quote_snapshot)<=600), locator jsonb NOT NULL,
 is_draft boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,message_id,resource_id),
 FOREIGN KEY(enterprise_id,conversation_id,message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id),
 FOREIGN KEY(enterprise_id,conversation_id,run_id) REFERENCES app.assistant_runs(enterprise_id,conversation_id,id),
 FOREIGN KEY(enterprise_id,document_id,document_version_id) REFERENCES app.assistant_knowledge_versions(enterprise_id,document_id,id),
 FOREIGN KEY(enterprise_id,document_version_id,chunk_id) REFERENCES app.assistant_knowledge_chunks(enterprise_id,document_version_id,id) ON DELETE SET NULL (chunk_id)
);
ALTER TABLE app.assistant_message_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_message_citations FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_message_citations_tenant ON app.assistant_message_citations FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_message_citations TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_message_citations_id_seq TO sfp_app;
CREATE INDEX assistant_citations_message ON app.assistant_message_citations(enterprise_id,message_id);
