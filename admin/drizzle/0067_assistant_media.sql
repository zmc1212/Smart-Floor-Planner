-- Small private consultation images are transactional, never public upload URLs.
CREATE TABLE app.assistant_media (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 conversation_id bigint NOT NULL,
 customer_user_id bigint NOT NULL REFERENCES app.users(id),
 request_key text NOT NULL,
 source_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('image','floorplan')),
 room_name text NOT NULL DEFAULT '' CHECK(length(room_name)<=80),
 mime_type text NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
 width integer NOT NULL CHECK(width>0 AND width<=2400),
 height integer NOT NULL CHECK(height>0 AND height<=2400),
 byte_size integer NOT NULL CHECK(byte_size>0 AND byte_size<=4194304),
 data bytea,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
 UNIQUE(enterprise_id,id),
 UNIQUE(enterprise_id,conversation_id,request_key),
 CHECK((deleted_at IS NULL AND data IS NOT NULL AND octet_length(data)=byte_size) OR (deleted_at IS NOT NULL AND data IS NULL))
);
CREATE INDEX assistant_media_conversation_idx ON app.assistant_media(enterprise_id,conversation_id,id);
ALTER TABLE app.assistant_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_media FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_media_tenant ON app.assistant_media FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_media TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_media_id_seq TO sfp_app;
