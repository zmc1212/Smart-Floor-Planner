-- P2C.4: enterprise-scoped portfolio template library (seeded sample works designers instantiate as own drafts).
CREATE TABLE app.portfolio_templates (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
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
 created_by bigint NOT NULL REFERENCES app.admin_users(id),
 updated_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,key)
);
CREATE TABLE app.portfolio_template_assets (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enterprise_id bigint NOT NULL, template_id bigint NOT NULL,
 image_base64 text NOT NULL CHECK(length(image_base64)<=409600),
 content_hash text NOT NULL,
 space text NOT NULL DEFAULT '其他' CHECK(space IN ('客厅','餐厅','主卧','次卧','儿童房','书房','厨房','卫生间','阳台','玄关','其他')),
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,template_id,position), UNIQUE(enterprise_id,template_id,content_hash),
 FOREIGN KEY(enterprise_id,template_id) REFERENCES app.portfolio_templates(enterprise_id,id) ON DELETE CASCADE
);
CREATE INDEX portfolio_template_list ON app.portfolio_templates(enterprise_id,status,sort_order,id DESC);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['portfolio_templates','portfolio_template_assets'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
