CREATE TABLE app.assistant_main_publications (
  enterprise_id bigint PRIMARY KEY REFERENCES app.enterprises(id),
  version integer NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL,
  stages jsonb NOT NULL CHECK (jsonb_typeof(stages)='array'),
  reports boolean NOT NULL
);
ALTER TABLE app.assistant_main_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_main_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_main_publication_tenant ON app.assistant_main_publications FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_main_publications TO sfp_app;
--> statement-breakpoint
ALTER TABLE app.assistant_wechat_channels DROP CONSTRAINT assistant_wechat_channels_stage_id_check,
 ADD CONSTRAINT assistant_wechat_channels_target CHECK (stage_id IN ('main','pre_construction','design','demolition','utilities','masonry','painting','installation','furnishing','completion','occupancy')),
 ADD COLUMN recipient_key text,
 ADD COLUMN recipient_binding_id bigint,
 ADD COLUMN project_id bigint,
 ADD COLUMN mini_user_id bigint REFERENCES app.users(id),
 ADD COLUMN identity_version integer,
 ADD COLUMN recipient_requires_service boolean NOT NULL DEFAULT false,
 ADD COLUMN pair_secret text,
 ADD COLUMN pair_digest text,
 ADD COLUMN pair_until timestamptz,
 ADD COLUMN verified_at timestamptz,
 ADD COLUMN daily_since timestamptz,
 ADD COLUMN weekly_since timestamptz,
 ADD COLUMN latest_context text,
 ADD COLUMN recipient_version integer NOT NULL DEFAULT 1,
 ADD FOREIGN KEY (enterprise_id,recipient_binding_id) REFERENCES app.construction_followup_bindings(enterprise_id,id),
 ADD FOREIGN KEY (enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id),
 ADD CHECK (recipient_key IS NULL OR (stage_id='main' AND recipient_binding_id IS NOT NULL AND project_id IS NOT NULL AND mini_user_id IS NOT NULL AND identity_version IS NOT NULL));
DROP INDEX app.assistant_wechat_active_stage;
CREATE UNIQUE INDEX assistant_wechat_active_stage ON app.assistant_wechat_channels(enterprise_id,stage_id) WHERE status <> 'closed' AND recipient_key IS NULL;
CREATE UNIQUE INDEX assistant_wechat_active_recipient ON app.assistant_wechat_channels(enterprise_id,mini_user_id) WHERE status <> 'closed' AND recipient_key IS NOT NULL;
CREATE UNIQUE INDEX assistant_wechat_pair_digest ON app.assistant_wechat_channels(enterprise_id,pair_digest) WHERE pair_digest IS NOT NULL;
--> statement-breakpoint
ALTER TABLE app.assistant_wechat_events ADD COLUMN report_kind text CHECK (report_kind IN ('daily','weekly')),
 ADD COLUMN report_id bigint, ADD COLUMN report_revision integer, ADD COLUMN recipient_version integer,
 ADD COLUMN proactive boolean NOT NULL DEFAULT false,
 ADD FOREIGN KEY (enterprise_id,report_id,report_revision) REFERENCES app.construction_report_versions(enterprise_id,report_id,revision);
