UPDATE "app"."system_roles"
SET
  "menu_keys" = array_append(COALESCE("menu_keys", '{}'::text[]), 'promotion-records'),
  "updated_at" = now()
WHERE "role_key" = 'enterprise_admin'
  AND NOT ('promotion-records' = ANY(COALESCE("menu_keys", '{}'::text[])));
