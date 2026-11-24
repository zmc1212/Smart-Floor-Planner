-- Extend the main XiaoK personal-WeChat channel from one project to the
-- already-authorized role binding. Existing channels keep their single-project
-- shape until the recipient explicitly upgrades in the Mini Program.
ALTER TABLE app.assistant_wechat_channels
  ADD COLUMN recipient_audience text,
  ADD CONSTRAINT assistant_wechat_channels_recipient_audience_check
    CHECK (recipient_audience IS NULL OR recipient_audience IN ('customer','worker','designer','boss'));

-- 0149's check predates role-scoped recipients and requires a project for
-- every verified channel. Replace it with a shape check that accepts the
-- legacy project recipient and the role recipient forms.
ALTER TABLE app.assistant_wechat_channels
  DROP CONSTRAINT assistant_wechat_channels_check2;
ALTER TABLE app.assistant_wechat_channels
  ADD CONSTRAINT assistant_wechat_channels_recipient_shape_check
    CHECK ((
      recipient_audience IS NULL OR recipient_key IS NOT NULL
    ) AND (
      recipient_key IS NULL OR (
        stage_id='main' AND mini_user_id IS NOT NULL AND identity_version IS NOT NULL AND
        CASE
          WHEN recipient_audience IS NULL THEN recipient_binding_id IS NOT NULL AND project_id IS NOT NULL
          WHEN recipient_audience='customer' THEN recipient_binding_id IS NULL AND project_id IS NULL
          ELSE recipient_binding_id IS NOT NULL AND project_id IS NULL
        END
      )
    ));

ALTER TABLE app.assistant_wechat_events
  ADD COLUMN role_delivery_key text;
CREATE UNIQUE INDEX assistant_wechat_role_delivery_key
  ON app.assistant_wechat_events(enterprise_id,role_delivery_key)
  WHERE role_delivery_key IS NOT NULL;
