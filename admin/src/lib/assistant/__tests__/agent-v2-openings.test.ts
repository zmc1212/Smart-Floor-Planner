import test from 'node:test';
import assert from 'node:assert/strict';
// Same load order as production; see agent-v2-gateway.test.ts.
import '../fastgpt/agent-v2/worker';
import { FastGPTAgentV2 } from '../fastgpt/agent-v2/runtime';
import { parseOpenings, purposeForOpening, sceneForOpeningPurpose } from '../fastgpt/agent-v2/openings';
import { validatePublicIntro } from '@/lib/construction/public-intro';

const constraints = { minChars: 8, maxChars: 140, noUrl: true, noCitationMarkers: true, noPhotoClaims: true, noCommitments: true };
const registry = () => ({ protocol: 'xiaok-openings-v1', enterpriseId: '1454', scenes: {
  'site.public': { appId: 'c'.repeat(24), audience: 'customer',
    input: ['name', 'cityName', 'district', 'stageName', 'excerpts', 'photoCount', 'designerName'],
    constraints: { maxChars: 140 } } } });

test('a registered scene defaults to the strict opening constraints', () => {
  const parsed = parseOpenings(registry());
  const scene = parsed.scenes['site.public'];
  assert.equal(scene.appId, 'c'.repeat(24));
  assert.deepEqual(scene.constraints, constraints);
});

test('staff audiences and model-invented fields are rejected', () => {
  const staff = registry(); staff.scenes['site.public'].audience = 'staff';
  assert.throws(() => parseOpenings(staff), /context_changed/);
  const field = registry(); field.scenes['site.public'].input = ['name', 'ownerPhone'];
  assert.throws(() => parseOpenings(field), /context_changed/);
  const duplicate = registry(); duplicate.scenes['site.public'].input = ['name', 'name'];
  assert.throws(() => parseOpenings(duplicate), /context_changed/);
  const app = registry(); app.scenes['site.public'].appId = 'not-an-app-id';
  assert.throws(() => parseOpenings(app), /context_changed/);
});

test('site keeps its historical purpose and later scenes derive theirs', () => {
  assert.equal(purposeForOpening('site.public'), 'public.site.intro');
  assert.equal(sceneForOpeningPurpose('public.site.intro'), 'site.public');
  assert.equal(purposeForOpening('designer.public'), 'intro.designer.public');
  assert.equal(sceneForOpeningPurpose('intro.designer.public'), 'designer.public');
  assert.equal(sceneForOpeningPurpose('reply'), undefined);
});

test('opening text must stay inside every registered limit', () => {
  const opening = '这是城西一套正在做泥木阶段的公开工地，能看到当前阶段和已公开的服务记录。想了解这个阶段的施工，或想认识设计师，都可以直接问我。';
  assert.equal(validatePublicIntro(opening, constraints), opening);
  for (const invalid of ['你好。', '好'.repeat(141), '看这里 https://example.com',
    '依据[K1](CITE)说明。', '我看到照片里墙面已经完成。', '电话13800138000',
    '| 阶段 | 泥木 |', '# 工地介绍'])
    assert.throws(() => validatePublicIntro(invalid, constraints), /invalid_model_answer/, invalid);
});

test('an opening call has no ticket, no history and no workflow variables', async () => {
  const bridgeKey = 'k'.repeat(32), appId = 'c'.repeat(24);
  const gateway = new FastGPTAgentV2({ protocol: 'fastgpt-agent-v2-v1', enterpriseId: '1454',
    appId, model: 'labelled-model', bridgeKey, baseUrl: 'http://127.0.0.1:18300', apiKey: 'test-key',
    record: () => undefined });
  const original = globalThis.fetch;
  let reached: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    reached = JSON.parse(String(init?.body));
    // The opening app is tool-free: a callback cannot read anything.
    const tool = await gateway.handle(new Request('http://127.0.0.1:18300/agent-v2-tool/recommend_designers',
      { method: 'POST', headers: { authorization: 'Bearer ' + bridgeKey, 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(tool.status, 409);
    return Response.json({ choices: [{ message: { content: '这是公开工地的开场白。' } }],
      responseData: [{ moduleType: 'agent', inputTokens: 5, outputTokens: 6 }] });
  }) as typeof fetch;
  try {
    const result = await gateway.intro(appId, '{"sourceRole":"published_site_snapshot","site":{"name":"城西新家"}}', '写开场白');
    assert.equal(result.text, '这是公开工地的开场白。');
    assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 6 });
  } finally { globalThis.fetch = original; }
  assert.equal(reached?.appId, appId);
  assert.equal(reached?.chatId, 'NO_RECORD_HISTORIES');
  assert.equal(reached?.variables, undefined);
});
