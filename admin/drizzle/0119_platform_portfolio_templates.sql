-- P2C.5: platform-owned portfolio template library.
-- Templates and sample images no longer belong to a tenant. Published rows are
-- readable by every authenticated tenant for the material gallery; only
-- platform-admin transactions may insert or change them. Tenant cleanup/reset
-- never touches these tables.
CREATE TABLE app.platform_portfolio_templates (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 key text NOT NULL CHECK(length(key) BETWEEN 1 AND 64),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 50),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=400),
 primary_style text NOT NULL CHECK(length(primary_style) BETWEEN 1 AND 30),
 layout_types jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(layout_types)='array'),
 rooms text NOT NULL DEFAULT '' CHECK(length(rooms)<=30),
 area integer CHECK(area IS NULL OR area BETWEEN 1 AND 100000),
 city_code text NOT NULL CHECK(city_code ~ '^[1-9][0-9]{3}00$'),
 city_name text NOT NULL DEFAULT '' CHECK(length(city_name)<=50),
 district text NOT NULL DEFAULT '' CHECK(length(district)<=100),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=24000),
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','retired')),
 sort_order integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 created_by bigint REFERENCES app.admin_users(id) ON DELETE SET NULL,
 updated_by bigint REFERENCES app.admin_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(key)
);
CREATE TABLE app.platform_portfolio_template_assets (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 template_id bigint NOT NULL REFERENCES app.platform_portfolio_templates(id) ON DELETE CASCADE,
 image_base64 text NOT NULL CHECK(length(image_base64)<=409600),
 content_hash text NOT NULL,
 space text NOT NULL DEFAULT '其他' CHECK(space IN ('客厅','餐厅','主卧','次卧','儿童房','书房','厨房','卫生间','阳台','玄关','其他')),
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_id,position), UNIQUE(template_id,content_hash)
);
CREATE TABLE app.platform_portfolio_template_audits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 template_id bigint NOT NULL REFERENCES app.platform_portfolio_templates(id) ON DELETE CASCADE,
 actor_id bigint REFERENCES app.admin_users(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN ('publish','retire')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_portfolio_template_list ON app.platform_portfolio_templates(status,sort_order,id DESC);
CREATE INDEX platform_portfolio_template_assets_list ON app.platform_portfolio_template_assets(template_id,position,id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_portfolio_templates','platform_portfolio_template_assets','platform_portfolio_template_audits'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
--> statement-breakpoint
CREATE POLICY tenant_read ON app.platform_portfolio_templates
FOR SELECT USING (status='published' OR app.has_platform_access());
CREATE POLICY platform_write ON app.platform_portfolio_templates
FOR ALL USING (app.has_platform_access()) WITH CHECK (app.has_platform_access());
CREATE POLICY tenant_read ON app.platform_portfolio_template_assets
FOR SELECT USING (app.has_platform_access() OR EXISTS (
  SELECT 1 FROM app.platform_portfolio_templates t
  WHERE t.id=platform_portfolio_template_assets.template_id AND t.status='published'
));
CREATE POLICY platform_write ON app.platform_portfolio_template_assets
FOR ALL USING (app.has_platform_access()) WITH CHECK (app.has_platform_access());
CREATE POLICY platform_all ON app.platform_portfolio_template_audits
FOR ALL USING (app.has_platform_access()) WITH CHECK (app.has_platform_access());
--> statement-breakpoint
-- The migrator runs under FORCE RLS; elevate this transaction only for the one-time copy.
SELECT set_config('app.is_platform_admin','true',true);
--> statement-breakpoint
-- Move every row that 0118 exposed as platform scope into the platform tables.
INSERT INTO app.platform_portfolio_templates(key,title,description,primary_style,layout_types,rooms,area,city_code,city_name,district,content,status,sort_order,created_by,updated_by,created_at,updated_at)
SELECT key,title,description,primary_style,layout_types,rooms,area,city_code,city_name,district,content,status,sort_order,created_by,updated_by,created_at,updated_at
FROM app.portfolio_templates WHERE scope='platform'
ON CONFLICT(key) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.platform_portfolio_template_assets(template_id,image_base64,content_hash,space,position,created_at)
SELECT p.id,a.image_base64,a.content_hash,a.space,a.position,a.created_at
FROM app.portfolio_template_assets a
JOIN app.portfolio_templates t ON t.enterprise_id=a.enterprise_id AND t.id=a.template_id
JOIN app.platform_portfolio_templates p ON p.key=t.key
WHERE t.scope='platform'
ON CONFLICT(template_id,position) DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE expected_templates int; copied_templates int; expected_assets int; copied_assets int;
BEGIN
 SELECT count(*) INTO expected_templates FROM app.portfolio_templates WHERE scope='platform';
 SELECT count(*) INTO copied_templates FROM app.platform_portfolio_templates p
  WHERE EXISTS (SELECT 1 FROM app.portfolio_templates t WHERE t.scope='platform' AND t.key=p.key);
 IF copied_templates <> expected_templates THEN RAISE EXCEPTION 'platform template copy incomplete: %/%', copied_templates, expected_templates; END IF;
 SELECT count(*) INTO expected_assets FROM app.portfolio_template_assets a
  JOIN app.portfolio_templates t ON t.enterprise_id=a.enterprise_id AND t.id=a.template_id WHERE t.scope='platform';
 SELECT count(*) INTO copied_assets FROM app.platform_portfolio_template_assets;
 IF copied_assets <> expected_assets THEN RAISE EXCEPTION 'platform template asset copy incomplete: %/%', copied_assets, expected_assets; END IF;
END $$;
--> statement-breakpoint
DELETE FROM app.portfolio_templates WHERE scope='platform';
--> statement-breakpoint
-- Restore the pre-0118 tenant-only template library.
DROP POLICY IF EXISTS platform_read ON app.portfolio_template_assets;
DROP POLICY IF EXISTS platform_read ON app.portfolio_templates;
DROP TRIGGER IF EXISTS portfolio_template_scope_guard ON app.portfolio_templates;
DROP FUNCTION IF EXISTS app.guard_portfolio_template_scope();
DROP INDEX IF EXISTS app.portfolio_template_platform;
ALTER TABLE app.portfolio_templates DROP CONSTRAINT IF EXISTS portfolio_templates_scope_check;
ALTER TABLE app.portfolio_templates DROP COLUMN IF EXISTS scope;
