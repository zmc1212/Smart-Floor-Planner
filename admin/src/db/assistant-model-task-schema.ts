import { bigint, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
const app = pgSchema('app');
/** Database migration 0096 owns checks, tenant FKs, forced RLS and immutable bindings. */
export const assistantModelTasks = app.table('assistant_model_tasks', {
  id: bigint('id',{mode:'bigint'}).primaryKey().generatedAlwaysAsIdentity(),
  enterpriseId: bigint('enterprise_id',{mode:'bigint'}).notNull(),
  createdBy: bigint('created_by',{mode:'bigint'}).notNull(),
  operationKey: text('operation_key').notNull(),kind:text('kind').notNull(),state:text('state').notNull().default('prepared'),
  binding:jsonb('binding').notNull(),request:jsonb('request').notNull(),requestHash:text('request_hash').notNull(),
  authorizationId:text('authorization_id'),reservedTokens:bigint('reserved_tokens',{mode:'bigint'}).notNull(),
  reservedCostMicros:bigint('reserved_cost_micros',{mode:'bigint'}).notNull(),inputFileId:text('input_file_id'),
  remoteBatchId:text('remote_batch_id'),remoteStatus:text('remote_status'),lastError:text('last_error'),result:jsonb('result'),
  revokedAt:timestamp('revoked_at',{withTimezone:true,mode:'date'}),version:integer('version').notNull().default(1),
  createdAt:timestamp('created_at',{withTimezone:true,mode:'date'}).notNull().defaultNow(),
  updatedAt:timestamp('updated_at',{withTimezone:true,mode:'date'}).notNull().defaultNow(),
});
export const assistantModelTaskItems = app.table('assistant_model_task_items', {
  id:bigint('id',{mode:'bigint'}).primaryKey().generatedAlwaysAsIdentity(),enterpriseId:bigint('enterprise_id',{mode:'bigint'}).notNull(),
  taskId:bigint('task_id',{mode:'bigint'}).notNull(),customId:text('custom_id').notNull(),request:jsonb('request').notNull(),
  state:text('state').notNull().default('reserved'),attemptId:bigint('attempt_id',{mode:'bigint'}),responseHash:text('response_hash'),result:jsonb('result'),
  reservedTokens:bigint('reserved_tokens',{mode:'bigint'}).notNull(),reservedCostMicros:bigint('reserved_cost_micros',{mode:'bigint'}).notNull(),
});
