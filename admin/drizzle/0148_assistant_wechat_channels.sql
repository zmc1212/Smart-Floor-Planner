CREATE TABLE app.assistant_wechat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
  stage_id text NOT NULL CHECK (stage_id IN ('pre_construction','design','demolition','utilities','masonry','painting','installation','furnishing','completion','occupancy')),
  status text NOT NULL CHECK (status IN ('pending','connected','closed')),
  login_state text,
  qr_secret text,
  expires_at timestamptz,
  api_origin text NOT NULL,
  bot_id text,
  peer_id text,
  bot_secret text,
  user_id bigint UNIQUE REFERENCES app.users(id),
  conversation_id bigint,
  cursor_value text NOT NULL DEFAULT '',
  poll_after timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  last_poll_at timestamptz,
  last_reply_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enterprise_id,id),
  FOREIGN KEY (enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id),
  CHECK (status <> 'connected' OR (bot_id IS NOT NULL AND peer_id IS NOT NULL AND bot_secret IS NOT NULL AND user_id IS NOT NULL)),
  CHECK (status <> 'pending' OR (qr_secret IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX assistant_wechat_active_stage ON app.assistant_wechat_channels(enterprise_id,stage_id) WHERE status <> 'closed';
CREATE UNIQUE INDEX assistant_wechat_active_bot ON app.assistant_wechat_channels(bot_id) WHERE status='connected';
CREATE INDEX assistant_wechat_poll ON app.assistant_wechat_channels(enterprise_id,poll_after) WHERE status='connected';
--> statement-breakpoint
CREATE TABLE app.assistant_wechat_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enterprise_id bigint NOT NULL,
  channel_id uuid NOT NULL,
  event_key text NOT NULL,
  text_value text,
  context_secret text,
  run_id bigint,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','running','sending','sent','failed','unknown')),
  UNIQUE (channel_id,event_key),
  FOREIGN KEY (enterprise_id,channel_id) REFERENCES app.assistant_wechat_channels(enterprise_id,id),
  FOREIGN KEY (enterprise_id,run_id) REFERENCES app.assistant_runs(enterprise_id,id)
);
CREATE INDEX assistant_wechat_pending ON app.assistant_wechat_events(channel_id,id) WHERE status IN ('received','running','sending');
--> statement-breakpoint
ALTER TABLE app.assistant_wechat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_wechat_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_wechat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_wechat_events FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_wechat_channels_tenant ON app.assistant_wechat_channels FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
CREATE POLICY assistant_wechat_events_tenant ON app.assistant_wechat_events FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON app.assistant_wechat_channels, app.assistant_wechat_events TO sfp_app;
GRANT USAGE ON SEQUENCE app.assistant_wechat_events_id_seq TO sfp_app;
