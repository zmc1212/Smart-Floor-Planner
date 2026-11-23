-- A missing experience inherits the existing enterprise chat behaviour.
ALTER TABLE app.assistant_stage_agents
  ADD COLUMN experience jsonb CHECK (experience IS NULL OR jsonb_typeof(experience) = 'object'),
  ADD COLUMN edit_history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(edit_history) = 'array');
