CREATE TABLE app.assistant_speech_assets (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 conversation_id bigint NOT NULL,
 project_id bigint,
 principal_key text NOT NULL,
 request_key text NOT NULL,
 source_hash text NOT NULL,
 duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 300 AND 60000),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 44 AND 2097152),
 data bytea,
 configuration_hash text NOT NULL,
 run_id bigint,
 message_id bigint,
 transcript text NOT NULL DEFAULT '',
 corrected_text text NOT NULL DEFAULT '',
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,conversation_id,principal_key,request_key), UNIQUE(enterprise_id,message_id),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,conversation_id,message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id) ON DELETE CASCADE,
 CHECK(char_length(transcript)<=4000 AND char_length(corrected_text)<=4000),
 CHECK((deleted_at IS NULL AND data IS NOT NULL) OR (deleted_at IS NOT NULL AND data IS NULL AND transcript='' AND corrected_text=''))
);
ALTER TABLE app.assistant_speech_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_speech_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_speech_assets_tenant ON app.assistant_speech_assets FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_speech_assets TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_speech_assets_id_seq TO sfp_app;
