ALTER TABLE app.portfolio_provider_usage ADD COLUMN failure_code text, ADD COLUMN blocked_until timestamptz;
ALTER TABLE app.portfolio_communities ADD COLUMN license_valid_until timestamptz;
ALTER TABLE app.portfolio_communities ADD CONSTRAINT portfolio_community_binding_rights CHECK(provider='verified' OR license_valid_until IS NOT NULL);
-- Uploaded originals are never mutable in place, including while an older version is public.
CREATE FUNCTION app.portfolio_asset_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'immutable portfolio asset'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER portfolio_asset_immutable BEFORE UPDATE ON app.portfolio_assets FOR EACH ROW EXECUTE FUNCTION app.portfolio_asset_immutable();
CREATE OR REPLACE FUNCTION app.portfolio_reserve_provider(subject_id bigint,target_enterprise_id bigint,page text,day_cap integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE previous_scope text; ok boolean;
BEGIN
 IF app.portfolio_actor_access(subject_id,target_enterprise_id) IS NULL OR day_cap NOT BETWEEN 1 AND 10000 OR length(page)>64 THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portfolio:amap:budget',0));
 previous_scope:=current_setting('app.is_platform_admin',true);
 PERFORM set_config('app.is_platform_admin','true',true);
 SELECT count(*)<day_cap AND count(*) FILTER(WHERE blocked_until>now())=0
  AND count(*) FILTER(WHERE created_at>now()-interval '1 second')<3
  AND count(*) FILTER(WHERE enterprise_id=target_enterprise_id AND created_at>now()-interval '1 minute')<30
  AND count(*) FILTER(WHERE enterprise_id=target_enterprise_id AND actor_id=subject_id AND created_at>now()-interval '1 minute')<10
  AND count(*) FILTER(WHERE enterprise_id=target_enterprise_id AND actor_id=subject_id AND page_key=page AND created_at>now()-interval '1 minute')<8
 INTO ok FROM app.portfolio_provider_usage WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
 IF ok THEN INSERT INTO app.portfolio_provider_usage(enterprise_id,actor_id,page_key) VALUES(target_enterprise_id,subject_id,page); END IF;
 RETURN ok;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true); RAISE;
END $$;
