import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityRegistry, ContextRegistry } from '../capabilities/registry';
import { fingerprint, safeText, userContent, type ActorContext } from '../contracts';
import { authorized } from '../infrastructure/worker-auth';
const actor: ActorContext = { enterpriseId: '1', principal: { kind: 'user', userId: '1' }, contextVersion: 1, capabilities: ['project.read'] };
test('E01 read-only capability registration requires explicit permission and input/output parsing', async () => {
  const registry = new CapabilityRegistry().register({
    name: 'project.getStage.v1', version: 1, capability: 'project.read', effect: 'read', confirmation: 'none', timeoutMs: 1000, idempotency: 'read-only',
    parseInput(value) { assert.equal(value, '1'); return value; }, parseOutput(value) { assert.deepEqual(value, { stage: 'survey' }); return value; },
    authorize: async a => a.enterpriseId === '1', execute: async () => ({ stage: 'survey' }),
  });
  assert.deepEqual(await registry.execute('project.getStage.v1', actor, '1'), { stage: 'survey' });
  await assert.rejects(registry.execute('project.getStage.v1', { ...actor, capabilities: [] }, '1'), /assistant_capability_forbidden/);
  await assert.rejects(registry.execute('project.getStage.v1', { ...actor, enterpriseId: '2' }, '1'), /assistant_resource_not_found/);
});
test('E05 unknown media/task blocks use plain fallback; canonical requests ignore property order', () => {
  assert.equal(safeText({ blocks: [{ type: 'media', fallbackText: '图片暂不可用' }, { type: 'task', fallbackText: '任务处理中' }] }), '图片暂不可用\n任务处理中');
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.throws(() => userContent({ version: 1, blocks: [{ type: 'html', text: '<script />' }] }), /invalid_message/);
});
test('E06 independent summary facts adapter uses generic evidence references, no chat business branches', async () => {
  const registry = new ContextRegistry().register('test-summary', {
    authorize: async a => a.enterpriseId === '1', resolve: async (_, ref) => [{ ref, hash: 'v1', text: '今日完成量房 2 次' }],
  });
  const evidence = await registry.resolve(actor, { type: 'test-summary', id: '1', version: '1' });
  assert.equal(evidence[0].ref.type, 'test-summary');
});
test('worker rejects missing secret and ordinary bearer sessions', () => {
  const old = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET; assert.equal(authorized(new Request('http://localhost')), false);
  process.env.CRON_SECRET = 'test-secret';
  assert.equal(authorized(new Request('http://localhost', { headers: { Authorization: 'Bearer test-secret' } })), false);
  assert.equal(authorized(new Request('http://localhost', { headers: { 'x-cron-secret': 'test-secret' } })), true);
  if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old;
});
