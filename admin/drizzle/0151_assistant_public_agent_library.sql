-- Platform-owned tenant mapping for the public XiaoK consultation.
-- Public visitors are still stored in a concrete tenant because all assistant
-- rows use composite tenant keys and the worker is tenant-partitioned. The
-- mapping is never writable by a tenant request.
CREATE TABLE app.assistant_public_agent_library (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enterprise_id bigint NOT NULL UNIQUE REFERENCES app.enterprises(id)
);

REVOKE ALL ON app.assistant_public_agent_library FROM PUBLIC, sfp_app;
GRANT SELECT ON app.assistant_public_agent_library TO sfp_app;
