-- Managed cloud-site service orders are recorded only. Fees and deposits are
-- settled offline; no payment, collection or refund is initiated or verified here.
CREATE TABLE app.construction_service_orders (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 project_id bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending_quote'
  CHECK(status IN ('pending_quote','quoted','confirmed','scheduled','accepted','cancelled')),
 camera_count integer NOT NULL CHECK(camera_count BETWEEN 1 AND 8),
 retention_days integer NOT NULL CHECK(retention_days BETWEEN 1 AND 30),
 service_days integer NOT NULL CHECK(service_days BETWEEN 1 AND 3650),
 request_note text NOT NULL DEFAULT '',
 quote_version integer NOT NULL DEFAULT 0 CHECK(quote_version >= 0),
 confirmed_quote_version integer,
 scheduled_for timestamptz,
 installer_id bigint REFERENCES app.admin_users(id),
 accepted_at timestamptz,
 cancelled_at timestamptz,
 cancel_reason text NOT NULL DEFAULT '',
 created_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
 UNIQUE(enterprise_id,id),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 CHECK(char_length(request_note)<=200 AND char_length(cancel_reason)<=200),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL)),
 CHECK((status='accepted')=(accepted_at IS NOT NULL)),
 CHECK(status NOT IN ('confirmed','scheduled') OR confirmed_quote_version IS NOT NULL),
 CHECK(status<>'scheduled' OR (scheduled_for IS NOT NULL AND installer_id IS NOT NULL))
);
-- One open order per project; accepted and cancelled orders stay as history.
CREATE UNIQUE INDEX construction_service_orders_open ON app.construction_service_orders(enterprise_id,project_id)
 WHERE status NOT IN ('accepted','cancelled');
CREATE INDEX construction_service_orders_project ON app.construction_service_orders(enterprise_id,project_id,id);

CREATE TABLE app.construction_service_order_quotes (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL,
 project_id bigint NOT NULL,
 order_id bigint NOT NULL,
 version integer NOT NULL CHECK(version >= 1),
 lines jsonb NOT NULL,
 total_cents bigint NOT NULL CHECK(total_cents BETWEEN 0 AND 100000000000),
 deposit_cents bigint NOT NULL CHECK(deposit_cents BETWEEN 0 AND 100000000000),
 note text NOT NULL DEFAULT '',
 created_by bigint NOT NULL REFERENCES app.admin_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id),
 UNIQUE(enterprise_id,order_id,version),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,order_id) REFERENCES app.construction_service_orders(enterprise_id,id) ON DELETE CASCADE,
 CHECK(char_length(note)<=500),
 CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 10)
);

CREATE TABLE app.construction_service_order_points (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 enterprise_id bigint NOT NULL,
 project_id bigint NOT NULL,
 order_id bigint NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 8),
 name text NOT NULL,
 room_id bigint,
 position_note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','installed','accepted')),
 installed_at timestamptz,
 installed_by bigint REFERENCES app.admin_users(id),
 accepted_at timestamptz,
 accepted_by bigint REFERENCES app.admin_users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,id),
 UNIQUE(enterprise_id,order_id,seq),
 FOREIGN KEY(enterprise_id,project_id) REFERENCES app.construction_projects(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,order_id) REFERENCES app.construction_service_orders(enterprise_id,id) ON DELETE CASCADE,
 FOREIGN KEY(enterprise_id,project_id,room_id) REFERENCES app.construction_rooms(enterprise_id,project_id,id),
 CHECK(char_length(name) BETWEEN 1 AND 40 AND char_length(position_note)<=200),
 CHECK((status='pending')=(installed_at IS NULL)),
 CHECK((status='accepted')=(accepted_at IS NOT NULL)),
 CHECK(status<>'accepted' OR installed_at IS NOT NULL)
);
CREATE INDEX construction_service_order_points_order ON app.construction_service_order_points(enterprise_id,order_id,seq);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['construction_service_orders','construction_service_order_quotes','construction_service_order_points'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id()) WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO sfp_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_app;
