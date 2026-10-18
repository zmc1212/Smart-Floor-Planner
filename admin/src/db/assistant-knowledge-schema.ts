import { bigint, boolean, customType, integer, jsonb, pgSchema, text, timestamp, vector } from 'drizzle-orm/pg-core';
// Migrations 0060/0063 own tenant FKs, forced RLS, manager identity guards and immutable versions.
const app=pgSchema('app');
const identity=()=>({id:bigint('id',{mode:'bigint'}).primaryKey().generatedAlwaysAsIdentity(),enterpriseId:bigint('enterprise_id',{mode:'bigint'}).notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()});
const ref=(name:string)=>bigint(name,{mode:'bigint'});
const time=(name:string)=>timestamp(name,{withTimezone:true});
export const assistantKnowledgeIndexProfiles=app.table('assistant_knowledge_index_profiles',{
  ...identity(),profileKey:text('profile_key').notNull(),configuration:jsonb('configuration').notNull(),status:text('status').notNull(),
});
export const assistantKnowledgeDocuments=app.table('assistant_knowledge_documents',{
  ...identity(),title:text('title').notNull(),category:text('category').notNull(),sourceType:text('source_type').notNull(),audience:text('audience').notNull(),
  status:text('status').notNull(),publishedVersionId:ref('published_version_id'),version:integer('version').notNull(),
  createdBy:ref('created_by').notNull(),updatedBy:ref('updated_by').notNull(),updatedAt:time('updated_at').notNull(),
});
const privateBytes=customType<{data:Buffer}>({dataType:()=> 'bytea'});
export const assistantKnowledgeAssets=app.table('assistant_knowledge_assets',{
  ...identity(),documentId:ref('document_id').notNull(),name:text('name').notNull(),format:text('format').notNull(),sourceHash:text('source_hash').notNull(),
  usageRights:text('usage_rights').notNull(),data:privateBytes('data').notNull(),uploadedBy:ref('uploaded_by').notNull(),
});
export const assistantKnowledgeVersions=app.table('assistant_knowledge_versions',{
  ...identity(),documentId:ref('document_id').notNull(),versionNumber:integer('version_number').notNull(),body:text('body').notNull(),faq:jsonb('faq').notNull(),
  referenceCase:jsonb('reference_case'),professional:jsonb('professional'),sourceAssetId:ref('source_asset_id'),sourceFile:jsonb('source_file'),contentHash:text('content_hash').notNull(),editVersion:integer('edit_version').notNull(),indexStatus:text('index_status').notNull(),
  indexProfileId:ref('index_profile_id'),indexedHash:text('indexed_hash'),chunkCount:integer('chunk_count').notNull(),
  effectiveFrom:time('effective_from').notNull(),effectiveTo:time('effective_to'),publishedAt:time('published_at'),publishedBy:ref('published_by'),
  createdBy:ref('created_by').notNull(),updatedAt:time('updated_at').notNull(),
});
export const assistantKnowledgeChunks=app.table('assistant_knowledge_chunks',{
  ...identity(),documentVersionId:ref('document_version_id').notNull(),indexProfileId:ref('index_profile_id').notNull(),ordinal:integer('ordinal').notNull(),
  text:text('text').notNull(),textHash:text('text_hash').notNull(),contentHash:text('content_hash').notNull(),locator:jsonb('locator').notNull(),
  terms:text('terms').array().notNull(),embedding:vector('embedding',{dimensions:1024}).notNull(),
});
export const assistantKnowledgeAttempts=app.table('assistant_knowledge_attempts',{
  id:ref('id').primaryKey().generatedAlwaysAsIdentity(),enterpriseId:ref('enterprise_id').notNull(),jobId:ref('job_id').notNull(),
  leaseToken:text('lease_token').notNull(),operation:text('operation').notNull(),batchOrdinal:integer('batch_ordinal').notNull(),
  profileKey:text('profile_key').notNull(),modelRevision:text('model_revision').notNull(),status:text('status').notNull(),inputTokens:ref('input_tokens'),
  errorCode:text('error_code'),startedAt:time('started_at').notNull(),completedAt:time('completed_at'),
});
export const assistantMessageCitations=app.table('assistant_message_citations',{
  ...identity(),conversationId:ref('conversation_id').notNull(),messageId:ref('message_id').notNull(),runId:ref('run_id').notNull(),
  sourceKind:text('source_kind').notNull(),resourceType:text('resource_type').notNull(),resourceId:text('resource_id').notNull(),resourceVersion:text('resource_version').notNull(),
  documentId:ref('document_id').notNull(),documentVersionId:ref('document_version_id').notNull(),chunkId:ref('chunk_id'),sourceHash:text('source_hash').notNull(),
  quoteSnapshot:text('quote_snapshot').notNull(),locator:jsonb('locator').notNull(),isDraft:boolean('is_draft').notNull(),
});
