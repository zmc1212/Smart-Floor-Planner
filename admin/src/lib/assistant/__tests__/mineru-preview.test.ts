import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseMineruPage, type MineruPage } from '../knowledge/mineru';
import { fastGPTCandidates, fastGPTPreviewProtocol, type FastGPTRetrievalConfig } from '../knowledge/fastgpt-retrieval';
import { constructionReadOnlyTools } from '../agent/worker';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const table = '【来源:精艺装修手册 PDF第14页|书页25-26|样板面积97㎡】\n[表格]\n<table><tr><td rowspan="2">项目</td><td colspan="2">样板价格</td></tr><tr><td>数量</td><td>原表合价</td></tr><tr><td>鞋柜</td><td>22</td><td>1568.00</td></tr></table>';
const page: MineruPage = { page: 14, sourceSha256: 'a'.repeat(64), corpusSha256: 'b'.repeat(64),
  chunks: [{ pdf_page: 14, q: table, chunkIndex: 39, dataId: 'p14-001' }] };

test('MinerU import preserves printed arithmetic, column/row spans and source identity', () => {
  const parsed = parseMineruPage(page);
  assert.equal(parsed.blocks.length, 3);
  assert.equal(parsed.blocks[0].cells?.[0].rowSpan, 2);
  assert.equal(parsed.blocks[1].cells?.[0].column, 2);
  assert.equal(parsed.blocks[2].text, '鞋柜 | 22 | 1568.00');
  assert.equal(parsed.blocks[2].extraction?.chunkSha256, hash(table));
  assert.equal(parsed.blocks[2].extraction?.pdfPage, 14);
  assert.equal(parsed.blocks[2].page, 1);
  assert.ok(parsed.warnings.some(w => w.includes('未发布')));
});
test('MinerU import rejects cross-page, duplicate identity and XML entity definitions', () => {
  assert.throws(() => parseMineruPage({ ...page, page: 13 }));
  assert.throws(() => parseMineruPage({ ...page, chunks: [...page.chunks, ...page.chunks] }));
  assert.throws(() => parseMineruPage({ ...page, chunks: [{ ...page.chunks[0], q: table.replace('<table>', '<table><!DOCTYPE a [<!ENTITY x SYSTEM="file:///private">]>') }] }));
});
test('table group context follows the original band to subtotal rows, then changes at the next band', () => {
  const grouped = '【来源:精艺装修手册 PDF第14页|书页25-26】\n<table><tr><td>序</td><td>项目</td><td>金额</td></tr>'
    + '<tr><td>一</td><td>甲分组</td><td></td></tr><tr><td>1</td><td>明细</td><td>12.50</td></tr>'
    + '<tr><td></td><td>小计</td><td>12.50</td></tr><tr><td>二</td><td>乙分组</td><td></td></tr>'
    + '<tr><td></td><td>小计</td><td>20.00</td></tr></table>';
  const rows = parseMineruPage({ ...page, chunks: [{ ...page.chunks[0], q: grouped }] }).blocks;
  assert.ok(rows[3].headers?.includes('一 | 甲分组 | '));
  assert.ok(rows[5].headers?.includes('二 | 乙分组 | '));
  assert.ok(!rows[5].headers?.includes('一 | 甲分组 | '));
  assert.equal(rows[3].text, ' | 小计 | 12.50');
});
const config: FastGPTRetrievalConfig = { protocol: fastGPTPreviewProtocol, enterpriseId: '1454', baseUrl: 'http://127.0.0.1:18300',
  apiKey: 'fixture-only', datasetId: 'a'.repeat(24), collectionId: 'b'.repeat(24), corpusSha256: 'b'.repeat(64), chunks: [{ chunkIndex: 39, sha256: hash(table) }] };
const row = { datasetId: config.datasetId, collectionId: config.collectionId, chunkIndex: 39, q: table, score: [{ type: 'embedding', value: 0.8, index: 0 }] };
test('FastGPT index returns checked ranks, never upstream prose or generated answers', async () => {
  let calls = 0;
  const request: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.limit, 20000);
    assert.equal(body.datasetSearchUsingExtensionQuery, false);
    return Response.json({ data: { list: [row] } });
  };
  assert.deepEqual(await fastGPTCandidates(config, '97平米样板房鞋柜的单价是多少？', request), [
    { chunkIndex: 39, chunkSha256: hash(table), rank: 1, semanticRank: 1, similarity: 0.8 },
  ]);
  assert.equal(calls, 1);
});
test('FastGPT rejects changed originals and foreign collections, without retrying failure', async () => {
  for (const changed of [{ ...row, q: table + ' changed' }, { ...row, collectionId: 'c'.repeat(24) }])
    await assert.rejects(() => fastGPTCandidates(config, '鞋柜价格', async () => Response.json({ data: { list: [changed] } })), /context_changed/);
  let calls = 0;
  await assert.rejects(() => fastGPTCandidates(config, '鞋柜价格', async () => { calls++; throw Error('timeout'); }), /retrieval_unavailable/);
  assert.equal(calls, 1);
});
test('FastGPT mixed recall retains lexical-only hits without inventing vector similarity', async () => {
  const result = await fastGPTCandidates(config, '鞋柜价格', async () => Response.json({ data: { list: [{ ...row, score: [{ type: 'fullText', value: 2 }] }] } }));
  assert.equal(result[0].similarity, null);
  assert.equal(result[0].rank, 1);
  assert.equal(result[0].semanticRank, null);
});
test('staff preview offers only the original knowledge read and no business writes', () => {
  assert.deepEqual(constructionReadOnlyTools('knowledge_preview', true)?.map(t => t.name), ['search_knowledge']);
  assert.deepEqual(constructionReadOnlyTools('knowledge_preview', false), []);
});
