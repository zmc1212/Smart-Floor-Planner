import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { GET as preflight } from '@/app/api/internal/assistant/jobs/preflight/route';
import { proxy } from '@/proxy';

test('Worker preflight reaches its CRON_SECRET handler without a dashboard session', async () => {
  const request = new NextRequest('http://127.0.0.1/api/internal/assistant/jobs/preflight', {
    headers: { 'x-cron-secret': 'not-the-actual-cron-secret' },
  });
  const forwarded = await proxy(request);
  assert.equal(forwarded.headers.get('x-middleware-next'), '1');
  assert.equal(forwarded.status, 200);

  const withoutSecret = await preflight(new Request(request.url));
  assert.equal(withoutSecret.status, 401);
  assert.deepEqual(await withoutSecret.json(), { success: false, code: 'unauthorized' });

  const other = await proxy(new NextRequest('http://127.0.0.1/api/internal/assistant/jobs/preflight-extra'));
  assert.equal(other.status, 401);
});
