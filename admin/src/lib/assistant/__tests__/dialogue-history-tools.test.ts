import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogueHistoryRecall, historyReceipt, historyRecallInstructions, type HistoryToolRuntime } from '../agent/dialogue-history-tools';

/** Pure unit coverage for the shared history recall assembly: the receipt
 * shape, H-source projection and the exhausted semantics. The DB read itself
 * is the existing authorized recallHistory and keeps its own coverage. */

const source = (messageId: string, seq: string) => ({ messageId, hash: 'h' + messageId, memoryVersion: 3, text: '书房书桌要靠窗', seq });
const snapshot = (sources: ReturnType<typeof source>[]) => ({ query: '书房 书桌', beforeSeq: '30', sources, hasMore: false, oversized: false });
const needView = { memoryVersion: 3, facts: [], historicalFacts: [] as never[], effectiveDeskPositions: [] as never[] };

test('the receipt carries the snapshot, current need view and H sources', () => {
  const receipt = historyReceipt(snapshot([source('11', '5')]), needView);
  assert.equal(receipt.exhausted, false);
  assert.equal(receipt.query, '书房 书桌');
  assert.equal(receipt.beforeSeq, '30');
  assert.deepEqual(receipt.currentNeedView, needView);
  assert.deepEqual(receipt.synthesisSources, [{ sourceId: 'H11', kind: 'history', title: '本咨询客户历史原话',
    text: '书房书桌要靠窗', history: { messageId: '11', hash: 'h11', memoryVersion: 3, seq: '5' } }]);
  assert.ok(receipt.instructions.length > 100);
  assert.ok(!receipt.instructions.includes('本轮原话查询已结束'));
});

test('an empty recall is exhausted and says so once in the instructions', () => {
  const receipt = historyReceipt(snapshot([]), needView);
  assert.equal(receipt.exhausted, true);
  assert.deepEqual(receipt.synthesisSources, []);
  assert.ok(receipt.instructions.includes('本轮原话查询已结束，不再换词重查'));
  assert.ok(historyRecallInstructions(snapshot([source('11', '5')])).includes('sources是本咨询客户当时的完整原话'));
});

test('importing the module and creating the factory touches no database', () => {
  const runtime = { lease: { enterpriseId: '1454', jobId: '1', runId: '5', token: 't',
    actor: { enterpriseId: '1454', principal: { kind: 'user' as const, userId: '7' }, contextVersion: 1, capabilities: [] } },
    protocol: 'test', authorize: async () => { throw new Error('authorize must not run at creation'); },
    historyRefs: new Map() };
  assert.equal(typeof dialogueHistoryRecall(runtime as unknown as HistoryToolRuntime), 'function');
});
