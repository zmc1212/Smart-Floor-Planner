-- Global users may have no enterprise. Expose a boolean, not a cross-tenant user row.
-- Retain the shared identity lock until the caller's tenant transaction commits.
CREATE FUNCTION app.assistant_identity_is_current(subject_id bigint, expected_version integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE previous_scope text; matched bigint;
BEGIN
  previous_scope := current_setting('app.is_platform_admin', true);
  PERFORM set_config('app.is_platform_admin','true',true);
  SELECT id INTO matched FROM app.users WHERE id=subject_id AND context_version=expected_version FOR SHARE;
  PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
  RETURN matched IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION app.assistant_identity_is_current(bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_identity_is_current(bigint,integer) TO sfp_app;
