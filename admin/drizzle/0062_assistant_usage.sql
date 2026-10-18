ALTER TABLE app.assistant_enterprise_settings ADD COLUMN budget_currency text NOT NULL DEFAULT 'CNY' CHECK(budget_currency='CNY');
ALTER TABLE app.assistant_usage_records ADD COLUMN input_tokens bigint CHECK(input_tokens>=0), ADD COLUMN output_tokens bigint CHECK(output_tokens>=0);
ALTER TABLE app.assistant_quota_reservations ADD COLUMN settled_tokens bigint CHECK(settled_tokens>=0), ADD COLUMN settled_cost_micros bigint CHECK(settled_cost_micros>=0);
CREATE TABLE app.assistant_cost_reviews (
 id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 reservation_id bigint NOT NULL, reviewer_id bigint NOT NULL,
 tokens bigint NOT NULL CHECK(tokens>=0), cost_micros bigint NOT NULL CHECK(cost_micros>=0), currency text NOT NULL CHECK(currency='CNY'),
 evidence_reference text NOT NULL CHECK(length(evidence_reference) BETWEEN 5 AND 500), reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,reservation_id),
 FOREIGN KEY(enterprise_id,reservation_id) REFERENCES app.assistant_quota_reservations(enterprise_id,id),
 FOREIGN KEY(enterprise_id,reviewer_id) REFERENCES app.admin_users(enterprise_id,id)
);
ALTER TABLE app.assistant_cost_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_cost_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_cost_reviews_tenant ON app.assistant_cost_reviews FOR ALL TO sfp_app
 USING ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()))
 WITH CHECK ((SELECT app.has_platform_access()) OR enterprise_id=(SELECT app.current_enterprise_id()));
GRANT SELECT,INSERT,DELETE ON app.assistant_cost_reviews TO sfp_app;
GRANT USAGE,SELECT ON SEQUENCE app.assistant_cost_reviews_id_seq TO sfp_app;
CREATE INDEX assistant_usage_date ON app.assistant_usage_records(enterprise_id,created_at);
CREATE INDEX assistant_quota_review ON app.assistant_quota_reservations(enterprise_id,status,id);
