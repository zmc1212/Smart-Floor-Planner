-- D7 milestone ③: repairs, service-period extensions, early exit and deposit
-- disposition. Amounts record an offline settlement only; this schema neither
-- initiates nor verifies a payment, collection or refund.
ALTER TABLE app.construction_service_orders DROP CONSTRAINT construction_service_orders_status_check;
ALTER TABLE app.construction_service_orders ADD CONSTRAINT construction_service_orders_status_check
 CHECK(status IN ('pending_quote','quoted','confirmed','scheduled','accepted','exited','cancelled'));
-- 0100 wrote this inline check unnamed, so its generated name is positional.
-- Exited service keeps the installation acceptance time it already had.
ALTER TABLE app.construction_service_orders DROP CONSTRAINT construction_service_orders_check2;
ALTER TABLE app.construction_service_orders ADD CONSTRAINT construction_service_orders_accepted_check
 CHECK((status IN ('accepted','exited'))=(accepted_at IS NOT NULL));
ALTER TABLE app.construction_service_orders
 ADD COLUMN exited_at timestamptz,
 ADD COLUMN exit_reason text NOT NULL DEFAULT '',
 ADD COLUMN deposit_returned_cents bigint NOT NULL DEFAULT 0 CHECK(deposit_returned_cents BETWEEN 0 AND 100000000000),
 ADD COLUMN deposit_deducted_cents bigint NOT NULL DEFAULT 0 CHECK(deposit_deducted_cents BETWEEN 0 AND 100000000000),
 ADD COLUMN deposit_note text NOT NULL DEFAULT '';
ALTER TABLE app.construction_service_orders ADD CONSTRAINT construction_service_orders_exit_check CHECK(
 (status='exited')=(exited_at IS NOT NULL)
 AND (status='exited')=(char_length(exit_reason)>0)
 AND (status<>'exited' OR accepted_at IS NOT NULL)
 AND (status='exited' OR (deposit_returned_cents=0 AND deposit_deducted_cents=0 AND deposit_note=''))
 AND char_length(exit_reason)<=200 AND char_length(deposit_note)<=200);
-- An exit is terminal history: a project may open a new order afterwards.
DROP INDEX app.construction_service_orders_open;
CREATE UNIQUE INDEX construction_service_orders_open ON app.construction_service_orders(enterprise_id,project_id)
 WHERE status NOT IN ('accepted','cancelled','exited');

-- Repair targets stay inside the same tenant and order.
CREATE UNIQUE INDEX construction_service_order_points_order_id ON app.construction_service_order_points(enterprise_id,order_id,id);

CREATE TABLE app.construction_service_order_repairs (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL,
 project_id bigint NOT NULL,
 order_id bigint NOT NULL,
 point_id bigint,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','cancelled')),
 issue text NOT NULL,
 resolution text NOT NULL DEFAULT '',
 opened_by bigint NOT NULL REFERENCES app.admin_users(id),
 opened_at timestamptz NOT NULL DEFAULT now(),
 closed_by bigint REFERENCES app.admin_users(id),
 closed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 UNIQUE(enterprise_id,id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,order_id) REFERENCES app.construction_service_orders(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,order_id,point_id) REFERENCES app.construction_service_order_points(enterprise_id,order_id,id),
 CHECK(char_length(issue) BETWEEN 1 AND 500 AND char_length(resolution)<=200),
 CHECK((status='open')=(closed_at IS NULL)),
 CHECK((status='open')=(closed_by IS NULL)),
 CHECK(status<>'resolved' OR char_length(resolution)>0)
);
CREATE INDEX construction_service_order_repairs_order ON app.construction_service_order_repairs(enterprise_id,order_id,id);

CREATE TABLE app.construction_service_order_extensions (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL,
 project_id bigint NOT NULL,
 order_id bigint NOT NULL,
 days integer NOT NULL CHECK(days BETWEEN 1 AND 3650),
 note text NOT NULL DEFAULT '',
 created_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,order_id) REFERENCES app.construction_service_orders(enterprise_id,id) ON DELETE CASCADE,
 CHECK(char_length(note)<=200)
);
CREATE INDEX construction_service_order_extensions_order ON app.construction_service_order_extensions(enterprise_id,order_id,id);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_service_order_repairs','construction_service_order_extensions'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
