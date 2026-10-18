import { bigint, boolean, customType, date, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
export * from './assistant-knowledge-schema';

// SQL migrations 0058–0069 own tenant FKs, manager/handoff identity guards, RLS and partial unique indexes.
// These projections provide typed columns for repository consumers; do not use push.
const app = pgSchema('app');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
export const assistantMedia = app.table('assistant_media', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).notNull(),
  conversationId: bigint('conversation_id', { mode: 'bigint' }).notNull(),
  customerUserId: bigint('customer_user_id', { mode: 'bigint' }).notNull(),
  requestKey: text('request_key').notNull(), sourceHash: text('source_hash').notNull(),
  kind: text('kind').notNull(), roomName: text('room_name').notNull(), mimeType: text('mime_type').notNull(),
  width: integer('width').notNull(), height: integer('height').notNull(), byteSize: integer('byte_size').notNull(),
  data: bytea('data'), sourceRef: jsonb('source_ref'), deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
const base = () => ({
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const assistantEnterpriseSettings = app.table('assistant_enterprise_settings', {
  ...base(),
  enabled: boolean('enabled').notNull(),
  knowledgeEpoch: integer('knowledge_epoch').notNull(),
  activeIndexProfileId: bigint('active_index_profile_id', { mode: 'bigint' }),
  policyVersion: integer('policy_version').notNull(),
  dailyRequests: integer('daily_requests').notNull(),
  dailyTokens: bigint('daily_tokens', { mode: 'bigint' }).notNull(),
  dailyCostMicros: bigint('daily_cost_micros', { mode: 'bigint' }).notNull(),
  budgetCurrency: text('budget_currency').notNull(),
  maxMessageChars: integer('max_message_chars').notNull(),
  retentionDays: integer('retention_days').notNull(),
  guidanceConfig: jsonb('guidance_config'),
  agentConfig: jsonb('agent_config'),
});

export const assistantConversations = app.table('assistant_conversations', {
  ...base(),
  purpose: text('purpose').notNull(),
  status: text('status').notNull(),
  mode: text('mode').notNull(),
  title: text('title').notNull(),
  entrySnapshot: jsonb('entry_snapshot').notNull(),
  policyVersion: integer('policy_version').notNull(),
  contextRevision: integer('context_revision').notNull(),
  lastSeq: bigint('last_seq', { mode: 'bigint' }).notNull(),
});

export const assistantRequirementSummaries = app.table('assistant_requirement_summaries', {
  ...base(),
  conversationId: bigint('conversation_id', { mode: 'bigint' }).notNull(),
  customerUserId: bigint('customer_user_id', { mode: 'bigint' }).notNull(),
  sourceSeq: bigint('source_seq', { mode: 'bigint' }).notNull(),
  status: text('status').notNull().default('draft'),
  draftFields: jsonb('draft_fields').notNull(),
  confirmedFields: jsonb('confirmed_fields'),
  leadId: bigint('lead_id', { mode: 'bigint' }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
});

export const assistantParticipants = app.table('assistant_participants', {
  ...base(),
  conversationId: bigint('conversation_id', { mode: 'bigint' }).notNull(),
  principalKind: text('principal_kind').notNull(),
  userId: bigint('user_id', { mode: 'bigint' }),
  adminId: bigint('admin_id', { mode: 'bigint' }),
  participantRole: text('participant_role').notNull(),
  grantBasis: jsonb('grant_basis').notNull(),
  status: text('status').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
});

export const assistantContextBindings = app.table('assistant_context_bindings', {
  ...base(),
  conversationId: bigint('conversation_id', { mode: 'bigint' }).notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  relation: text('relation').notNull(),
  sourceVersion: text('source_version').notNull(),
  status: text('status').notNull(),
});

export const assistantMessages = app.table('assistant_messages', {
  ...base(),
  conversationId: bigint('conversation_id', { mode: 'bigint' }).notNull(),
  seq: bigint('seq', { mode: 'bigint' }).notNull(),
  authorKind: text('author_kind').notNull(),
  userId: bigint('user_id', { mode: 'bigint' }),
  adminId: bigint('admin_id', { mode: 'bigint' }),
  content: jsonb('content').notNull(),
  answerKind: text('answer_kind'),
  runId: bigint('run_id', { mode: 'bigint' }),
  sourceEventId: bigint('source_event_id', { mode: 'bigint' }),
  clientMessageId: text('client_message_id'),
  purpose: text('purpose').notNull(),
  replyToMessageId: bigint('reply_to_message_id', { mode: 'bigint' }),
});

export const assistantRuns = app.table('assistant_runs', {
  ...base(),
  conversationId: bigint('conversation_id', { mode: 'bigint' }).notNull(),
  triggerKind: text('trigger_kind').notNull(),
  triggerMessageId: bigint('trigger_message_id', { mode: 'bigint' }),
  triggerEventId: bigint('trigger_event_id', { mode: 'bigint' }),
  triggerScheduleKey: text('trigger_schedule_key'),
  retryOfRunId: bigint('retry_of_run_id', { mode: 'bigint' }),
  purpose: text('purpose').notNull(),
  status: text('status').notNull(),
  answerKind: text('answer_kind'),
  policySnapshot: jsonb('policy_snapshot').notNull(),
  contextRevision: integer('context_revision').notNull(),
  knowledgeEpoch: integer('knowledge_epoch').notNull(),
  outputMessageId: bigint('output_message_id', { mode: 'bigint' }),
  errorCode: text('error_code'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
});

export const assistantJobs = app.table('assistant_jobs', {
  ...base(),
  kind: text('kind').notNull(),
  runId: bigint('run_id', { mode: 'bigint' }),
  knowledgeVersionId: bigint('knowledge_version_id', { mode: 'bigint' }),
  knowledgeEditVersion: integer('knowledge_edit_version'),
  indexProfileId: bigint('index_profile_id', { mode: 'bigint' }),
  contentHash: text('content_hash'),
  requestedBy: bigint('requested_by', { mode: 'bigint' }),
  dedupeKey: text('dedupe_key').notNull(),
  payloadVersion: integer('payload_version').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull(),
  leaseToken: text('lease_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true, mode: 'date' }),
  providerStartedAt: timestamp('provider_started_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
});

export const assistantRunSteps = app.table('assistant_run_steps', {
  ...base(),
  runId: bigint('run_id', { mode: 'bigint' }).notNull(),
  stepSeq: integer('step_seq').notNull(),
  kind: text('kind').notNull(),
  capabilityName: text('capability_name'),
  capabilityVersion: integer('capability_version'),
  providerAttemptId: bigint('provider_attempt_id', { mode: 'bigint' }),
  inputSummary: jsonb('input_summary').notNull(),
  privateCheckpoint: jsonb('private_checkpoint'),
  sourceRefs: jsonb('source_refs').notNull(),
  durationMs: integer('duration_ms'),
  status: text('status').notNull(),
});

export const domainEventOutbox = app.table('domain_event_outbox', {
  ...base(),
  type: text('type').notNull(),
  eventVersion: integer('event_version').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(),
  actorRef: jsonb('actor_ref').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  correlationId: text('correlation_id').notNull(),
  causationId: text('causation_id'),
  payload: jsonb('payload').notNull(),
});

export const domainEventDeliveries = app.table('domain_event_deliveries', {
  ...base(),
  eventId: bigint('event_id', { mode: 'bigint' }).notNull(),
  consumerKey: text('consumer_key').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull(),
  leaseToken: text('lease_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
});

export const assistantUsageRecords = app.table('assistant_usage_records', {
  ...base(),
  runId: bigint('run_id', { mode: 'bigint' }).notNull(),
  providerAttemptId: bigint('provider_attempt_id', { mode: 'bigint' }),
  operationKey: text('operation_key').notNull(),
  category: text('category').notNull(),
  quantity: bigint('quantity', { mode: 'bigint' }),
  costMicros: bigint('cost_micros', { mode: 'bigint' }),
  currency: text('currency'),
  measurementKind: text('measurement_kind').notNull(),
  inputTokens: bigint('input_tokens', { mode: 'bigint' }),
  outputTokens: bigint('output_tokens', { mode: 'bigint' }),
});

export const assistantIdempotencyRecords = app.table('assistant_idempotency_records', {
  ...base(),
  principalKey: text('principal_key').notNull(),
  operation: text('operation').notNull(),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  result: jsonb('result').notNull(),
  status: text('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const assistantQuotaReservations = app.table('assistant_quota_reservations', {
  ...base(),
  runId: bigint('run_id', { mode: 'bigint' }).notNull(),
  operationKey: text('operation_key').notNull(),
  budgetDate: date('budget_date', { mode: 'string' }).notNull(),
  reservedRequests: integer('reserved_requests').notNull(),
  reservedTokens: bigint('reserved_tokens', { mode: 'bigint' }).notNull(),
  reservedCostMicros: bigint('reserved_cost_micros', { mode: 'bigint' }).notNull(),
  settledTokens: bigint('settled_tokens', { mode: 'bigint' }),
  settledCostMicros: bigint('settled_cost_micros', { mode: 'bigint' }),
  status: text('status').notNull(),
});

export const assistantCostReviews = app.table('assistant_cost_reviews', {
  id: bigint('id', { mode: 'bigint' }).primaryKey(),
  enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).notNull(),
  reservationId: bigint('reservation_id', { mode: 'bigint' }).notNull(),
  reviewerId: bigint('reviewer_id', { mode: 'bigint' }).notNull(),
  tokens: bigint('tokens', { mode: 'bigint' }).notNull(),
  costMicros: bigint('cost_micros', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  evidenceReference: text('evidence_reference').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
