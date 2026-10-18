-- 1A only: knowledge tables/citation resolvers are introduced with 1B.
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_enterprise_id_assistant_uidx ON app.admin_users(enterprise_id,id);
--> statement-breakpoint
CREATE TABLE app.assistant_enterprise_settings (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 enabled boolean NOT NULL DEFAULT false, knowledge_epoch integer NOT NULL DEFAULT 1, policy_version integer NOT NULL DEFAULT 1,
 daily_requests integer NOT NULL DEFAULT 0 CHECK(daily_requests BETWEEN 0 AND 100000), daily_tokens bigint NOT NULL DEFAULT 0 CHECK(daily_tokens>=0), daily_cost_micros bigint NOT NULL DEFAULT 0 CHECK(daily_cost_micros>=0),
 max_message_chars integer NOT NULL DEFAULT 4000 CHECK(max_message_chars BETWEEN 1 AND 4000), retention_days integer NOT NULL DEFAULT 0 CHECK(retention_days>=0), UNIQUE(enterprise_id)
);
ALTER TABLE app.assistant_enterprise_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_enterprise_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_enterprise_settings_tenant ON app.assistant_enterprise_settings FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_enterprise_settings TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_enterprise_settings_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_conversations (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 purpose text NOT NULL CHECK(purpose IN ('customer_consultation','knowledge_preview')), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','archived')),
 mode text NOT NULL DEFAULT 'ai' CHECK(mode IN ('ai','handoff_requested','human')), title text NOT NULL DEFAULT '', entry_snapshot jsonb NOT NULL DEFAULT '{}', policy_version integer NOT NULL DEFAULT 1,
 context_revision integer NOT NULL DEFAULT 1, last_seq bigint NOT NULL DEFAULT 0
);
ALTER TABLE app.assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_conversations_tenant ON app.assistant_conversations FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_conversations TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_conversations_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_participants (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 conversation_id bigint NOT NULL, principal_kind text NOT NULL, user_id bigint REFERENCES app.users(id), admin_id bigint,
 participant_role text NOT NULL DEFAULT 'owner', grant_basis jsonb NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')), revoked_at timestamptz,
 CHECK((principal_kind='user' AND user_id IS NOT NULL AND admin_id IS NULL) OR (principal_kind='admin' AND admin_id IS NOT NULL AND user_id IS NULL)),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
 FOREIGN KEY(enterprise_id,admin_id) REFERENCES app.admin_users(enterprise_id,id)
);
ALTER TABLE app.assistant_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_participants_tenant ON app.assistant_participants FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_participants TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_participants_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_context_bindings (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 conversation_id bigint NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL, relation text NOT NULL, source_version text NOT NULL, status text NOT NULL DEFAULT 'active',
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id)
);
ALTER TABLE app.assistant_context_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_context_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_context_bindings_tenant ON app.assistant_context_bindings FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_context_bindings TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_context_bindings_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_messages (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 conversation_id bigint NOT NULL, seq bigint NOT NULL, author_kind text NOT NULL CHECK(author_kind IN ('user','admin','assistant','system')),
 user_id bigint REFERENCES app.users(id), admin_id bigint, content jsonb NOT NULL CHECK(content->>'version'='1'), run_id bigint, source_event_id bigint, client_message_id text, purpose text NOT NULL DEFAULT 'reply', reply_to_message_id bigint,
 CHECK((author_kind='user' AND user_id IS NOT NULL AND admin_id IS NULL) OR (author_kind='admin' AND admin_id IS NOT NULL AND user_id IS NULL) OR (author_kind IN ('assistant','system') AND user_id IS NULL AND admin_id IS NULL)),
 UNIQUE(enterprise_id,conversation_id,seq), UNIQUE(enterprise_id,conversation_id,id),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
 FOREIGN KEY(enterprise_id,admin_id) REFERENCES app.admin_users(enterprise_id,id),
 FOREIGN KEY(enterprise_id,conversation_id,reply_to_message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id)
);
ALTER TABLE app.assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_messages_tenant ON app.assistant_messages FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_messages TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_messages_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_runs (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 conversation_id bigint NOT NULL, trigger_kind text NOT NULL, trigger_message_id bigint, trigger_event_id bigint, trigger_schedule_key text, retry_of_run_id bigint, purpose text NOT NULL DEFAULT 'reply',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','indeterminate')),
 policy_snapshot jsonb NOT NULL, context_revision integer NOT NULL, knowledge_epoch integer NOT NULL, output_message_id bigint, error_code text, started_at timestamptz, completed_at timestamptz,
 CHECK(num_nonnulls(trigger_message_id,trigger_event_id,trigger_schedule_key)=1),
 CHECK((trigger_kind='user_message' AND trigger_message_id IS NOT NULL) OR (trigger_kind='domain_event' AND trigger_event_id IS NOT NULL) OR (trigger_kind='scheduled_task' AND trigger_schedule_key IS NOT NULL)),
 UNIQUE(enterprise_id,conversation_id,id),
 FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
 FOREIGN KEY(enterprise_id,conversation_id,trigger_message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id),
 FOREIGN KEY(enterprise_id,conversation_id,output_message_id) REFERENCES app.assistant_messages(enterprise_id,conversation_id,id),
 FOREIGN KEY(enterprise_id,conversation_id,retry_of_run_id) REFERENCES app.assistant_runs(enterprise_id,conversation_id,id)
);
ALTER TABLE app.assistant_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_runs_tenant ON app.assistant_runs FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_runs TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_runs_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_jobs (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 kind text NOT NULL CHECK(kind='chat_turn'), run_id bigint NOT NULL, dedupe_key text NOT NULL, payload_version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','indeterminate')), attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_token text, lease_expires_at timestamptz, heartbeat_at timestamptz, provider_started_at timestamptz, last_error text,
 UNIQUE(enterprise_id,run_id), UNIQUE(enterprise_id,dedupe_key), FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id)
);
ALTER TABLE app.assistant_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_jobs_tenant ON app.assistant_jobs FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_jobs TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_jobs_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_run_steps (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 run_id bigint NOT NULL, step_seq integer NOT NULL, kind text NOT NULL, capability_name text, capability_version integer, provider_attempt_id bigint,
 input_summary jsonb NOT NULL DEFAULT '{}', source_refs jsonb NOT NULL DEFAULT '[]', duration_ms integer, status text NOT NULL,
 UNIQUE(enterprise_id,run_id,step_seq), FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id)
);
ALTER TABLE app.assistant_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_run_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_run_steps_tenant ON app.assistant_run_steps FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_run_steps TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_run_steps_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.domain_event_outbox (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 type text NOT NULL, event_version integer NOT NULL DEFAULT 1, aggregate_type text NOT NULL, aggregate_id text NOT NULL, aggregate_version integer NOT NULL,
 actor_ref jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id text NOT NULL, causation_id text, payload jsonb NOT NULL DEFAULT '{}',
 UNIQUE(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version)
);
ALTER TABLE app.domain_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.domain_event_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_event_outbox_tenant ON app.domain_event_outbox FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.domain_event_outbox TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.domain_event_outbox_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.domain_event_deliveries (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 event_id bigint NOT NULL, consumer_key text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','retry_wait','dead')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_token text, lease_expires_at timestamptz, last_error text,
 UNIQUE(enterprise_id,event_id,consumer_key), FOREIGN KEY(enterprise_id,event_id) REFERENCES app.domain_event_outbox(enterprise_id,id)
);
ALTER TABLE app.domain_event_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.domain_event_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_event_deliveries_tenant ON app.domain_event_deliveries FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.domain_event_deliveries TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.domain_event_deliveries_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_usage_records (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 run_id bigint NOT NULL, provider_attempt_id bigint, operation_key text NOT NULL, category text NOT NULL, quantity bigint, cost_micros bigint, currency text,
 measurement_kind text NOT NULL CHECK(measurement_kind IN ('observed','estimated','unavailable')), CHECK(measurement_kind!='unavailable' OR (quantity IS NULL AND cost_micros IS NULL)),
 UNIQUE(enterprise_id,operation_key,category), FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id)
);
ALTER TABLE app.assistant_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_usage_records FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_usage_records_tenant ON app.assistant_usage_records FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_usage_records TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_usage_records_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_idempotency_records (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 principal_key text NOT NULL, operation text NOT NULL, key text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL, status text NOT NULL DEFAULT 'completed' CHECK(status='completed'), expires_at timestamptz NOT NULL,
 UNIQUE(enterprise_id,principal_key,operation,key)
);
ALTER TABLE app.assistant_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_idempotency_records_tenant ON app.assistant_idempotency_records FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_idempotency_records TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_idempotency_records_id_seq TO sfp_app;
--> statement-breakpoint
CREATE TABLE app.assistant_quota_reservations (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(enterprise_id,id),
 run_id bigint NOT NULL, operation_key text NOT NULL, budget_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 reserved_requests integer NOT NULL DEFAULT 1, reserved_tokens bigint NOT NULL, reserved_cost_micros bigint NOT NULL, status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','settled','released','reconciling')),
 UNIQUE(enterprise_id,operation_key), FOREIGN KEY(enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id)
);
ALTER TABLE app.assistant_quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_quota_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_quota_reservations_tenant ON app.assistant_quota_reservations FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_quota_reservations TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_quota_reservations_id_seq TO sfp_app;
--> statement-breakpoint
ALTER TABLE app.assistant_messages ADD FOREIGN KEY(enterprise_id,conversation_id,run_id) REFERENCES app.assistant_runs(enterprise_id,conversation_id,id);
ALTER TABLE app.assistant_messages ADD FOREIGN KEY(enterprise_id,source_event_id) REFERENCES app.domain_event_outbox(enterprise_id,id);
ALTER TABLE app.assistant_runs ADD FOREIGN KEY(enterprise_id,trigger_event_id) REFERENCES app.domain_event_outbox(enterprise_id,id);
CREATE UNIQUE INDEX assistant_participant_user ON app.assistant_participants(enterprise_id,conversation_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX assistant_participant_admin ON app.assistant_participants(enterprise_id,conversation_id,admin_id) WHERE admin_id IS NOT NULL;
CREATE INDEX assistant_participant_locator ON app.assistant_participants(user_id,conversation_id) WHERE status='active';
CREATE UNIQUE INDEX assistant_binding_active ON app.assistant_context_bindings(enterprise_id,conversation_id,resource_type,resource_id,relation) WHERE status='active';
CREATE UNIQUE INDEX assistant_message_user_key ON app.assistant_messages(enterprise_id,conversation_id,user_id,client_message_id) WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX assistant_message_run ON app.assistant_messages(enterprise_id,run_id) WHERE author_kind='assistant';
CREATE UNIQUE INDEX assistant_message_event ON app.assistant_messages(enterprise_id,conversation_id,source_event_id,purpose) WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX assistant_run_active ON app.assistant_runs(enterprise_id,conversation_id) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX assistant_run_first_message ON app.assistant_runs(enterprise_id,trigger_message_id,purpose) WHERE retry_of_run_id IS NULL AND trigger_kind='user_message';
CREATE UNIQUE INDEX assistant_run_first_event ON app.assistant_runs(enterprise_id,conversation_id,trigger_event_id,purpose) WHERE retry_of_run_id IS NULL AND trigger_kind='domain_event';
CREATE UNIQUE INDEX assistant_run_first_schedule ON app.assistant_runs(enterprise_id,conversation_id,trigger_schedule_key,purpose) WHERE retry_of_run_id IS NULL AND trigger_kind='scheduled_task';
CREATE INDEX assistant_job_claim ON app.assistant_jobs(status,available_at,lease_expires_at);
CREATE INDEX assistant_delivery_claim ON app.domain_event_deliveries(status,available_at,lease_expires_at);
CREATE INDEX assistant_quota_window ON app.assistant_quota_reservations(enterprise_id,budget_date);
ALTER TABLE app.ai_provider_attempts ADD COLUMN assistant_run_id bigint;
ALTER TABLE app.ai_provider_attempts ADD COLUMN knowledge_job_id bigint;
ALTER TABLE app.ai_provider_attempts ADD CONSTRAINT provider_invocation_owner CHECK(num_nonnulls(generation_id,assistant_run_id,knowledge_job_id)<=1);
ALTER TABLE app.ai_provider_attempts ADD FOREIGN KEY(enterprise_id,assistant_run_id) REFERENCES app.assistant_runs(enterprise_id,id);
CREATE UNIQUE INDEX ai_provider_attempts_enterprise_id_assistant_uidx ON app.ai_provider_attempts(enterprise_id,id);
ALTER TABLE app.assistant_run_steps ADD FOREIGN KEY(enterprise_id,provider_attempt_id) REFERENCES app.ai_provider_attempts(enterprise_id,id);
ALTER TABLE app.assistant_usage_records ADD FOREIGN KEY(enterprise_id,provider_attempt_id) REFERENCES app.ai_provider_attempts(enterprise_id,id);
CREATE INDEX ai_provider_attempts_assistant_run ON app.ai_provider_attempts(enterprise_id,assistant_run_id);
