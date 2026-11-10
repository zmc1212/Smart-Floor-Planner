import test from 'node:test';
import assert from 'node:assert/strict';
// The agent tool graph initialises in this order in production; importing the
// gateway class first would evaluate read-tool-input before business-tools.
import '../fastgpt/agent-v2/worker';
import { FastGPTAgentV2 } from '../fastgpt/agent-v2/runtime';
import { nearbyPublicSitesText } from '../fastgpt/agent-v2/worker';
import { fail } from '../contracts';

const bridgeKey = 'k'.repeat(32);
const create = () => new FastGPTAgentV2({ protocol: 'fastgpt-agent-v2-v1', enterpriseId: '1454',
  appId: 'a'.repeat(24), model: 'labelled-model', bridgeKey, baseUrl: 'http://127.0.0.1:18300',
  apiKey: 'test-key', record: () => undefined });

const call = (gateway: FastGPTAgentV2, name: string, body: string, options: { key?: string; form?: boolean } = {}) =>
  gateway.handle(new Request('http://127.0.0.1:18300/agent-v2-tool/' + name, { method: 'POST',
    headers: { authorization: 'Bearer ' + (options.key ?? bridgeKey),
      'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json' }, body }));

const packet = { choices: [{ message: { content: '好的' } }],
  responseData: [{ moduleType: 'agent', inputTokens: 3, outputTokens: 4 }] };

test('an unknown tool and a wrong bridge key look identical', async () => {
  const gateway = create();
  assert.equal((await call(gateway, 'recommend_designers', '{}', { key: 'x'.repeat(32) })).status, 404);
  assert.equal((await call(gateway, 'delete_everything', '{}')).status, 404);
});

test('a tool call without an active run is refused', async () => {
  const gateway = create();
  const response = await call(gateway, 'recommend_designers', '{}');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'context_unavailable' });
});

test('recommend_designers takes no model arguments and returns its receipt', async () => {
  const gateway = create(), original = globalThis.fetch;
  let receipt: unknown;
  globalThis.fetch = (async () => {
    const response = await call(gateway, 'recommend_designers', '{}');
    assert.equal(response.status, 200);
    receipt = await response.json();
    // An empty form body is accepted for a zero-argument tool.
    assert.equal((await call(gateway, 'recommend_designers', '', { form: true })).status, 200);
    return Response.json(packet);
  }) as typeof fetch;
  try {
    const result = await gateway.run([{ role: 'user', content: '这个工地是谁设计的？' }], {
      authorize: async () => undefined,
      tool: async input => {
        assert.equal(input.name, 'recommend_designers');
        return { status: 'ready', text: '找到1位设计师的公开作品。' };
      },
    });
    assert.equal(result.text, '好的');
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 });
  } finally { globalThis.fetch = original; }
  assert.deepEqual(receipt, { status: 'ready', text: '找到1位设计师的公开作品。', tool: 'recommend_designers' });
  // The ticket is released with the run, so a late callback cannot read data.
  assert.equal((await call(gateway, 'recommend_designers', '{}')).status, 409);
});

test('a model-supplied argument is refused and poisons that run', async () => {
  const gateway = create(), original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const response = await call(gateway, 'recommend_designers', '{"style":"北欧"}');
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: 'invalid_message' });
    return Response.json(packet);
  }) as typeof fetch;
  try {
    await assert.rejects(gateway.run([{ role: 'user', content: '看看北欧风的设计师' }], {
      authorize: async () => undefined,
      tool: async () => ({ status: 'ready', text: '不应被调用。' }),
    }), /invalid_message/);
  } finally { globalThis.fetch = original; }
});

test('recommend_public_sites is a zero-argument tool and refuses a model-supplied place', async () => {
  const gateway = create(), original = globalThis.fetch;
  let receipt: unknown;
  globalThis.fetch = (async () => {
    const response = await call(gateway, 'recommend_public_sites', '{}');
    assert.equal(response.status, 200);
    receipt = await response.json();
    assert.equal((await call(gateway, 'recommend_public_sites', '{"city":"杭州"}')).status, 422);
    return Response.json(packet);
  }) as typeof fetch;
  try {
    await assert.rejects(gateway.run([{ role: 'user', content: '周围有什么工地？' }], {
      authorize: async () => undefined,
      tool: async input => {
        assert.equal(input.name, 'recommend_public_sites');
        return { status: 'ready', text: '按你所在的位置（宜昌市·西陵区）找到1个已授权公开的工地。' };
      },
    }), /invalid_message/);
  } finally { globalThis.fetch = original; }
  assert.deepEqual(receipt, { status: 'ready', text: '按你所在的位置（宜昌市·西陵区）找到1个已授权公开的工地。', tool: 'recommend_public_sites' });
  assert.equal((await call(gateway, 'recommend_public_sites', '{}')).status, 409);
});

test('nearby public site text names only the authorized region and never claims distance', () => {
  const ready = nearbyPublicSitesText({ cityName: '宜昌市', district: '西陵区' },
    [{ name: '春和苑', stageName: '水电' }, { name: '江畔里' }]);
  assert.match(ready, /宜昌市·西陵区/);
  assert.match(ready, /春和苑（水电）/);
  assert.match(ready, /没有精确距离/);
  assert.doesNotMatch(ready, /最近|米/);
  const empty = nearbyPublicSitesText({ cityName: '宜昌市', district: '' }, []);
  assert.match(empty, /暂时没有已授权公开的工地/);
  assert.match(empty, /不代表这一片没有在施工的工地/);
});

test('a failed tool poisons the run instead of returning partial data', async () => {
  const gateway = create(), original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const response = await call(gateway, 'recommend_designers', '{}');
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'context_changed' });
    return Response.json({ choices: [{ message: { content: '好的' } }] });
  }) as typeof fetch;
  try {
    await assert.rejects(gateway.run([{ role: 'user', content: '看看设计师' }], {
      authorize: async () => undefined,
      tool: async () => { fail('context_changed'); },
    }), /context_changed/);
  } finally { globalThis.fetch = original; }
});
