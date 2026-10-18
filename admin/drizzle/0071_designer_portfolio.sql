-- P2C.1: independent author-owned drafts and immutable reviewed publications.
CREATE TABLE app.portfolio_communities (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 provider text NOT NULL CHECK(provider IN ('amap','verified')),
 provider_poi_id text,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 city_code text NOT NULL CHECK(city_code ~ '^[1-9][0-9]{3}00$'),
 city_name text NOT NULL, district text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
 provenance text NOT NULL, verified_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(enterprise_id,id),
 UNIQUE(enterprise_id,provider,provider_poi_id)
);
CREATE TABLE app.portfolio_profiles (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 author_id bigint NOT NULL, content jsonb NOT NULL DEFAULT '{"bio":"","cities":[],"styles":[],"featuredWorkIds":[]}',
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,author_id), FOREIGN KEY(enterprise_id,author_id) REFERENCES app.admin_users(enterprise_id,id)
);
CREATE TABLE app.portfolio_works (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 kind text NOT NULL CHECK(kind IN ('designer_work','enterprise_reference')),
 author_id bigint, head_version_id bigint, published_version_id bigint,
 withdrawn boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by bigint NOT NULL REFERENCES app.admin_users(id), updated_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id),
 CHECK((kind='designer_work' AND author_id IS NOT NULL) OR (kind='enterprise_reference' AND author_id IS NULL)),
 FOREIGN KEY(enterprise_id,author_id) REFERENCES app.admin_users(enterprise_id,id)
);
CREATE TABLE app.portfolio_versions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL, work_id bigint NOT NULL, number integer NOT NULL CHECK(number>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','returned','published')),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=25000),
 search_text text NOT NULL DEFAULT '', review_note text NOT NULL DEFAULT '',
 submitted_at timestamptz, published_at timestamptz, reviewed_by bigint REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,work_id,id), UNIQUE(enterprise_id,work_id,number),
 FOREIGN KEY(enterprise_id,work_id) REFERENCES app.portfolio_works(enterprise_id,id) ON DELETE CASCADE
);
ALTER TABLE app.portfolio_works
 ADD FOREIGN KEY(enterprise_id,id,head_version_id) REFERENCES app.portfolio_versions(enterprise_id,work_id,id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(enterprise_id,id,published_version_id) REFERENCES app.portfolio_versions(enterprise_id,work_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE app.portfolio_assets (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL, work_id bigint NOT NULL,
 image_base64 text NOT NULL CHECK(length(image_base64)<=409600),
 content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,work_id,content_hash),
 FOREIGN KEY(enterprise_id,work_id) REFERENCES app.portfolio_works(enterprise_id,id) ON DELETE CASCADE
);
CREATE TABLE app.portfolio_audits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL,
 work_id bigint NOT NULL, version_id bigint NOT NULL,
 actor_id bigint NOT NULL REFERENCES app.admin_users(id), action text NOT NULL, note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,work_id,version_id) REFERENCES app.portfolio_versions(enterprise_id,work_id,id) ON DELETE CASCADE
);
CREATE TABLE app.portfolio_community_requests (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 requested_by bigint NOT NULL REFERENCES app.admin_users(id), city_code text NOT NULL, city_name text NOT NULL,
 name text NOT NULL, district text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 community_id bigint, review_note text NOT NULL DEFAULT '', reviewed_by bigint REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enterprise_id,community_id) REFERENCES app.portfolio_communities(enterprise_id,id)
);
CREATE TABLE app.portfolio_provider_usage (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 actor_id bigint NOT NULL REFERENCES app.admin_users(id), page_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_work_author ON app.portfolio_works(enterprise_id,author_id,id DESC);
CREATE INDEX portfolio_version_search ON app.portfolio_versions USING gin(to_tsvector('simple',search_text));
CREATE INDEX portfolio_provider_usage_time ON app.portfolio_provider_usage(created_at,enterprise_id,actor_id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['portfolio_communities','portfolio_profiles','portfolio_works','portfolio_versions','portfolio_assets','portfolio_audits','portfolio_community_requests','portfolio_provider_usage'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
CREATE FUNCTION app.portfolio_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='published' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'immutable portfolio publication'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portfolio_publication_immutable BEFORE UPDATE ON app.portfolio_versions FOR EACH ROW EXECUTE FUNCTION app.portfolio_version_immutable();
-- A distinct menu grant; this never grants designers enterprise knowledge access.
UPDATE app.system_roles SET menu_keys=array_append(menu_keys,'case-publishing')
 WHERE role_key IN ('super_admin','admin','enterprise_admin','designer') AND NOT ('case-publishing'=ANY(menu_keys));
CREATE FUNCTION app.portfolio_actor_access(subject_id bigint,target_enterprise_id bigint) RETURNS text LANGUAGE plpgsql AS $$
DECLARE previous_scope text; subject app.admin_users%ROWTYPE; permitted boolean;
BEGIN
 IF NOT app.has_platform_access() AND target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN NULL; END IF;
 previous_scope:=current_setting('app.is_platform_admin',true);
 PERFORM set_config('app.is_platform_admin','true',true);
 SELECT * INTO subject FROM app.admin_users WHERE id=subject_id AND status='active' AND must_change_password=false FOR SHARE;
 IF FOUND AND (subject.role IN ('super_admin','admin') OR (subject.enterprise_id=target_enterprise_id AND subject.role IN ('enterprise_admin','designer'))) THEN
  SELECT 'case-publishing'=ANY(menu_keys) INTO permitted FROM app.system_roles WHERE role_key=subject.role FOR SHARE;
  permitted:=coalesce(permitted,true);
 ELSE permitted:=false; END IF;
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true);
 IF NOT permitted THEN RETURN NULL; END IF;
 RETURN CASE WHEN subject.role='designer' THEN 'designer' ELSE 'manager' END;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.is_platform_admin',coalesce(previous_scope,'false'),true); RAISE;
END $$;
REVOKE ALL ON FUNCTION app.portfolio_actor_access(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.portfolio_actor_access(bigint,bigint) TO sfp_app;
-- Shared counters across processes/tenants, with no POI, query, API key or customer content.
CREATE FUNCTION app.portfolio_reserve_provider(subject_id bigint,target_enterprise_id bigint,page text,day_cap integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE previous_scope text; ok boolean;
BEGIN
 IF app.portfolio_actor_access(subject_id,target_enterprise_id) IS NULL OR day_cap NOT BETWEEN 1 AND 10000 OR length(page)>64 THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portfolio:amap:budget',0));
 previous_scope:=current_setting('app.is_platform_admin',true);
 PERFORM set_config('app.is_platform_admin','true',true);
 SELECT count(*)<day_cap AND count(*) FILTER(WHERE created_at>now()-interval '1 second')<3
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
REVOKE ALL ON FUNCTION app.portfolio_reserve_provider(bigint,bigint,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.portfolio_reserve_provider(bigint,bigint,text,integer) TO sfp_app;
