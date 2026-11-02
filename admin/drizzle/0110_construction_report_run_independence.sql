-- Scheduled composition, like the original fact snapshot, is independent of
-- the current ordinary chat and other report periods. Keep the one-active-chat
-- constraint for every interactive purpose.
DROP INDEX app.assistant_run_active;
CREATE UNIQUE INDEX assistant_run_active ON app.assistant_runs(enterprise_id,conversation_id)
 WHERE status IN ('queued','running')
 AND purpose NOT IN ('site.record','construction.report.facts','construction.report.compose');
