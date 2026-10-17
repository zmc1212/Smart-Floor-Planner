const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../packages/assistant/lib/client');
const { PublicChatController } = require('../packages/assistant/lib/public-sites');

const material = () => ({
  id: '21', versionId: '31', revision: 2, status: 'pending_owner',
  name: '测试专用 · 公开授权', photos: [], excerpts: [], canDecide: true,
});
const receipt = () => ({ id: '21', versionId: '31', revision: 2, status: 'pending_owner', material: material() });
const body = { versionId: '31', expectedRevision: 1 };
const slot = 'public-owner:11:21';
const path = '/conversations/11/public-sites/21/preview';

test('an unrelated or incomplete owner receipt keeps the original operation for reconciliation', async t => {
  const cases = [
    ['different site', r => { r.id = '22'; }],
    ['different version', r => { r.versionId = '32'; }],
    ['different revision', r => { r.revision = 9; }],
    ['different action result', r => { r.status = 'owner_approved'; }],
    ['missing full preview', r => { delete r.material; }],
    ['different preview version', r => { r.material.versionId = '32'; }],
    ['different preview revision', r => { r.material.revision = 1; }],
    ['invalid preview content', r => { delete r.material.excerpts; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const calls = [], invalid = receipt(); change(invalid);
    let valid = false;
    const client = new AssistantClient(async (url, method, input, options) => {
      calls.push({ url, method, input, key: options.headers['Idempotency-Key'] });
      return { success: true, data: valid ? receipt() : invalid };
    });
    await assert.rejects(client.mutate(slot, path, body), e => e.code === 'invalid_response');
    assert.ok(client.pending.has(slot));
    valid = true;
    assert.deepEqual(await client.mutate(slot, '/conversations/11/public-sites/21/approve', { versionId: '99', expectedRevision: 99 }), receipt());
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(client.pending.size, 0);
  });
});

test('all owner actions require the matching status and retain the key after a mismatched result', async t => {
  for (const [action, status] of [['approve', 'owner_approved'], ['decline', 'declined'], ['withdraw', 'withdrawn']]) await t.test(action, async () => {
    let matched = false;
    const calls = [];
    const client = new AssistantClient(async (url, method, input, options) => {
      calls.push({ url, method, input, key: options.headers['Idempotency-Key'] });
      return { success: true, data: { id: '21', versionId: '31', revision: 2, status: matched ? status : 'published' } };
    });
    await assert.rejects(client.mutate(slot, path.replace('preview', action), body), e => e.code === 'invalid_response');
    matched = true;
    const result = await client.mutate(slot, path, { versionId: '99', expectedRevision: 99 });
    assert.equal(result.status, status);
    assert.deepEqual(calls[0], calls[1]);
  });
});

test('an invalid preview never expands a card or enables agreement; the original preview can recover', async () => {
  let valid = false;
  const client = new AssistantClient(async (_path, method) => {
    if (method === 'GET') return { success: true, data: { items: [] } };
    return { success: true, data: valid ? receipt() : { ...receipt(), material: undefined } };
  });
  const controller = new PublicChatController({ emit() {}, identity: () => 'test-owner', client, media: { clear() {}, async load() {} } });
  await controller.load('11', '1', [{ publicConsent: { ...material(), revision: 1 } }]);
  assert.equal(await controller.decide('21_31', 'preview'), false);
  assert.equal(controller.state.publicExpanded, '');
  assert.ok(controller.state.publicPending);
  assert.equal(await controller.decide('21_31', 'approve'), false);
  valid = true;
  assert.equal(await controller.retry(), true);
  assert.equal(controller.state.publicExpanded, '21_31');
  assert.equal(controller.state.publicCards['21_31'].revision, 2);
});

test('a revoked source during original-operation reconciliation clears protected cards and media', async () => {
  let revoked = false, clears = 0;
  const client = new AssistantClient(async (_path, method) => {
    if (method === 'GET') return { success: true, data: { items: [] } };
    throw revoked ? { statusCode: 409, code: 'public_source_unavailable' } : { statusCode: 503 };
  });
  const controller = new PublicChatController({ emit() {}, identity: () => 'test-owner', client, media: { clear() { clears++; }, async load() {} } });
  await controller.load('11', '1', [{ publicConsent: { ...material(), revision: 1 } }]);
  assert.equal(await controller.decide('21_31', 'preview'), false);
  assert.ok(controller.state.publicPending);
  const before = clears;
  revoked = true;
  assert.equal(await controller.retry(), false);
  assert.deepEqual(controller.state.publicCards, {});
  assert.equal(controller.state.publicExpanded, '');
  assert.equal(controller.state.publicPending, null);
  assert.equal(client.pending.size, 0);
  assert.equal(clears, before + 1);
  assert.match(controller.state.publicError, /原始材料已有变化/);
});
