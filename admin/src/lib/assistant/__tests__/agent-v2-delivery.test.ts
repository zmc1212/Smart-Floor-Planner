import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAgentV2Delivery } from '../fastgpt/agent-v2/worker';

const snapshot = '「城西新家」：进行中。\n团队标记的当前节点：泥木。';

test('cited model answer accompanies the authorized snapshot instead of being replaced', () => {
  const result = composeAgentV2Delivery('水路改造前应先打压测试[K1](CITE)。', snapshot, 1, true);
  assert.equal(result.modelIncluded, true);
  assert.match(result.text, /打压测试\[K1\]\(CITE\)/);
  assert.match(result.text, /项目记录（授权快照，以此为准）/);
  assert.ok(result.text.indexOf('打压测试') < result.text.indexOf('项目记录（授权快照'));
});

test('uncited or empty model drafts cannot override the snapshot', () => {
  assert.deepEqual(composeAgentV2Delivery('水路改造前应先打压测试。', snapshot, 0, true), { text: snapshot, modelIncluded: false });
  assert.deepEqual(composeAgentV2Delivery('', snapshot, 0, false), { text: snapshot, modelIncluded: false });
});

test('a rejected commitment drops only the model segment and keeps the snapshot', () => {
  assert.deepEqual(composeAgentV2Delivery('现场已经正式验收，水路没有问题[K1](CITE)。', snapshot, 1, true),
    { text: snapshot, modelIncluded: false });
});

test('knowledge evidence without a CITE fails closed when no snapshot exists', () => {
  assert.throws(() => composeAgentV2Delivery('水路改造前应先打压测试。', '', 0, true), /missing_citation/);
});

test('snapshot-free answers keep their existing commitment guard and general answers pass', () => {
  assert.throws(() => composeAgentV2Delivery('已经正式付款。', '', 0, false), /unsupported_model_commitment/);
  assert.equal(composeAgentV2Delivery('可以先把水路图和点位确认好。', '', 0, false).text, '可以先把水路图和点位确认好。');
  assert.equal(composeAgentV2Delivery('水路改造前应先打压测试[K1](CITE)。', '', 1, true).text, '水路改造前应先打压测试[K1](CITE)。');
});
