import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Row } from '@/db/repositories/assistant-repository';
import { pilotScopedReportSettings } from '../report-store';

const settings = (overrides: Partial<Row> = {}): Row => ({
  enterprise_id: '1454',
  project_ids: ['101', '205', '306'],
  stage_keys: ['waterproof'],
  audiences: ['customer', 'boss'],
  ...overrides,
});

// A. 企业报告无项目限制时返回全部试点项目，并保留其他设置。
test('an empty enterprise filter keeps every pilot project', () => {
  const scoped = pilotScopedReportSettings(settings({ project_ids: [] }), ['101', '205']);

  assert.deepEqual(scoped, { ...settings({ project_ids: [] }), project_ids: ['101', '205'] });
});

// B. 部分重叠时只返回交集。
test('a partial enterprise filter returns the intersection', () => {
  const scoped = pilotScopedReportSettings(settings({ project_ids: ['205', '306'] }), ['101', '205']);

  assert.deepEqual(scoped?.project_ids, ['205']);
});

// C. 完全不重叠时返回 null，不扩大到企业全量。
test('no overlap returns null so no report is queued', () => {
  assert.equal(pilotScopedReportSettings(settings({ project_ids: ['306'] }), ['101', '205']), null);
});

// D. 空试点范围返回 null。
test('an empty pilot scope returns null', () => {
  assert.equal(pilotScopedReportSettings(settings(), []), null);
});

// E. 重复 ID 去重并保持试点顺序。
test('duplicate project ids are deduplicated in pilot order', () => {
  const scoped = pilotScopedReportSettings(settings({ project_ids: ['205', '205', '101'] }),
    ['205', '205', '101', '101']);

  assert.deepEqual(scoped?.project_ids, ['205', '101']);
});

// F. 非法项目 ID 拒绝。
test('invalid project ids are rejected', () => {
  assert.throws(() => pilotScopedReportSettings(settings(), ['0']), { code: 'invalid_message', status: 422 });
  assert.throws(() => pilotScopedReportSettings(settings({ project_ids: ['abc'] }), ['101']),
    { code: 'invalid_message', status: 422 });
});

// G. 原企业 settings.project_ids 不被修改。
test('the original settings project ids are not modified', () => {
  const original = settings({ project_ids: ['205', '306'] });
  const reference = original.project_ids;

  pilotScopedReportSettings(original, ['101', '205']);

  assert.deepEqual(original.project_ids, ['205', '306']);
  assert.equal(original.project_ids, reference);
});
