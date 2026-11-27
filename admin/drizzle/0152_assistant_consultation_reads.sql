CREATE TABLE app.assistant_consultation_reads (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  enterprise_id bigint NOT NULL,
  conversation_id bigint NOT NULL,
  actor_id bigint NOT NULL REFERENCES app.admin_users(id),
  before_seq bigint CHECK (before_seq > 0),
  read_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (enterprise_id, conversation_id) REFERENCES app.assistant_conversations(enterprise_id, id) ON DELETE CASCADE
);
CREATE INDEX assistant_consultation_reads_history_idx ON app.assistant_consultation_reads(enterprise_id, conversation_id, read_at DESC, id DESC);
ALTER TABLE app.assistant_consultation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_consultation_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_consultation_reads_tenant ON app.assistant_consultation_reads FOR SELECT TO sfp_app
  USING (enterprise_id = (SELECT app.current_enterprise_id()));
CREATE POLICY assistant_consultation_reads_append ON app.assistant_consultation_reads FOR INSERT TO sfp_app
  WITH CHECK (enterprise_id = (SELECT app.current_enterprise_id()) AND app.assistant_knowledge_admin_is_current(actor_id, enterprise_id));
REVOKE UPDATE, DELETE ON app.assistant_consultation_reads FROM sfp_app;
GRANT SELECT, INSERT ON app.assistant_consultation_reads TO sfp_app;
GRANT USAGE, SELECT ON SEQUENCE app.assistant_consultation_reads_id_seq TO sfp_app;
--> statement-breakpoint
CREATE INDEX assistant_consultations_activity_idx ON app.assistant_conversations(enterprise_id, updated_at DESC, id DESC)
  WHERE purpose = 'customer_consultation' AND (entry_snapshot->>'scope') IS DISTINCT FROM 'public'
    AND (entry_snapshot->>'retentionRedacted') IS DISTINCT FROM 'true';
--> statement-breakpoint
-- Customer accounts are global. Limit this projection to the owners of readable enterprise consultations.
CREATE FUNCTION app.assistant_consultation_profiles(viewer_id bigint, selected_enterprise_id bigint, selected_conversation_id bigint)
RETURNS TABLE(user_id bigint, nickname text, context_version integer)
LANGUAGE plpgsql AS $$
DECLARE previous_scope text;
BEGIN
  IF selected_enterprise_id IS NULL OR selected_enterprise_id IS DISTINCT FROM app.current_enterprise_id()
    OR NOT app.assistant_knowledge_admin_is_current(viewer_id, selected_enterprise_id) THEN
    RETURN;
  END IF;

  previous_scope := current_setting('app.is_platform_admin', true);
  PERFORM set_config('app.is_platform_admin', 'true', true);
  RETURN QUERY SELECT DISTINCT u.id, u.nickname::text, u.context_version
    FROM app.assistant_conversations c
    JOIN app.assistant_participants p ON p.enterprise_id=c.enterprise_id AND p.conversation_id=c.id
    JOIN app.users u ON u.id=p.user_id
    WHERE c.enterprise_id=selected_enterprise_id AND c.purpose='customer_consultation'
      AND (selected_conversation_id IS NULL OR c.id=selected_conversation_id)
      AND c.entry_snapshot->>'scope' IS DISTINCT FROM 'public'
      AND c.entry_snapshot->>'kind' IS DISTINCT FROM 'public_consultation'
      AND c.entry_snapshot->>'retentionRedacted' IS DISTINCT FROM 'true'
      AND p.principal_kind='user' AND p.participant_role='owner' AND p.status='active';
  PERFORM set_config('app.is_platform_admin', coalesce(previous_scope,'false'), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.is_platform_admin', coalesce(previous_scope,'false'), true);
  RAISE;
END $$;
REVOKE ALL ON FUNCTION app.assistant_consultation_profiles(bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_consultation_profiles(bigint,bigint,bigint) TO sfp_app;
