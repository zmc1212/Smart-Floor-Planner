-- Resolve the customer's current service from real leads, including older
-- leads without attribution locks. Consultation history cannot grant service.
CREATE FUNCTION app.assistant_customer_service(subject_id bigint)
RETURNS TABLE (enterprise_id bigint, lead_id bigint, ambiguous boolean)
LANGUAGE sql
SET search_path = pg_catalog, app
SET app.is_platform_admin = 'true'
AS $$
  WITH eligible AS MATERIALIZED (
    SELECT l.enterprise_id, l.id AS lead_id
    FROM app.leads l
    JOIN app.enterprises e ON e.id = l.enterprise_id AND e.status = 'active'
    WHERE l.customer_user_id = subject_id AND l.archived_at IS NULL AND l.status <> 'closed'
    FOR SHARE OF l, e
  ), attributed AS MATERIALIZED (
    SELECT l.enterprise_id, l.lead_id
    FROM app.customer_attribution_locks a
    JOIN eligible l ON l.enterprise_id = a.enterprise_id AND l.lead_id = a.lead_id
    WHERE a.customer_user_id = subject_id AND a.released_at IS NULL
    FOR SHARE OF a
  ), current_leads AS (
    SELECT a.enterprise_id, a.lead_id FROM attributed a
    UNION ALL
    SELECT e.enterprise_id, e.lead_id FROM eligible e WHERE NOT EXISTS (SELECT 1 FROM attributed)
  )
  SELECT CASE WHEN count(DISTINCT s.enterprise_id) = 1 THEN min(s.enterprise_id) END,
         CASE WHEN count(DISTINCT s.enterprise_id) = 1 THEN min(s.lead_id) END,
         count(DISTINCT s.enterprise_id) > 1
  FROM current_leads s;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.assistant_customer_service(bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.assistant_customer_service(bigint) TO sfp_app;
