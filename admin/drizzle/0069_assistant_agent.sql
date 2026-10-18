-- Existing tenant RLS and ownership remain the authority. Default is legacy execution.
ALTER TABLE app.assistant_enterprise_settings ADD COLUMN agent_config jsonb NOT NULL DEFAULT '{"runtime":"extractive-v1"}'::jsonb;
ALTER TABLE app.assistant_run_steps ADD COLUMN private_checkpoint jsonb;
-- Checkpoints contain private conversation context and are cleared by the existing retention service.
-- Fact deltas remain conversation-scoped in entry_snapshot.agentMemory; no global/vector fact store.
