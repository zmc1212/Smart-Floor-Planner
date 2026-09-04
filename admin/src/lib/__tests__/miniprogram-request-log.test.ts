import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { withMiniProgramRequestLog } from '@/lib/miniprogram-request-log';

function captureLogs(t: TestContext) {
  const entries: Array<Record<string, unknown>> = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    t.mock.method(console, level, (prefix: string, json: string) => {
      assert.equal(prefix, '[MiniProgramRequest]');
      entries.push({ level, ...JSON.parse(json) });
    });
  }
  return entries;
}

test('a request logs its arrival before a pending handler finishes and preserves its response', async (t) => {
  const entries = captureLogs(t);
  let finish!: (response: Response) => void;
  const responseBody = { success: true, token: 'private-response-token', user: { phone: '13800138000' } };
  const pending = withMiniProgramRequestLog(
    new Request('https://example.test/api/auth/miniprogram?token=private-query', {
      method: 'POST',
      headers: { Authorization: 'Bearer private-jwt', 'X-Request-Id': 'untrusted-id' },
      body: JSON.stringify({ password: 'private-password' }),
    }),
    '/api/auth/miniprogram',
    (log) => {
      log.stage('wechat_phone');
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'start');
  assert.equal(entries[0].route, '/api/auth/miniprogram');
  finish(Response.json(responseBody, { status: 201, headers: { 'Cache-Control': 'no-store' } }));
  const response = await pending;
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), responseBody);
  assert.equal(entries[1].event, 'complete');
  assert.equal(entries[1].stage, 'wechat_phone');
  assert.equal(entries[1].status, 201);
  assert.equal(entries[1].result, 'ok');
  assert.equal(entries[1].requestId, entries[0].requestId);
  assert.equal(response.headers.get('X-Request-Id'), entries[0].requestId);
  assert.ok(Number(entries[1].durationMs) >= 0);
  assert.doesNotMatch(JSON.stringify(entries), /private-|13800138000|untrusted-id/);
});

test('expected rejections log their business code without logging response error details', async (t) => {
  const entries = captureLogs(t);
  const body = { success: false, code: 'code_disabled', error: 'private-error-detail' };
  const response = await withMiniProgramRequestLog(
    new Request('https://example.test/api/miniprogram/codes/resolve', { method: 'POST' }),
    '/api/miniprogram/codes/resolve',
    async () => Response.json(body, { status: 410 })
  );
  assert.deepEqual(await response.json(), body);
  assert.equal(entries[1].level, 'warn');
  assert.equal(entries[1].result, 'code_disabled');
  assert.equal(entries[1].status, 410);
  assert.doesNotMatch(JSON.stringify(entries), /private-error-detail/);
});

test('handled database errors retain SQLSTATE and locations but exclude SQL, params and personal data', async (t) => {
  const entries = captureLogs(t);
  const cause = Object.assign(new Error('private-phone 13800138000'), {
    code: '42P01',
    detail: 'private-row',
    stack: 'Error: private-phone 13800138000\n    at query (/app/server.js:12:3)',
  });
  const error = Object.assign(new Error('private-sql select * from users; params: private-token'), {
    cause,
    params: ['private-password'],
    stack: 'Error: private-sql\n    at execute (/app/repository.js:45:6)',
  });
  const response = await withMiniProgramRequestLog(
    new Request('https://example.test/api/miniprogram/onboarding/referrer', { method: 'POST' }),
    '/api/miniprogram/onboarding/referrer',
    async (log) => {
      log.stage('database');
      log.error(error);
      return Response.json({ success: false, error: error.message }, { status: 400 });
    }
  );
  assert.equal(response.status, 400);
  assert.deepEqual(entries[1].causes, [
    { name: 'Error', locations: ['/app/repository.js:45:6'] },
    { name: 'Error', code: '42P01', locations: ['/app/server.js:12:3'] },
  ]);
  assert.equal(entries[1].stage, 'database');
  assert.equal(entries[2].status, 400);
  assert.doesNotMatch(JSON.stringify(entries), /private-|13800138000|select \*/);
});

test('unhandled provider exceptions log their numeric code and keep the original thrown error', async (t) => {
  const entries = captureLogs(t);
  const error = Object.assign(new Error('private-provider-message'), { code: 40029 });
  await assert.rejects(withMiniProgramRequestLog(
    new Request('https://example.test/api/auth/miniprogram', { method: 'POST' }),
    '/api/auth/miniprogram',
    async (log) => { log.stage('wechat_code'); throw error; }
  ), (caught) => caught === error);
  assert.equal(entries[1].event, 'exception');
  assert.equal((entries[1].causes as Array<{ code: number }>)[0].code, 40029);
  assert.equal(entries[2].event, 'failed');
  assert.doesNotMatch(JSON.stringify(entries), /private-provider-message/);
});

test('concurrent requests get distinct IDs even when the incoming header is shared', async (t) => {
  const entries = captureLogs(t);
  const responses = await Promise.all(Array.from({ length: 2 }, () => withMiniProgramRequestLog(
    new Request('https://example.test/api/miniprogram/bootstrap', { headers: { 'X-Request-Id': 'shared' } }),
    '/api/miniprogram/bootstrap',
    async () => Response.json({ success: true })
  )));
  const ids = responses.map((response) => response.headers.get('X-Request-Id'));
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) {
    assert.equal(entries.filter((entry) => entry.requestId === id).length, 2);
  }
});

test('the five real route entry points log early rejections without contacting PostgreSQL or WeChat', async (t) => {
  const { POST: resolve } = await import('@/app/api/miniprogram/codes/resolve/route');
  const { POST: referrer } = await import('@/app/api/miniprogram/onboarding/referrer/route');
  const { POST: staff } = await import('@/app/api/miniprogram/onboarding/staff/route');
  const { POST: auth } = await import('@/app/api/auth/miniprogram/route');
  const { GET: bootstrap } = await import('@/app/api/miniprogram/bootstrap/route');
  const entries = captureLogs(t);
  const cases = [
    { route: '/api/miniprogram/codes/resolve', handler: resolve, method: 'POST', status: 400, code: 'invalid_token' },
    { route: '/api/miniprogram/onboarding/referrer', handler: referrer, method: 'POST', status: 401, code: 'unauthorized' },
    { route: '/api/miniprogram/onboarding/staff', handler: staff, method: 'POST', status: 401, code: 'unauthorized' },
    { route: '/api/auth/miniprogram', handler: auth, method: 'POST', status: 400, code: undefined },
    { route: '/api/miniprogram/bootstrap', handler: bootstrap, method: 'GET', status: 401, code: 'unauthorized' },
  ];
  for (const item of cases) {
    const response = await item.handler(new Request(`https://example.test${item.route}`, {
      method: item.method,
      ...(item.method === 'POST' ? { body: '{}' } : {}),
    }));
    assert.equal(response.status, item.status);
    assert.equal((await response.json()).code, item.code);
    assert.equal(entries.at(-2)?.event, 'start');
    assert.equal(entries.at(-1)?.route, item.route);
    assert.equal(entries.at(-1)?.status, item.status);
    assert.equal(response.headers.get('X-Request-Id'), entries.at(-1)?.requestId);
  }
  const invalidJson = await resolve(new Request('https://example.test/api/miniprogram/codes/resolve', {
    method: 'POST', body: '{',
  }));
  assert.equal(invalidJson.status, 400);
  assert.equal(entries.at(-2)?.event, 'exception');
  assert.equal(entries.at(-2)?.stage, 'parse_body');
  assert.equal(entries.at(-1)?.event, 'complete');
});
