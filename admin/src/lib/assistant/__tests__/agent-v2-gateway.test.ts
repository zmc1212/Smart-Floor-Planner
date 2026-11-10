import test from 'node:test';
import assert from 'node:assert/strict';
// The agent tool graph initialises in this order in production; importing the
// gateway class first would evaluate read-tool-input before business-tools.
import '../fastgpt/agent-v2/worker';
import { FastGPTAgentV2 } from '../fastgpt/agent-v2/runtime';
import { nearbyPublicSitesReceipt, nearbyPublicSitesText, publicSitesDeliveryText } from '../fastgpt/agent-v2/worker';
import { fail } from '../contracts';

const bridgeKey = 'k'.repeat(32);
const create = () => new FastGPTAgentV2([{ protocol: 'fastgpt-agent-v2-v1', enterpriseId: '1454',
  appId: 'a'.repeat(24), model: 'labelled-model', bridgeKey, baseUrl: 'http://127.0.0.1:18300',
  apiKey: 'test-key', record: () => undefined }]);

let activeTicket: string | null = null;

const call = (gateway: FastGPTAgentV2, name: string, body: string,
  options: { key?: string; form?: boolean; ticket?: string | null } = {}) =>
  gateway.handle(new Request('http://127.0.0.1:18300/agent-v2-tool/' + name, { method: 'POST',
    headers: { authorization: 'Bearer ' + (options.key ?? bridgeKey),
      'x-sfp-run-ticket': ('ticket' in options ? options.ticket : activeTicket) ?? '',
      'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json' }, body }));

const packet = { choices: [{ message: { content: '好的' } }],
  responseData: [{ moduleType: 'agent', inputTokens: 3, outputTokens: 4 }] };

test('an unknown tool and a wrong bridge key look identical', async () => {
  const gateway = create();
  assert.equal((await call(gateway, 'recommend_designers', '{}', { key: 'x'.repeat(32) })).status, 404);
  assert.equal((await call(gateway, 'delete_everything', '{}')).status, 404);
});

test('a tool call without an active run is refused', async () => {
  activeTicket = null;
  const gateway = create();
  const response = await call(gateway, 'recommend_designers', '{}');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'context_unavailable' });
});

test('recommend_designers takes no model arguments and returns its receipt', async () => {
  const gateway = create(), original = globalThis.fetch;
  let receipt: unknown;
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    activeTicket = JSON.parse(String(options?.body)).variables.workflowTicket;
    const response = await call(gateway, 'recommend_designers', '{}');
    assert.equal(response.status, 200);
    receipt = await response.json();
    // An empty form body is accepted for a zero-argument tool.
    assert.equal((await call(gateway, 'recommend_designers', '', { form: true })).status, 200);
    return Response.json(packet);
  }) as typeof fetch;
  try {
    const result = await gateway.run('1454', [{ role: 'user', content: '这个工地是谁设计的？' }], {
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
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    activeTicket = JSON.parse(String(options?.body)).variables.workflowTicket;
    const response = await call(gateway, 'recommend_designers', '{"style":"北欧"}');
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: 'invalid_message' });
    return Response.json(packet);
  }) as typeof fetch;
  try {
    await assert.rejects(gateway.run('1454', [{ role: 'user', content: '看看北欧风的设计师' }], {
      authorize: async () => undefined,
      tool: async () => ({ status: 'ready', text: '不应被调用。' }),
    }), /invalid_message/);
  } finally { globalThis.fetch = original; }
});

