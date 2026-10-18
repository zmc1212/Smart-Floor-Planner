ALTER TABLE app.portfolio_communities DROP CONSTRAINT portfolio_communities_provider_check;
ALTER TABLE app.portfolio_communities ADD CONSTRAINT portfolio_communities_provider_check
  CHECK(provider IN ('amap','tianditu','verified'));
ALTER TABLE app.portfolio_provider_usage ADD COLUMN provider_key text NOT NULL DEFAULT 'amap'
  CHECK(provider_key IN ('amap','tianditu'));
--> statement-breakpoint
CREATE FUNCTION app.portfolio_reserve_provider(subject_id bigint,target_enterprise_id bigint,page text,day_cap integer,source_provider text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE previous_scope text; ok boolean;
BEGIN
 IF source_provider NOT IN ('amap','tianditu') OR source_provider IS NULL
  OR app.portfolio_actor_access(subject_id,target_enterprise_id) IS NULL OR day_cap NOT BETWEEN 1 AND 10000 OR length(page)>64 THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portfolio:maps:budget',0));
 previous_scope:=current_setting('app.is_platform_admin',true);
 PERFORM set_config('app.is_platform_admin','true',true);
 -- Daily budget and provider-failure cooldown are separate per provider;
 -- short-window application/tenant/actor/page caps remain shared across them.
 SELECT count(*) FILTER(WHERE provider_key=source_provider)<day_cap
  AND count(*) FILTER(WHERE provider_key=source_provider AND blocked_until>now())=0
  AND count(*) FILTER(WHERE created_at>now()-interval '1 second')<3
  AND count(*) FILTER(WHERE enterprise_id=target_enterprise_id AND created_at>now()-interval '1 minute')<30
  AND count(*) FILTER(WHERE enterprise_id=target_enterprise_id AND actor_id=subject_id AND created_at>now()-interval '1 minute')<10
  AND count(*) FILTER(WHERE enterprise_id=target_enterprise_id AND actor_id=subject_id AND page_key=page AND created_at>now()-interval '1 minute')<8
 INTO ok FROM app.portfolio_provider_usage WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
 IF ok THEN INSERT INTO app.portfolio_provider_usage(enterprise_id,actor_id,page_key,provider_key) VALUES(target_enterprise_id,subject_id,page,source_provider); END IF;
 RETURN ok;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true); RAISE;
END $$;
REVOKE ALL ON FUNCTION app.portfolio_reserve_provider(bigint,bigint,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.portfolio_reserve_provider(bigint,bigint,text,integer,text) TO sfp_app;
--> statement-breakpoint
-- Old callers remain in the AMap budget and share the new global lock/caps.
CREATE OR REPLACE FUNCTION app.portfolio_reserve_provider(subject_id bigint,target_enterprise_id bigint,page text,day_cap integer)
RETURNS boolean LANGUAGE sql AS $$ SELECT app.portfolio_reserve_provider(subject_id,target_enterprise_id,page,day_cap,'amap') $$;
