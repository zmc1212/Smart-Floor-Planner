ALTER TABLE "app"."platform_configs"
  ADD COLUMN IF NOT EXISTS "notification_config" jsonb;

UPDATE "app"."platform_configs"
SET "notification_config" = '{}'::jsonb
WHERE "notification_config" IS NULL;

ALTER TABLE "app"."platform_configs"
  ALTER COLUMN "notification_config" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "notification_config" SET NOT NULL;

INSERT INTO "app"."platform_configs" ("key", "notification_config")
VALUES ('default', '{}'::jsonb)
ON CONFLICT ("key") DO NOTHING;

UPDATE "app"."platform_configs"
SET "notification_config" = jsonb_build_object(
  'version', 2,
  'legacyTemplateId', COALESCE(
    NULLIF("notification_config"->>'legacyTemplateId', ''),
    NULLIF("notification_config"->>'miniprogramTemplateId', '')
  ),
  'templates', jsonb_build_object(
    'workflow_todo', jsonb_build_object(
      'title', '装修待办提醒',
      'templateId', '48Jvq7OjOKwRhshn8fyvtsjxAamLOakaNtiKcO11rOc',
      'keywordKeys', jsonb_build_object('projectName', 'thing4', 'owner', 'thing11', 'currentStatus', 'phrase12', 'todo', 'thing2', 'note', 'thing5')
    ),
    'lead_assignment', jsonb_build_object(
      'title', '客户指派成功通知',
      'templateId', 'wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA',
      'keywordKeys', jsonb_build_object('customerName', 'thing1', 'customerStatus', 'phrase2', 'note', 'thing3', 'assignedAt', 'time4')
    ),
    'new_lead', jsonb_build_object(
      'title', '新增客户成功通知',
      'templateId', 'EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc',
      'keywordKeys', jsonb_build_object('customerName', 'name1', 'addedAt', 'date2', 'owner', 'name3', 'phone', 'phone_number4', 'selectedAt', 'time5')
    ),
    'measurement_appointment', jsonb_build_object(
      'title', '上门量房提醒',
      'templateId', 'CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl',
      'keywordKeys', jsonb_build_object('customerName', 'thing1', 'phone', 'phone_number2', 'community', 'thing3', 'measurementAt', 'time6', 'reminder', 'thing7')
    )
  )
)
WHERE "key" = 'default'
  AND CASE
    WHEN COALESCE("notification_config"->>'version', '') ~ '^[0-9]+$'
      THEN ("notification_config"->>'version')::integer
    ELSE 0
  END < 2;
