import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractWebPage, parseWebQuery, publicWebAddress, publicWebUrl, publicDnsAnswers, searchWeb, searxngResults, type WebSearchProvider } from '../agent/web';
import { webEvidence, webSynthesisSources, parseWebCitationId } from '../agent/web-evidence';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, focusedSynthesisMessages } from '../agent/synthesis';
import { readToolInputIssue } from '../agent/read-tool-input';
import { agentToolsForMessage, agentToolsForTurn } from '../agent/worker';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';
import type { ModelMessage } from '../contracts/model';

const query = { query: '地暖地板 厂家适用条件', domains: ['manufacturer.example'] };
const html = '<html><head><title>地板安装条件</title></head><body><nav>菜单</nav><main><h1>地暖适用性</h1><p>先核对地板型号是否明确支持地暖，再核对厂家说明中的基层条件。</p><p>即使型号支持地暖，仍须核对实际基层条件；本网页不能证明某个施工现场已经符合要求。</p><script>globalThis.executed=true</script></main></body></html>';
const provider: WebSearchProvider = { name: 'synthetic-free-provider', search: async () => [{ title: '搜索摘要不作为证据', url: 'https://manufacturer.example/floor' }] };
const read = async (url: string) => ({ url, body: html, type: 'text/html; charset=utf-8' });
const standalone = '这是独立问题，不结合我家或项目，想听一般建议：地板选择应该先比较什么？';

test('upstream engine failure is unavailable rather than an empty public-information search', async () => {
  assert.deepEqual(searxngResults({ results: [], unresponsive_engines: [] }), []);
  assert.throws(() => searxngResults({ results: [], unresponsive_engines: [['duckduckgo', 'timeout']] }), /web_search_upstream_unavailable/);
  assert.throws(() => searxngResults({ results: [], unresponsive_engines: 'broken' }), /invalid_web_search_response/);
  const partial = { results: [null, { url: 'https://manufacturer.example/floor', title: '厂家原文' }], unresponsive_engines: [['google', 'timeout']] };
  assert.equal(searxngResults(partial).length, 1);
  const snapshot = await searchWeb(query, { name: 'synthetic-upstream-failure', search: async () => searxngResults({ results: [], unresponsive_engines: [['duckduckgo', 'timeout']] }) }, read);
  assert.equal(snapshot.status, 'unavailable'); assert.deepEqual(snapshot.failures, [{ code: 'web_search_upstream_unavailable' }]);
  assert.deepEqual(snapshot.pages, []);
});

test('public search input rejects identities and unsupported fields before any network access', () => {
  assert.deepEqual(parseWebQuery(query), query);
  for (const input of [{ ...query, tenantId: '1' }, { ...query, query: '客户电话13812345678' }, { ...query, query: 'someone@example.com 地板' },
    { ...query, domains: ['localhost'] }, { ...query, domains: ['company.internal'] }]) assert.throws(() => parseWebQuery(input));
  assert.equal(readToolInputIssue('search_web', JSON.stringify({ ...query, query: '客户电话13812345678' }))?.code, 'invalid_message');
});

test('page requests reject loopback/private/embedded/credential URLs and special-use addresses', () => {
  for (const value of ['http://127.0.0.1', 'http://2130706433', 'https://10.0.0.1', 'http://169.254.169.254/',
    'https://[::1]', 'https://[::ffff:127.0.0.1]', 'file:///etc/passwd', 'https://user:password@example.com/', 'https://example.com:5432/'])
    assert.throws(() => publicWebUrl(value), value);
  for (const value of ['127.0.0.1', '192.168.1.1', '172.20.0.1', '100.64.1.1', '198.19.1.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::'])
    assert.equal(publicWebAddress(value), false, value);
  assert.equal(publicWebAddress('8.8.8.8'), true); assert.equal(publicWebAddress('2606:4700:4700::1111'), true);
});

test('authenticated public DNS responses remain bound to the question and reject fake/private or mixed answers', () => {
  const answer = { Status: 0, Question: { name: 'manufacturer.example.' }, Answer: [{ type: 1, data: '8.8.8.8' }] };
  assert.deepEqual(publicDnsAnswers(answer, 'manufacturer.example'), [{ address: '8.8.8.8', family: 4 }]);
  assert.deepEqual(publicDnsAnswers({ ...answer, Question: [answer.Question] }, 'manufacturer.example'), [{ address: '8.8.8.8', family: 4 }]);
  for (const invalid of [{ ...answer, Status: 3 }, { ...answer, TC: true }, { ...answer, Question: { name: 'other.example.' } },
    { ...answer, Answer: [] }, { ...answer, Answer: [...answer.Answer, { type: 1, data: '198.18.1.202' }] },
    { ...answer, Answer: [{ type: 1, data: '127.0.0.1' }] }, { ...answer, Answer: [{ type: 28, data: 'fdfe:dcba:9876::208' }] }]) {
    assert.throws(() => publicDnsAnswers(invalid, 'manufacturer.example'));
  }
});

