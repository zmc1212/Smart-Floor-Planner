import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPublicIntroConstraints,
  defaultPublicIntroInput,
  publicIntroFacts,
  publicIntroPrompt,
  validatePublicIntro,
} from '@/lib/construction/public-intro';
import type { PublicContent } from '@/lib/construction/public-contract';
import { parseOpenings, sceneForOpeningPurpose } from '@/lib/assistant/fastgpt/agent-v2/openings';
import { guardAnswerCommitments } from '@/lib/assistant/agent/context';

const openingRegistry = (input: string[]) => ({
  protocol: 'xiaok-openings-v1',
  enterpriseId: '1454',
  scenes: { 'site.public': { appId: 'c'.repeat(24), audience: 'customer', input, constraints: { maxChars: 140 } } },
});

const content = (overrides: Partial<PublicContent> = {}): PublicContent => ({
  name: '城西新家',
  cityCode: '330100',
  cityName: '杭州',
  district: '西湖区',
  stageName: '泥木阶段',
  excerpts: [{ role: '业主', text: '  墙面\n找平   完成  ', date: '2026-11-01' }],
  sourceCount: 3,
  photoCount: 4,
  designerName: '林工',
  ...overrides,
});

const siteOf = (facts: string) => JSON.parse(facts).site as Record<string, unknown>;

test('defaultPublicIntroInput only names fields the openings contract accepts', () => {
  assert.deepEqual([...defaultPublicIntroInput], ['name', 'cityName', 'cityCode', 'district', 'stageName',
    'excerpts', 'photoCount', 'designerName']);
  assert.equal(new Set(defaultPublicIntroInput).size, defaultPublicIntroInput.length);
  assert.doesNotThrow(() => parseOpenings(openingRegistry([...defaultPublicIntroInput])));
  // The registry vocabulary is closed; an extra owner field is not a public fact.
  assert.throws(() => parseOpenings(openingRegistry([...defaultPublicIntroInput, 'ownerPhone'])), /context_changed/);
});

test('publicIntroFacts projects only the requested published fields', () => {
  const facts = JSON.parse(publicIntroFacts(content(), defaultPublicIntroInput));
  assert.equal(facts.sourceRole, 'published_site_snapshot');
  assert.deepEqual(Object.keys(facts.site).sort(), ['cityCode', 'cityName', 'designerName', 'district',
    'excerpts', 'name', 'photoCount', 'stageName']);
  // sourceCount and designerId are not in the opening input contract.
  assert.equal('sourceCount' in facts.site, false);
  assert.equal('designerId' in facts.site, false);
});

test('publicIntroFacts omits an absent designer and normalizes excerpt whitespace', () => {
  const facts = siteOf(publicIntroFacts(content({ designerName: undefined }), defaultPublicIntroInput));
  assert.equal('designerName' in facts, false);
  assert.deepEqual(facts.excerpts, [{ role: '业主', text: '墙面 找平 完成', date: '2026-11-01' }]);
});

test('defaultPublicIntroConstraints keeps a bounded, guarded opening', () => {
  assert.ok(defaultPublicIntroConstraints.minChars < defaultPublicIntroConstraints.maxChars);
  assert.equal(defaultPublicIntroConstraints.noUrl, true);
  assert.equal(defaultPublicIntroConstraints.noCitationMarkers, true);
  assert.equal(defaultPublicIntroConstraints.noPhotoClaims, true);
  assert.equal(defaultPublicIntroConstraints.noCommitments, true);
});

test('publicIntroPrompt derives its length limit and forbids unsupported claims', () => {
  const prompt = publicIntroPrompt(140);
  assert.match(prompt, /全文不超过115字/);
  assert.match(prompt, /不得输出链接、引用标记、表格、标题或编号列表/);
  assert.match(prompt, /不得承诺价格、工期、验收、可预约或已联系团队/);
  assert.match(prompt, /不得说看过照片或描述照片内容/);
  assert.match(publicIntroPrompt(120), /全文不超过95字/);
});

test('validatePublicIntro accepts a normal Chinese opening', () => {
  const opening = '这是城西一套正在做泥木阶段的公开工地，能看到当前阶段和已公开的服务记录。想了解这个阶段的施工，都可以直接问我。';
  assert.equal(validatePublicIntro(opening, defaultPublicIntroConstraints), opening);
});

test('validatePublicIntro rejects length, link, citation, photo, table, heading and line limits', () => {
  for (const invalid of [
    '好'.repeat(defaultPublicIntroConstraints.maxChars + 1),
    '看这里 https://example.com',
    '依据[K1](CITE)说明。',
    '照片里墙面已经完成。',
    '我看到现场已经开始施工了。',
    '| 阶段 | 泥木 |',
    '# 工地介绍',
    '第一行\n第二行\n第三行\n第四行\n第五行',
  ]) assert.throws(() => validatePublicIntro(invalid, defaultPublicIntroConstraints), /invalid_model_answer/, invalid);
});

test('the opening pipeline guards receipt-style commitments before validation', () => {
  // worker.ts and native-executor.ts call guardAnswerCommitments before
  // validatePublicIntro when noCommitments is set.
  const openingGuard = (text: string) => {
    if (defaultPublicIntroConstraints.noCommitments) guardAnswerCommitments(text);
    return validatePublicIntro(text, defaultPublicIntroConstraints);
  };
  assert.throws(() => openingGuard('已经帮您预约成功了，稍后设计师联系您。'), /unsupported_model_commitment/);
  assert.throws(() => openingGuard('我们保证年底完工，放心交给我们。'), /unsupported_model_commitment/);
  // Current behavior: neither guard matches the soft phrases 保证工期/可以预约,
  // and validatePublicIntro has no noCommitments branch of its own.
  const soft = '这个工地当前在做泥木阶段，我们保证工期，也可以预约到现场看看。';
  assert.equal(openingGuard(soft), soft);
});

test('the public site purpose maps back to its opening scene', () => {
  assert.equal(sceneForOpeningPurpose('public.site.intro'), 'site.public');
  assert.equal(sceneForOpeningPurpose('reply'), undefined);
});
