-- I7.1 lightweight stage reminders are separate from immutable business events.
-- They store only server-computed reminders, their dedupe key and delivery state.
CREATE TABLE app.construction_stage_reminders (
 reminder_id text PRIMARY KEY CHECK (reminder_id ~ '^rem_[a-f0-9]{24}$'),
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 project_id bigint NOT NULL,
 stage_id text,
 construction_stage_key text,
 target_role text NOT NULL CHECK (target_role IN ('owner','designer','boss','worker','manager')),
 target_principal_kind text NOT NULL CHECK (target_principal_kind IN ('user','admin')),
 target_principal_id bigint NOT NULL CHECK (target_principal_id > 0),
 related_task_id text,
 related_issue_id text,
 trigger_type text NOT NULL CHECK (trigger_type IN ('stage_entered','plan_node_due_soon','plan_node_overdue',
  'assignee_todo','owner_confirmation','designer_review','worker_missing_material','data_stale','issue_overdue','stage_ending')),
 trigger_evidence jsonb NOT NULL CHECK (jsonb_typeof(trigger_evidence)='object'),
 scheduled_at timestamptz NOT NULL,
 delivered_at timestamptz,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','paused','cancelled','acknowledged','expired')),
 dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 500),
 action_url text NOT NULL CHECK (length(action_url) BETWEEN 1 AND 500),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
 delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 10),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (enterprise_id, dedupe_key),
 FOREIGN KEY (enterprise_id, project_id) REFERENCES app.construction_projects(enterprise_id, id) ON DELETE CASCADE
);
CREATE INDEX construction_stage_reminders_inbox ON app.construction_stage_reminders
 (enterprise_id, target_principal_kind, target_principal_id, status, scheduled_at DESC);
CREATE INDEX construction_stage_reminders_project ON app.construction_stage_reminders(enterprise_id, project_id, status);

ALTER TABLE app.construction_stage_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_stage_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.construction_stage_reminders
 USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_stage_reminders TO sfp_app;

-- A pause is a recipient preference, not a business fact. 'all' pauses every
-- trigger type for that project; a specific trigger type pauses only that one.
CREATE TABLE app.construction_stage_reminder_pauses (
 enterprise_id bigint NOT NULL REFERENCES app.enterprises(id),
 project_id bigint NOT NULL,
 principal_kind text NOT NULL CHECK (principal_kind IN ('user','admin')),
 principal_id bigint NOT NULL CHECK (principal_id > 0),
 trigger_type text NOT NULL DEFAULT 'all' CHECK (trigger_type IN ('all','stage_entered','plan_node_due_soon',
  'plan_node_overdue','assignee_todo','owner_confirmation','designer_review','worker_missing_material','data_stale',
  'issue_overdue','stage_ending')),
 paused_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (enterprise_id, project_id, principal_kind, principal_id, trigger_type),
 FOREIGN KEY (enterprise_id, project_id) REFERENCES app.construction_projects(enterprise_id, id) ON DELETE CASCADE
);
ALTER TABLE app.construction_stage_reminder_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.construction_stage_reminder_pauses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.construction_stage_reminder_pauses
 USING (app.has_platform_access() OR enterprise_id=app.current_enterprise_id())
 WITH CHECK (app.has_platform_access() OR enterprise_id=app.current_enterprise_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON app.construction_stage_reminder_pauses TO sfp_app;
