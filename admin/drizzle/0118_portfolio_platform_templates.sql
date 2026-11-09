-- P2C.5: shared platform portfolio template library.
-- Rows keep their owning (curating) enterprise for FK integrity; scope='platform'
-- makes published rows readable by every tenant as a read-only sample library.
-- Tenant writes stay tenant-scoped and only platform-admin sessions may publish
-- a row into the shared library.
ALTER TABLE app.portfolio_templates ADD COLUMN scope text NOT NULL DEFAULT 'enterprise';
ALTER TABLE app.portfolio_templates ADD CONSTRAINT portfolio_templates_scope_check CHECK(scope IN ('enterprise','platform'));
CREATE INDEX portfolio_template_platform ON app.portfolio_templates(scope,status,sort_order,id DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_portfolio_template_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.scope = 'platform' AND NOT app.has_platform_access() THEN
    RAISE EXCEPTION 'platform portfolio template scope requires platform access';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS portfolio_template_scope_guard ON app.portfolio_templates;
CREATE TRIGGER portfolio_template_scope_guard
BEFORE INSERT OR UPDATE OF scope ON app.portfolio_templates
FOR EACH ROW EXECUTE FUNCTION app.guard_portfolio_template_scope();
--> statement-breakpoint
DROP POLICY tenant_scope ON app.portfolio_templates;
CREATE POLICY tenant_scope ON app.portfolio_templates
USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
CREATE POLICY platform_read ON app.portfolio_templates
FOR SELECT USING (scope='platform' AND status='published');
--> statement-breakpoint
DROP POLICY tenant_scope ON app.portfolio_template_assets;
CREATE POLICY tenant_scope ON app.portfolio_template_assets
USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
CREATE POLICY platform_read ON app.portfolio_template_assets
FOR SELECT USING (EXISTS (
  SELECT 1 FROM app.portfolio_templates t
  WHERE t.enterprise_id=portfolio_template_assets.enterprise_id
    AND t.id=portfolio_template_assets.template_id
    AND t.scope='platform' AND t.status='published'
));
