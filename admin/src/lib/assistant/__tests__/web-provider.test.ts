import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { configuredWebProvider, ddgsResults, openserpResults, searchWeb } from '../agent/web';

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

test('OpenSERP keeps organic discovery separate from original-page evidence', async t => {
  const keys = ['ASSISTANT_WEB_SEARCH_PROVIDER', 'ASSISTANT_WEB_SEARCH_URL', 'ASSISTANT_OPENSERP_ENGINES'];
  const before = keys.map(key => process.env[key]);
  const organic = { type: 'organic', title: 'Manufacturer', url: 'https://maker.example/original', snippet: 'Not the original', engine: 'baidu' };
  const meta = { engines_responded: ['baidu'], engines_failed: [] as string[] };
  let status = 200, packet: unknown = { meta, results: [
    { ...organic, type: 'ad', url: 'https://ads.example/click' },
    organic, organic, { ...organic, type: 'answer', url: 'https://answers.example/' },
  ] };
  const requests: URL[] = [];
  const server = createServer((req, res) => {
    requests.push(new URL(req.url!, 'http://localhost'));
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(packet));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    process.env.ASSISTANT_WEB_SEARCH_PROVIDER = 'openserp';
    process.env.ASSISTANT_WEB_SEARCH_URL = `http://127.0.0.1:${address.port}/`;
    delete process.env.ASSISTANT_OPENSERP_ENGINES;
    const query = { query: 'synthetic product conditions', domains: ['maker.example'] };
    await t.test('stock API receives the complete query and extraction stays in the guarded reader', async () => {
      const reads: string[] = [], original = 'Manufacturer original: substrate must be dry, solid and free of loose matter. '.repeat(3);
      const result = await searchWeb(query, configuredWebProvider(), async url => {
        reads.push(url); return { url, body: original, type: 'text/plain' };
      });
      assert.equal(requests[0].pathname, '/mega/search');
      assert.equal(requests[0].searchParams.get('text'), 'synthetic product conditions (site:maker.example)');
      assert.equal(requests[0].searchParams.get('engines'), 'baidu');
      assert.equal(requests[0].searchParams.get('limit'), '8'); assert.equal(requests[0].searchParams.get('extract'), '0');
      assert.deepEqual(reads, [organic.url]); assert.equal(result.pages[0].text, original.trim());
      assert.equal(result.status, 'ready'); assert.doesNotMatch(JSON.stringify(result), /Not the original|ads.example|answers.example/);
    });
    await t.test('one engine failure keeps valid candidates; all failed is unavailable, never empty', async () => {
      packet = { meta: { engines_responded: ['baidu'], engines_failed: ['google'] }, results: [organic] };
      assert.deepEqual(await configuredWebProvider()!.search(query), [{ url: organic.url, title: organic.title }]);
      packet = { meta: { engines_responded: [], engines_failed: ['baidu'] }, results: [] };
      const result = await searchWeb(query, configuredWebProvider());
      assert.equal(result.status, 'unavailable'); assert.deepEqual(result.failures, [{ code: 'web_search_upstream_unavailable' }]);
      assert.deepEqual(openserpResults({ meta, results: [] }), []);
    });
    await t.test('stock error classes survive and do not trigger retries or provider fallback', async () => {
      const count = requests.length;
      status = 429; packet = { error: 'captcha_detected', code: 429, message: 'Sensitive upstream details are not evidence' };
      const result = await searchWeb(query, configuredWebProvider());
      assert.deepEqual(result.failures, [{ code: 'web_search_upstream_captcha_detected' }]);
      assert.equal(result.status, 'unavailable'); assert.deepEqual(result.pages, []);
      assert.equal(requests.length, count + 1); assert.doesNotMatch(JSON.stringify(result), /Sensitive/);
    });
    await t.test('invalid service envelopes and configuration fail before being treated as absent facts', async () => {
      for (const invalid of [null, [], {}, { results: [] }, { meta, results: [{}] }])
        assert.throws(() => openserpResults(invalid), /invalid_web_search_response/);
      process.env.ASSISTANT_OPENSERP_ENGINES = 'unknown';
      const count = requests.length;
      await assert.rejects(configuredWebProvider()!.search(query), /invalid_web_search_configuration/);
      assert.equal(requests.length, count);
    });
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
