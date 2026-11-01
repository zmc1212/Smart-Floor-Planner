-- Personal reception and list visibility never change required report creation.
ALTER TABLE app.construction_followup_bindings
 ADD COLUMN remind_stage boolean NOT NULL DEFAULT true,
 ADD COLUMN remind_daily boolean NOT NULL DEFAULT true,
 ADD COLUMN remind_weekly boolean NOT NULL DEFAULT true,
 ADD COLUMN list_hidden boolean NOT NULL DEFAULT false;
UPDATE app.construction_followup_bindings b SET list_hidden=true
 FROM app.assistant_conversations c
 WHERE c.enterprise_id=b.enterprise_id AND c.id=b.conversation_id AND c.status='archived';
ALTER TABLE app.construction_report_deliveries DROP CONSTRAINT construction_report_deliveries_state_check;
ALTER TABLE app.construction_report_deliveries ADD CONSTRAINT construction_report_deliveries_state_check
 CHECK(state IN ('pending','held','delivered','revoked','muted'));

-- Factor the existing relationship rule so a tombstone can be managed without
-- granting access to its closed/redacted conversation or historical contents.
CREATE FUNCTION app.assistant_followup_binding_access(subject_kind text,subject_id bigint,target_enterprise_id bigint,target_binding_id bigint)
 RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE b app.construction_followup_bindings%ROWTYPE; access_role text; staff_role text;
BEGIN
 IF subject_kind NOT IN ('user','admin') OR target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.enterprises WHERE id=target_enterprise_id AND status='active' FOR SHARE) THEN RETURN false; END IF;
 SELECT * INTO b FROM app.construction_followup_bindings
 WHERE enterprise_id=target_enterprise_id AND id=target_binding_id
 AND principal_key=subject_kind||':'||subject_id::text FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF subject_kind='user' THEN
  RETURN EXISTS(SELECT 1 FROM app.construction_projects p JOIN app.leads l ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
   WHERE p.enterprise_id=target_enterprise_id AND p.id=b.project_id AND p.status<>'archived' AND p.customer_access
   AND l.customer_user_id=subject_id AND l.archived_at IS NULL FOR SHARE OF p,l);
 END IF;
 access_role:=app.construction_followup_staff_access(subject_id,target_enterprise_id);
 IF access_role IS NULL THEN RETURN false; END IF;
 IF b.audience='boss' THEN RETURN access_role='owner'; END IF;
 IF access_role='owner' THEN RETURN false; END IF;
 SELECT role INTO staff_role FROM app.admin_users WHERE id=subject_id AND enterprise_id=target_enterprise_id AND status='active' FOR SHARE;
 IF (b.audience='designer' AND staff_role<>'designer') OR (b.audience='worker' AND staff_role<>'construction_staff') THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM app.construction_projects p JOIN app.leads l ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
  JOIN app.construction_members m ON m.enterprise_id=p.enterprise_id AND m.project_id=p.id AND m.admin_id=subject_id AND m.active
  WHERE p.enterprise_id=target_enterprise_id AND p.status<>'archived' AND l.archived_at IS NULL FOR SHARE OF p,l,m);
END $$;
CREATE OR REPLACE FUNCTION app.assistant_followup_conversation_access(subject_kind text,subject_id bigint,target_enterprise_id bigint,target_conversation_id bigint)
 RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE binding_id bigint;
BEGIN
 IF target_enterprise_id IS DISTINCT FROM app.current_enterprise_id() THEN RETURN false; END IF;
 SELECT b.id INTO binding_id FROM app.construction_followup_bindings b
 JOIN app.assistant_conversations c ON c.enterprise_id=b.enterprise_id AND c.id=b.conversation_id
 WHERE b.enterprise_id=target_enterprise_id AND b.conversation_id=target_conversation_id
 AND b.principal_key=subject_kind||':'||subject_id::text AND b.status<>'deleted'
 AND c.purpose='construction_followup' AND c.status<>'closed' FOR SHARE OF b;
 RETURN binding_id IS NOT NULL AND app.assistant_followup_binding_access(subject_kind,subject_id,target_enterprise_id,binding_id);
END $$;
REVOKE ALL ON FUNCTION app.assistant_followup_binding_access(text,bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_followup_binding_access(text,bigint,bigint,bigint) TO sfp_app;
