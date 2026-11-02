-- Natural wording is a separate durable run over the immutable fact version.
-- Original facts and their delivery receipt remain available if generation fails.
ALTER TABLE app.construction_report_versions
 DROP CONSTRAINT construction_report_versions_knowledge_status_check,
 ADD COLUMN body_run_id bigint,
 ADD COLUMN body jsonb,
 ADD COLUMN body_generated_at timestamptz,
 ADD COLUMN body_error_code text,
 ADD COLUMN body_attempts integer NOT NULL DEFAULT 0 CHECK(body_attempts BETWEEN 0 AND 3),
 ADD CONSTRAINT construction_report_body_run_fk FOREIGN KEY(enterprise_id,body_run_id)
  REFERENCES app.assistant_runs(enterprise_id,id),
 ADD CONSTRAINT construction_report_body_run_unique UNIQUE(enterprise_id,body_run_id),
 ADD CONSTRAINT construction_report_knowledge_status_check
  CHECK(knowledge_status IN ('not_generated','queued','ready','failed')),
 ADD CONSTRAINT construction_report_body_ready_check
  CHECK((knowledge_status='ready')=(body IS NOT NULL AND body_generated_at IS NOT NULL));
