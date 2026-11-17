ALTER TABLE app.construction_stage_reminders
  ADD COLUMN chat_prompted_at timestamptz,
  ADD COLUMN read_at timestamptz;

-- The old chat panel already surfaced delivered reminders. Keep them unread
-- for review, but do not present them as new on the first visit after upgrade.
ALTER TABLE app.construction_stage_reminders NO FORCE ROW LEVEL SECURITY;
UPDATE app.construction_stage_reminders
SET chat_prompted_at=coalesce(delivered_at, created_at)
WHERE target_role='owner' AND target_principal_kind='user' AND status='delivered';
ALTER TABLE app.construction_stage_reminders FORCE ROW LEVEL SECURITY;

CREATE INDEX construction_stage_reminders_owner_inbox ON app.construction_stage_reminders
  (target_principal_id, delivered_at DESC NULLS LAST, reminder_id DESC)
  WHERE target_role='owner' AND target_principal_kind='user' AND status='delivered';