test('recommend_public_sites is a zero-argument tool and refuses a model-supplied place', async () => {
  const gateway = create(), original = globalThis.fetch;
  let receipt: unknown;
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    activeTicket = JSON.parse(String(options?.body)).variables.workflowTicket;
    const response = await call(gateway, 'recommend_public_sites', '{}');
    assert.equal(response.status, 200);
    receipt = await response.json();
    assert.equal((await call(gateway, 'recommend_public_sites', '{"city":"杭州"}')).status, 422);
    return Response.json(packet);
  }) as typeof fetch;
  try {
    await assert.rejects(gateway.run('1454', [{ role: 'user', content: '周围有什么工地？' }], {
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

test('two enterprises keep separate bridge keys, tickets and execution slots', async () => {
  const keyA = 'k'.repeat(32), keyB = 'm'.repeat(32), appA = 'a'.repeat(24), appB = 'b'.repeat(24);
  const gateway = new FastGPTAgentV2([
    { protocol: 'fastgpt-agent-v2-v1', enterpriseId: '1454', appId: appA, model: 'labelled-model',
      bridgeKey: keyA, baseUrl: 'http://127.0.0.1:18300', apiKey: 'test-key', record: () => undefined },
    { protocol: 'fastgpt-agent-v2-v1', enterpriseId: '2884', appId: appB, model: 'labelled-model',
      bridgeKey: keyB, baseUrl: 'http://127.0.0.1:18300', apiKey: 'test-key', record: () => undefined },
  ]);
  const original = globalThis.fetch;
  let releaseA!: () => void;
  const gateA = new Promise<void>(resolve => { releaseA = resolve; });
  const seen: string[] = [];
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    const enterprise = body.appId === appA ? '1454' : '2884';
    const key = enterprise === '1454' ? keyA : keyB;
    seen.push(enterprise);
    // Each enterprise holds its own ticket and slot: enterprise A's long call
    // does not make enterprise B busy.
    assert.equal(gateway.busy(enterprise), true);
    const own = await call(gateway, 'recommend_designers', '{}', { key, ticket: body.variables.workflowTicket });
    assert.equal(own.status, 200);
    const foreign = await call(gateway, 'recommend_designers', '{}',
      { key: enterprise === '1454' ? keyB : keyA, ticket: body.variables.workflowTicket });
    assert.equal(foreign.status, 404, 'a ticket from one enterprise cannot use another bridge key');
    if (enterprise === '1454') await gateA;
    else {
      assert.equal(gateway.busy('1454'), true, 'enterprise B runs while A is still active');
      releaseA();
    }
    return Response.json(packet);
  }) as typeof fetch;
  try {
    const a = gateway.run('1454', [{ role: 'user', content: 'A' }], {
      authorize: async () => undefined,
      tool: async () => ({ status: 'ready', text: 'A' }),
    });
    const b = gateway.run('2884', [{ role: 'user', content: 'B' }], {
      authorize: async () => undefined,
      tool: async () => ({ status: 'ready', text: 'B' }),
    });
    await Promise.all([a, b]);
  } finally { globalThis.fetch = original; }
  assert.deepEqual(seen.sort(), ['1454', '2884']);
  assert.equal(gateway.busy('1454'), false);
  assert.equal(gateway.busy('2884'), false);
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

test('a located empty nearby result is delivered verbatim and never asks for a city', () => {
  const receipt = nearbyPublicSitesReceipt({ cityName: '宜昌市', district: '西陵区' }, []);
  assert.equal(receipt.status, 'empty');
  assert.match(receipt.text, /宜昌市·西陵区/);
  assert.match(receipt.text, /暂时没有已授权公开的工地/);
  assert.doesNotMatch(receipt.text, /需要.*(?:城市|区县)|请.*(?:城市|区县)|补充.*(?:城市|区县)/);
  const contradictory = '我这边需要先知道您所在的城市或区县，才能为您查找附近公开的工地。';
  assert.equal(publicSitesDeliveryText(contradictory, receipt), receipt.text,
    'an empty located result must not be preceded by a request for that location');
});

test('a ready nearby result keeps its model answer and distance boundary', () => {
  const receipt = nearbyPublicSitesReceipt({ cityName: '宜昌市', district: '西陵区' },
    [{ name: '春和苑', stageName: '水电' }]);
  assert.equal(receipt.status, 'ready');
  assert.match(receipt.text, /找到 1 个已授权公开的工地/);
  const modelText = '按你所在的宜昌市西陵区，这次找到 1 个已公开的工地。这里只按城市和区县筛选，没有精确距离。';
  assert.equal(publicSitesDeliveryText(modelText, receipt), modelText,
    'only an empty located result is replaced; a ready answer keeps the model wording');
});

test('a failed tool poisons the run instead of returning partial data', async () => {
  const gateway = create(), original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    activeTicket = JSON.parse(String(options?.body)).variables.workflowTicket;
    const response = await call(gateway, 'recommend_designers', '{}');
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'context_changed' });
    return Response.json({ choices: [{ message: { content: '好的' } }] });
  }) as typeof fetch;
  try {
    await assert.rejects(gateway.run('1454', [{ role: 'user', content: '看看设计师' }], {
      authorize: async () => undefined,
      tool: async () => { fail('context_changed'); },
    }), /context_changed/);
  } finally { globalThis.fetch = original; }
});

test('a late callback from a finished run cannot enter the next run', async () => {
  activeTicket = null;
  const gateway = create(), original = globalThis.fetch;
  let firstTicket = '';
  let toolCalls = 0;
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    if (body.messages?.[0]?.content === 'A') {
      firstTicket = body.variables.workflowTicket;
      return Response.json(packet);
    }
    activeTicket = body.variables.workflowTicket;
    // A has finished; B is the only active run. A's stale ticket must not
    // resolve to B's ports.
    assert.equal((await call(gateway, 'recommend_designers', '{}', { ticket: firstTicket })).status, 409);
    assert.equal((await call(gateway, 'recommend_designers', '{}')).status, 200);
    return Response.json(packet);
  }) as typeof fetch;
  try {
    await gateway.run('1454', [{ role: 'user', content: 'A' }], {
      authorize: async () => undefined,
      tool: async () => { toolCalls += 1; return { status: 'ready', text: 'A' }; },
    });
    await gateway.run('1454', [{ role: 'user', content: 'B' }], {
      authorize: async () => undefined,
      tool: async () => { toolCalls += 1; return { status: 'ready', text: 'B' }; },
    });
  } finally { globalThis.fetch = original; activeTicket = null; }
  assert.equal(toolCalls, 1, 'only B may call a tool');
});
