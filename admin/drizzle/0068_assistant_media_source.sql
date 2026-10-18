-- Immutable consultation snapshot provenance, not another editable floor plan.
ALTER TABLE app.assistant_media ADD COLUMN source_ref jsonb;
