-- I7.2 stage reminders need a verifiable in-app receipt. A reminder is only
-- 'delivered' after the existing conversation message was appended.
ALTER TABLE app.construction_stage_reminders ADD COLUMN conversation_id bigint;
ALTER TABLE app.construction_stage_reminders ADD COLUMN message_id bigint;
ALTER TABLE app.construction_stage_reminders ADD CONSTRAINT construction_stage_reminders_conversation_fk
 FOREIGN KEY (enterprise_id, conversation_id) REFERENCES app.assistant_conversations(enterprise_id, id);
ALTER TABLE app.construction_stage_reminders ADD CONSTRAINT construction_stage_reminders_message_fk
 FOREIGN KEY (enterprise_id, message_id) REFERENCES app.assistant_messages(enterprise_id, id);
ALTER TABLE app.construction_stage_reminders ADD CONSTRAINT construction_stage_reminders_receipt_check
 CHECK (status <> 'delivered' OR message_id IS NOT NULL);
