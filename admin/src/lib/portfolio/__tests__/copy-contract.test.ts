import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFacts, copyInput, parseCopy } from '../copy-contract';
import { workContent } from '../contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
const facts = copyFacts(workContent({ title: '原木客餐厅', description: '收纳柜让客餐厅更整洁', area: 100,
  authorization: 'private permission 13900000000', source: 'private-door-101', images: [{ assetId: '1', kind: 'render', aiGenerated: true, showroom: false, caption: 'AI生成效果图', space: '客厅' }], coverAssetId: '1' }), 'designer_work');
const good = { title: '原木客餐厅的收纳思路', description: 'AI生成效果图，以收纳柜整理客餐厅。', shareText: '看看这份原木客餐厅收纳参考。', checks: ['实际材料和实施条件需核对'] };
const output = (value: unknown): ModelTurnOutput => ({ text: JSON.stringify(value), toolCalls: [], finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 30 }, providerRequestId: 'test' });
test('public source projection excludes internal evidence, identifiers and private media; native schema is reused', () => {
  const input = copyInput(facts, '介绍收纳思路', 'qwen3.8-flash'), serialized = JSON.stringify(input);
  for (const privateValue of ['13900000000', 'private-door-101', 'assetId', 'authorization', 'imageBase64']) assert.ok(!serialized.includes(privateValue));
  assert.equal(input.tools[0].name, 'final_response'); assert.equal(input.outputMode, 'json_schema');
});
test('a grounded draft parses without authorizing publishing or mutating source facts', async () => {
  const original = JSON.stringify(facts); assert.deepEqual(await parseCopy(output(good), facts), good); assert.equal(JSON.stringify(facts), original);
});
test('array roots, extra keys, blank copy and truncated or tool output are rejected', async () => {
  for (const value of [[good], { ...good, publish: true }, { ...good, title: '' }]) await assert.rejects(parseCopy(output(value), facts), /portfolio_copy_invalid/);
  await assert.rejects(parseCopy({ ...output(good), finishReason: 'length' }, facts), /portfolio_copy_invalid/);
  await assert.rejects(parseCopy({ ...output(good), toolCalls: [{ id: 'x', name: 'publish', arguments: '{}' }] }, facts), /portfolio_copy_invalid/);
});
test('invented digits cannot match a substring of a recorded number', async () => {
  await assert.rejects(parseCopy(output({ ...good, description: '10万元完工' }), facts), /portfolio_copy_invalid/);
  assert.equal((await parseCopy(output({ ...good, description: '100平方米AI生成效果图参考' }), facts)).description, '100平方米AI生成效果图参考');
});
test('publication claims, invented completion and reference ownership are rejected', async () => {
  for (const description of ['企业审核通过', '已获授权', '竣工落地实拍']) await assert.rejects(parseCopy(output({ ...good, description }), facts), /portfolio_copy_invalid/);
  await assert.rejects(parseCopy(output({ ...good, description: '本公司设计的原创作品' }), { ...facts, kind: 'enterprise_reference' }), /portfolio_copy_invalid/);
});
test('explicit external-source attribution is not misclassified as a claim of authorship', async () => {
  const reference = { ...facts, kind: 'enterprise_reference' };
  const copy = { ...good, description: '此内容源自企业授权的外部参考资料，非本企业原创设计或施工项目，仅供风格灵感交流。' };
  assert.equal((await parseCopy(output(copy), reference)).description, copy.description);
  assert.equal((await parseCopy(output({ ...copy, description: '外部授权参考，不是本公司原创设计或施工项目。' }), reference)).title, good.title);
});
test('double negatives and mixed negative/affirmative ownership claims remain blocked', async () => {
  for (const description of ['不是非本企业原创设计', '非本企业原创设计，但是本公司设计的原创作品', '本企业设计的作品']) {
    await assert.rejects(parseCopy(output({ ...good, description }), { ...facts, kind: 'enterprise_reference' }), /portfolio_copy_invalid/);
  }
});
test('ordinary circulation prose differs from consequential delivery, safety and quality promises', async () => {
  assert.equal((await parseCopy(output({ ...good, description: '预留通行空间，同时保证餐桌到厨房的通道顺畅。' }), facts)).title, good.title);
  for (const description of ['保证按期交付', '承诺免费退款', '保证工程质量', '保证施工安全', '承诺环保效果']) await assert.rejects(parseCopy(output({ ...good, description }), facts), /portfolio_copy_invalid/);
});