test('HTML parsing retains complete conditions and provenance without scripts or navigation', () => {
  const page = extractWebPage({ url: 'https://manufacturer.example/floor', body: html, type: 'text/html' }, '2026-10-23T00:00:00.000Z');
  assert.equal(page.title, '地板安装条件'); assert.match(page.text, /即使型号支持地暖，仍须核对实际基层条件/);
  assert.doesNotMatch(page.text, /globalThis|菜单/); assert.equal(page.textBytes, Buffer.byteLength(page.text));
  assert.throws(() => extractWebPage({ url: page.url, body: '<main>' + '完整条件'.repeat(5000) + '</main>', type: 'text/html' }), /web_page_too_large/);
});

test('free provider reads actual pages; search snippets and failed reads never become Evidence', async () => {
  const snapshot = await searchWeb(query, provider, read);
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.pages.length, 1);
  assert.doesNotMatch(snapshot.pages[0].text, /搜索摘要/);
  const failed = await searchWeb(query, provider, async () => { throw Error('network down'); });
  assert.equal(failed.status, 'unavailable'); assert.deepEqual(failed.pages, []);
  const redirected = await searchWeb(query, provider, async () => ({ url: 'https://other.example/floor', body: html, type: 'text/html' }));
  assert.equal(redirected.status, 'unavailable'); assert.equal(redirected.failures[0].code, 'web_domain_changed');
  const disabled = await searchWeb(query, null, read); assert.equal(disabled.provider, 'unconfigured'); assert.equal(disabled.status, 'unavailable');
});

test('web originals use the same citation catalog without enterprise or project identities', async () => {
  const evidence = webEvidence(await searchWeb(query, provider, read), '99', 1200), sources = webSynthesisSources(evidence);
  assert.equal(evidence[0].ref.type, 'web_page'); assert.equal(sources[0].kind, 'web');
  const citationId = sourceCitationCatalog(sources[0])[0].citationId;
  const answer = parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '厂家资料提示先核对型号及基层条件，网页不能证明实际现场已经满足要求。', citations: [{ citationId }] }] }), sources, { currentQuestion: standalone });
  assert.equal(answer.segments[0].citations[0].sourceId, sources[0].sourceId);
  assert.deepEqual(parseWebCitationId('w:99:0'), { runId: '99', index: 0 }); assert.equal(parseWebCitationId('w:99:99'), null);
  assert.throws(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '资料原文。', citations: [{ citationId: 'Cforged' }] }] }), sources));
});

test('general advice can answer without retrieval, while actual external reads remain available and scoped', async () => {
  const tools = agentToolsForMessage(standalone, true, false, true);
  assert.deepEqual(tools.map(t => t.name).sort(), ['search_knowledge', 'search_web']);
  const original: ModelMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: standalone }) }] };
  assert.ok(agentToolsForTurn(standalone, [original], tools, 'current').some(t => t.name === 'final_response'));
  const sources = webSynthesisSources(webEvidence(await searchWeb(query, provider, read), '99', 1200));
  const messages: ModelMessage[] = [original, { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_web', arguments: JSON.stringify(query) }] },
    { role: 'tool', callId: 'read', content: JSON.stringify({ synthesisSources: sources }) }];
  const projected = focusedSynthesisMessages(messages, 'current');
  assert.match(JSON.stringify(projected), /manufacturer.example/); assert.match(JSON.stringify(projected), /citationOptions/);
});

test('same query reuses the existing read receipt without repeating search; checkpoints retain the original tool result', async () => {
  let reads = 0, calls = 0; const saved: AgentCheckpoint[] = [];
  const result = await runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '查厂家原文' }] }], tools: agentToolsForMessage('查厂家原文', true, false, true).filter(t => t.name === 'search_web'),
    ports: { authorize: async () => {}, model: async () => {
      const step = calls++; return { text: step < 2 ? '' : 'done', toolCalls: step < 2 ? [{ id: 'read' + step, name: 'search_web', arguments: JSON.stringify(query) }] : [], usage: null, finishReason: 'stop', providerRequestId: null };
    }, tool: async () => { reads++; return { content: JSON.stringify(await searchWeb(query, provider, read)) }; }, checkpoint: async state => { saved.push(structuredClone(state)); } } });
  assert.equal(reads, 1); assert.equal(result.output?.text, 'done'); assert.ok(saved.some(s => s.readReceipts?.length === 1));
});
