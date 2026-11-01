import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sourceScope } from '@/lib/assistant/knowledge/sources';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { ReportContextService } from '../report-context';
import type { ActorContext } from '@/lib/assistant/contracts';

const staff: ActorContext = { enterpriseId: '1454', principal: { kind: 'admin', adminId: '5413' }, contextVersion: 1,
  capabilities: ['assistant.followup.self'], entry: { miniProgramUserId: '3917', miniProgramContextVersion: 1 } };

test('private recipient capability never becomes ordinary consultation or knowledge preview authority', () => {
  const service = new ConversationService(staff);
  assert.throws(() => service.create('synthetic-staff-create'), /assistant_capability_forbidden/);
  assert.throws(() => service.list(), /assistant_capability_forbidden/);
  assert.doesNotThrow(() => new ReportContextService(staff, '901'));
  assert.throws(() => new ReportContextService({ ...staff, capabilities: ['assistant.preview.self'] }, '901'));
  assert.throws(() => new ReportContextService(staff, '901').topic('synthetic-staff-topic'), /assistant_capability_forbidden/);
});
test('private staff knowledge scope is published internal/public, with no draft preview fallback', () => {
  const dialect = new PgDialect();
  const c = { purpose: 'construction_followup', entry_snapshot: {} };
  const scope = dialect.sqlToQuery(sourceScope(staff, c));
  assert.match(scope.sql, /d\.status='active'/); assert.match(scope.sql, /staff_internal/);
  assert.match(scope.sql, /v\.published_at is not null/); assert.match(scope.sql, /d\.published_version_id=v\.id/);
  assert.throws(() => sourceScope({ ...staff, capabilities: ['assistant.preview.self'] }, c), /context_changed/);
  assert.throws(() => sourceScope(staff, { purpose: 'customer_consultation', entry_snapshot: {} }), /context_changed/);
  const customer = { ...staff, principal: { kind: 'user' as const, userId: '3914' } };
  assert.doesNotMatch(dialect.sqlToQuery(sourceScope(customer, c)).sql, /staff_internal/);
});
