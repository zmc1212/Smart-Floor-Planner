-- Map authorization is optional metadata. Preserve recorded dates and all tenant,
-- provider identity and RLS boundaries without requiring a fabricated expiry.
ALTER TABLE app.portfolio_communities
  DROP CONSTRAINT portfolio_community_binding_rights;
