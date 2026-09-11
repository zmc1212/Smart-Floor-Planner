import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertReportAssets, canManageReport, initialDraft, parseDraft } from './contract';
import { renderReport } from './render';

test('draft validation bounds pages, duplicate identities, image count and required metadata', () => {
  const draft = initialDraft('客户方案', 'proposal');
  assert.equal(parseDraft(draft).pages.length, 5);
  assert.throws(() => parseDraft({ ...draft, title: ' ' }));
  assert.throws(() => parseDraft({ ...draft, pages: [] }));
  assert.throws(() => parseDraft({ ...draft, pages: [draft.pages[0], draft.pages[0]] }));
  assert.throws(() => parseDraft({ ...draft, pages: [{ ...draft.pages[0], assetIds: ['1', '2', '3', '4', '5'] }] }));
  assert.throws(() => parseDraft({ ...draft, pages: [{ ...draft.pages[0], assetIds: ['javascript:alert(1)'] }] }));
  assert.throws(() => parseDraft({ ...draft, pages: [{ ...draft.pages[0], body: 'x'.repeat(3001) }] }));
});
test('the report permission boundary excludes other designers and non-publishing roles', () => {
  assert.equal(canManageReport('designer', '5', BigInt(5)), true);
  assert.equal(canManageReport('designer', '6', BigInt(5)), false);
  assert.equal(canManageReport('enterprise_admin', '6', null), true);
  for (const role of ['admin', 'super_admin']) assert.equal(canManageReport(role, '6', BigInt(5)), true);
  for (const role of ['viewer', 'measurer', 'salesperson']) assert.equal(canManageReport(role, '5', BigInt(5)), false);
});
test('a removed or foreign asset invalidates publication even when another asset is allowed', () => {
  const draft = initialDraft('汇报', 'proposal'); draft.pages[0].assetIds = ['1', '2'];
  assert.throws(() => assertReportAssets(draft, [{ id: '1', title: '现场', kind: 'site', url: '' }]));
});
test('HTML escapes all user text and embeds only selected approved assets', () => {
  const draft = initialDraft('</title><script>alert(1)</script>', 'proposal');
  draft.pages[0].title = '<img src=x onerror=alert(1)>';
  draft.pages[0].body = '</script><script>alert(2)</script>';
  draft.pages[0].assetIds = ['1'];
  const html = renderReport(draft, { '1': 'data:image/png;base64,YQ==', '2': 'https://unused.example/' });
  assert.ok(!html.includes('<script>alert('));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('data:image/png;base64,YQ=='));
  assert.ok(!html.includes('https://unused.example/'));
  assert.ok(html.includes('object-fit:contain'));
});
