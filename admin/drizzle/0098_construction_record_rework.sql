-- A resubmission is a new immutable original linked to the same record chain.
-- Existing per-record media/version/customer grants never include rejected photos.
ALTER TABLE app.construction_site_records
 DROP CONSTRAINT construction_site_records_status_check,
 ADD CONSTRAINT construction_site_records_status_check CHECK(status IN ('organizing','draft','published','withdrawn','changes_requested')),
 ADD COLUMN review_requirements text NOT NULL DEFAULT '',
 ADD COLUMN returned_by bigint REFERENCES app.admin_users(id),
 ADD COLUMN returned_at timestamptz,
 ADD COLUMN resubmission_of_id bigint,
 ADD COLUMN original_record_id bigint,
 ADD CONSTRAINT construction_rework_parent FOREIGN KEY(enterprise_id,project_id,resubmission_of_id)
  REFERENCES app.construction_site_records(enterprise_id,project_id,id),
 ADD CONSTRAINT construction_rework_original FOREIGN KEY(enterprise_id,project_id,original_record_id)
  REFERENCES app.construction_site_records(enterprise_id,project_id,id),
 ADD CONSTRAINT construction_rework_link CHECK((resubmission_of_id IS NULL)=(original_record_id IS NULL)
  AND resubmission_of_id IS DISTINCT FROM id AND original_record_id IS DISTINCT FROM id),
 ADD CONSTRAINT construction_rework_requirements CHECK(status<>'changes_requested'
  OR (length(btrim(review_requirements)) BETWEEN 1 AND 1000 AND returned_by IS NOT NULL AND returned_at IS NOT NULL));
CREATE UNIQUE INDEX construction_rework_one_submission ON app.construction_site_records(enterprise_id,project_id,resubmission_of_id)
 WHERE resubmission_of_id IS NOT NULL;
CREATE INDEX construction_rework_chain ON app.construction_site_records(enterprise_id,project_id,original_record_id);
ALTER TABLE app.construction_site_record_versions DROP CONSTRAINT construction_site_record_versions_action_check;
ALTER TABLE app.construction_site_record_versions ADD CONSTRAINT construction_site_record_versions_action_check
 CHECK(action IN ('organized','edit','publish','withdraw','request_changes','resubmit','submitted'));
