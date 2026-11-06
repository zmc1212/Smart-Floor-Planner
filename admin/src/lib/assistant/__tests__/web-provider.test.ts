import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { configuredWebProvider, ddgsResults, searchWeb } from '../agent/web';

test('DDGS links reuse original-page Evidence and report transport failures honestly', async t => {
  const keys = ['ASSISTANT_WEB_SEARCH_PROVIDER', 'ASSISTANT_WEB_SEARCH_URL', 'ASSISTANT_DDGS_BACKEND'];
  const before = keys.map(key => process.env[key]);
  const requests: URL[] = [];
  let status = 200;
  let packet: unknown = { results: [{ href: 'https://maker.example/original', title: 'Manufacturer', body: 'Search snippet is not evidence' }] };
  const server = createServer((req, res) => {
    requests.push(new URL(req.url!, 'http://localhost'));
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(packet));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    process.env.ASSISTANT_WEB_SEARCH_PROVIDER = 'ddgs';
    process.env.ASSISTANT_WEB_SEARCH_URL = `http://127.0.0.1:${address.port}/`;
    process.env.ASSISTANT_DDGS_BACKEND = 'yahoo';
    const query = { query: 'synthetic product conditions', domains: ['maker.example'] };
    await t.test('official API receives fixed backend and public domain hints; only the original becomes Evidence', async () => {
      const provider = configuredWebProvider(); assert.equal(provider?.name, 'ddgs');
      const original = 'Manufacturer original conditions remain complete and require separate checks of the actual site. '.repeat(3);
      const result = await searchWeb(query, provider, async url => ({ url, body: original, type: 'text/plain' }));
      assert.equal(requests[0].pathname, '/search/text'); assert.equal(requests[0].searchParams.get('backend'), 'yahoo');
      assert.equal(requests[0].searchParams.get('query'), 'synthetic product conditions (site:maker.example)');
      assert.equal(requests[0].searchParams.get('max_results'), '8');
      assert.equal(result.status, 'ready'); assert.equal(result.pages[0].text, original.trim());
      assert.doesNotMatch(JSON.stringify(result), /Search snippet/);
    });
    await t.test('upstream HTTP failure is unavailable, not empty or a provider fallback', async () => {
      status = 500;
      const result = await searchWeb(query, configuredWebProvider());
      assert.equal(result.status, 'unavailable'); assert.deepEqual(result.failures, [{ code: 'web_search_http_500' }]);
      assert.deepEqual(result.pages, []); assert.equal(requests.length, 2);
    });
    await t.test('SearXNG keeps its original endpoint and packet contract', async () => {
      process.env.ASSISTANT_WEB_SEARCH_PROVIDER = 'searxng'; status = 200;
      packet = { results: [{ url: 'https://maker.example/original', title: 'Manufacturer' }], unresponsive_engines: [] };
      assert.deepEqual(await configuredWebProvider()!.search(query), [{ url: 'https://maker.example/original', title: 'Manufacturer' }]);
      assert.equal(requests[2].pathname, '/search'); assert.equal(requests[2].searchParams.get('format'), 'json');
    });
    await t.test('malformed DDGS responses fail instead of fabricating an empty result', () => {
      assert.deepEqual(ddgsResults({ results: [] }), []);
      for (const invalid of [null, [], {}, { results: [{}] }, { results: [{ url: 'https://maker.example', title: 'wrong schema' }] }])
        assert.throws(() => ddgsResults(invalid), /invalid_web_search_response/);
    });
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
