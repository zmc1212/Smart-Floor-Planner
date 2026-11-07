import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseMineruPage, type MineruPage } from '../knowledge/mineru';
import { fastGPTCandidates, fastGPTPreviewProtocol, type FastGPTRetrievalConfig } from '../knowledge/fastgpt-retrieval';
import { constructionReadOnlyTools } from '../agent/worker';
import { fileLabel } from '../knowledge/source-file';

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
test('reviewed MinerU rows bind only the conditions of their own original table', () => {
  const prefix = table.slice(0, table.indexOf('\n'));
  const electrical = prefix + '\n<table><tr><td>电器</td><td>合价</td></tr><tr><td>冰箱</td><td>17900</td></tr></table>';
  const unlabelled = prefix + '\n<table><tr><td>汇总</td><td>11100</td></tr></table>';
  const chunks = [{ ...page.chunks[0], chunkIndex: 38, q: prefix + '\n定制柜预算表\n建筑装修面积：97m²' }, ...page.chunks,
    { ...page.chunks[0], chunkIndex: 40, q: electrical }, { ...page.chunks[0], chunkIndex: 41, q: unlabelled }];
  const reviewed: MineruPage = { ...page, chunks, review: {
    protocol: 'mineru-table-review-v1', layoutSha256: 'c'.repeat(64), pageImageSha256: 'd'.repeat(64),
    limitations: ['未标面积的汇总表保留原样。'],
    tables: [
      { chunkIndex: 39, chunkSha256: hash(table), region: [10, 20, 480, 900], bookPage: '25', context: ['定制柜预算表', '建筑装修面积：97m²'] },
      { chunkIndex: 40, chunkSha256: hash(electrical), region: [520, 20, 990, 480], bookPage: '26', context: ['电器预算表', '仅供参考，不包含在装修总价内', '建筑装修面积：83.98m²'] },
      { chunkIndex: 41, chunkSha256: hash(unlabelled), region: [520, 500, 990, 550], bookPage: '26', context: [] },
    ],
  } };
  const parsed = parseMineruPage(reviewed);
  const row = parsed.blocks.find(b => b.text === '冰箱 | 17900')!;
  assert.equal(parsed.parser, 'mineru-reviewed-page-v3');
  assert.deepEqual(row.headers?.slice(0, 3), reviewed.review!.tables[1].context);
  assert.deepEqual(row.section, ['【来源:精艺装修手册 PDF第14页|书页26】']);
  assert.equal(row.extraction?.chunkSha256, hash(electrical));
  assert.equal(row.extraction?.review?.contextSha256, hash(JSON.stringify(reviewed.review!.tables[1].context)));
  assert.deepEqual(row.extraction?.review?.region, [520, 20, 990, 480]);
  assert.deepEqual(parsed.blocks.at(-1)?.headers, ['汇总 | 11100']);
  assert.ok(parsed.warnings.includes('未标面积的汇总表保留原样。'));
  assert.deepEqual(parsed.blocks.map(b => b.cells), parseMineruPage({ ...reviewed, review: undefined }).blocks.map(b => b.cells));
  assert.throws(() => parseMineruPage({ ...reviewed, review: { ...reviewed.review!, tables: reviewed.review!.tables.slice(0, 2) } }), /context_changed/);
  assert.throws(() => parseMineruPage({ ...reviewed, chunks: chunks.map(c => c.chunkIndex === 40 ? { ...c, q: c.q.replace('17900', '18000') } : c) }), /context_changed/);
});
test('reviewed text and table keep their distinct printed pages inside one PDF spread', () => {
  const caption = page.chunks[0].q.split('\n')[0] + '\n定制柜预算表\n建筑装修面积：97m²';
  const input: MineruPage = { ...page, chunks: [{ ...page.chunks[0], chunkIndex: 38, q: caption }, ...page.chunks],
    review: { protocol: 'mineru-table-review-v1', layoutSha256: 'c'.repeat(64), pageImageSha256: 'd'.repeat(64),
      tables: [{ chunkIndex: 39, chunkSha256: hash(table), region: [520, 20, 990, 480], bookPage: '26', context: [] }],
      texts: [{ chunkIndex: 38, chunkSha256: hash(caption), region: [20, 20, 480, 100], bookPage: '25' }] } };
  const parsed = parseMineruPage(input);
  assert.equal(parsed.parser, 'mineru-reviewed-page-v4');
  assert.deepEqual(parsed.blocks[0].section, ['【来源:精艺装修手册 PDF第14页|书页25】']);
  assert.deepEqual(parsed.blocks[1].section, ['【来源:精艺装修手册 PDF第14页|书页26】']);
  assert.equal(parsed.blocks[0].page, 1);
  assert.equal(fileLabel(parsed.blocks[0]), '原PDF第14页 · 书页25 · 段落1');
  assert.match(fileLabel(parsed.blocks[1]), /^原PDF第14页 · 书页26 · 表1/);
  assert.throws(() => parseMineruPage({ ...input, review: { ...input.review!, texts: [] } }), /context_changed/);
  assert.throws(() => parseMineruPage({ ...input, review: { ...input.review!, texts: [{ ...input.review!.texts![0], chunkSha256: 'e'.repeat(64) }] } }), /context_changed/);
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
