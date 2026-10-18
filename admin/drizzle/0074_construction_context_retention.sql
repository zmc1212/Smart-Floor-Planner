-- Business coordination survives removal of the optional assistant transcript.
-- Source identifiers in the audit remain provenance, not permission to restore a deleted chat.
ALTER TABLE app.construction_visits ALTER COLUMN conversation_id DROP NOT NULL, ALTER COLUMN source_message_id DROP NOT NULL;
ALTER TABLE app.construction_visits DROP CONSTRAINT construction_visits_enterprise_id_conversation_id_fkey,
 DROP CONSTRAINT construction_visits_enterprise_id_source_message_id_fkey;
ALTER TABLE app.construction_visits
 ADD CONSTRAINT construction_visit_conversation FOREIGN KEY(enterprise_id,conversation_id) REFERENCES app.assistant_conversations(enterprise_id,id) ON DELETE SET NULL (conversation_id),
 ADD CONSTRAINT construction_visit_message FOREIGN KEY(enterprise_id,source_message_id) REFERENCES app.assistant_messages(enterprise_id,id) ON DELETE SET NULL (source_message_id);
