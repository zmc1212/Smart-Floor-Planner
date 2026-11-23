CREATE TABLE app.assistant_answer_feedback (
  enterprise_id bigint NOT NULL,
  conversation_id bigint NOT NULL,
  message_id bigint NOT NULL,
  user_id bigint NOT NULL REFERENCES app.users(id),
  rating text NOT NULL,
  reason text,
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, conversation_id, user_id, message_id),
  FOREIGN KEY (enterprise_id, conversation_id, message_id)
    REFERENCES app.assistant_messages(enterprise_id, conversation_id, id) ON DELETE CASCADE,
  CHECK (char_length(note) <= 400),
  CHECK ((rating = 'helpful' AND reason IS NULL AND note = '') OR
    (rating = 'issue' AND reason IS NOT NULL AND reason IN ('incorrect', 'off_topic', 'unclear', 'other')))
);
--> statement-breakpoint
ALTER TABLE app.assistant_answer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_answer_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_answer_feedback_tenant ON app.assistant_answer_feedback FOR ALL TO sfp_app
  USING ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()))
  WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id = (SELECT app.current_enterprise_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON app.assistant_answer_feedback TO sfp_app;
