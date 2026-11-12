import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKnowledgeToolRegistry, knowledgeToolNames } from '../knowledge/rag-tools';
import { ToolExecutor } from '../tools/executor';
import { chunkDocument } from '../knowledge/chunk-gateway';
import { embeddingGateway, configuredEmbeddingProfile, EMBEDDING_PROFILE } from '../infrastructure/embedding-gateway';
import { fileChunks, parseSourceFile, uploadedFile } from '../knowledge/source-file';
import type { ActorContext } from '../contracts';
import { parseSynthesis, unresolvedSynthesisConflict, type SynthesisSource } from '../agent/synthesis';
import { siteKnowledgeQuestion } from '@/lib/construction/site-knowledge';

const actor: ActorContext = { enterpriseId: '1454', principal: { kind: 'user', userId: '7' }, contextVersion: 1, capabilities: ['assistant.chat.self'] };

test('R4 registry exposes only read operations and validates bound scope', async () => {
  let allowed = false;
  let executions = 0;
  const registry = createKnowledgeToolRegistry({
    authorize: async scope => allowed && scope.projectId === '1' ? { allowed: true } : { allowed: false, reason: 'scope' },
    execute: async () => ({ count: ++executions }),
  });
  assert.deepEqual(registry.toModelTools().map(tool => tool.name), [...knowledgeToolNames]);
  const executor = new ToolExecutor(registry);
  const scope = { actor, projectId: '1', turn: 0 };
  const call = (id: string, name: string, args: object) => executor.execute({ id, name, arguments: JSON.stringify(args) }, scope);
  assert.equal((await call('1', 'knowledge_search', { query: '水路' })).status, 'denied');
  allowed = true;
  assert.equal((await call('2', 'knowledge_search', { query: '水路', enterpriseId: '1455' })).status, 'invalid_arguments');
  assert.equal((await call('3', 'knowledge_search', { query: '水路', projectId: '2' })).status, 'invalid_arguments');
  assert.equal((await call('4', 'knowledge_search_by_category', { query: '水路' })).status, 'invalid_arguments');
  assert.equal((await call('5', 'knowledge_get_source', { chunkId: '1', versionId: '2' })).status, 'succeeded');
  assert.equal((await call('6', 'knowledge_publish', { documentId: '1' })).status, 'not_registered');
  assert.equal(executions, 1);
});

test('Markdown hierarchy, table coordinates and complete paragraphs reach source locators', async () => {
  const text = '# 施工标准\n\n### 防水验收\n\n基层清理后先核查。\n只有核对记录齐全，才能进入后续工序。\n\n| 工序 | 条件 |\n| --- | --- |\n| 后续施工 | 检查记录齐全 |';
  const file = uploadedFile({ fileName: '标准.markdown', fileBase64: Buffer.from(text).toString('base64'), authorization: '合成测试' });
  const parsed = await parseSourceFile(file.data, file.format);
  assert.equal(parsed.title, '施工标准');
  assert.deepEqual(parsed.blocks[2].section, ['施工标准', '防水验收']);
  const chunks = await fileChunks({ version: 1, assetId: '1', hash: file.hash, format: file.format, name: file.name,
    parsed, review: { at: new Date(0).toISOString(), adminId: '1', excluded: [] } },
  async value => [{ text: value, tokens: 20, start: 0, end: Array.from(value).length }]);
  const condition = chunks.find(chunk => chunk.text.includes('才能进入'));
  assert.ok(condition?.text.includes('基层清理'));
  assert.equal(condition?.file.line, 5);
  assert.equal(condition?.file.endLine, 6);
  assert.equal(condition?.file.page, undefined);
  assert.ok(chunks.some(chunk => chunk.file.kind === 'table_row' && chunk.text.includes('检查记录齐全') && chunk.text.includes('| 工序 | 条件 |')));
});

test('UTF-8 TXT locators and bad file signatures are explicit', async () => {
  const result = await parseSourceFile(Buffer.from('第一章 工序\r\n\r\n第一节 防水\r\n\r\n完成核对后再进入下一道工序。'), 'txt');
  assert.deepEqual(result.blocks.at(-1)?.section, ['第一章 工序', '第一节 防水']);
  assert.equal(result.blocks.at(-1)?.line, 5);
  for (const [fileName, data] of [['legacy.doc', Buffer.from('legacy')], ['fake.pdf', Buffer.from('hello')], ['binary.txt', Buffer.from([0, 255])]] as const) {
    assert.throws(() => uploadedFile({ fileName, fileBase64: data.toString('base64'), authorization: '合成' }), /knowledge_file_invalid/);
  }
});

test('compatible Embedding provider has a separate immutable profile and whole paragraph chunking', async () => {
  const names = ['ASSISTANT_EMBEDDING_PROVIDER', 'ASSISTANT_EMBEDDING_MODEL', 'ASSISTANT_EMBEDDING_REVISION'] as const;
  const previous = names.map(name => process.env[name]);
  try {
    process.env.ASSISTANT_EMBEDDING_PROVIDER = 'openai_compatible';
    process.env.ASSISTANT_EMBEDDING_MODEL = 'embedding-test';
    process.env.ASSISTANT_EMBEDDING_REVISION = 'test-revision';
    const profile = configuredEmbeddingProfile();
    assert.notEqual(profile.id, EMBEDDING_PROFILE.id);
    const gateway = embeddingGateway({ url: 'http://127.0.0.1:10001/v1', apiKey: 'synthetic', fetch: async (url, input) => {
      assert.equal(String(url), 'http://127.0.0.1:10001/v1/embeddings');
      const body = JSON.parse(String(input?.body));
      assert.deepEqual(body.input, ['查询']);
      assert.equal(body.model, 'embedding-test');
      assert.equal(body.input_type, undefined);
      return Response.json({ model: 'embedding-test', data: [{ index: 0, embedding: [2, ...Array(1023).fill(0)] }] });
    } });
    assert.equal((await gateway.embed(['查询'], 'query')).vectors[0][0], 1);
    const original = '甲'.repeat(155) + '\n\n复核前提。\n\n' + '乙'.repeat(160);
    const chunks = await chunkDocument(original);
    assert.equal(chunks.length, 2);
    assert.ok(chunks.every(chunk => chunk.text === Array.from(original).slice(chunk.start, chunk.end).join('')));
    assert.ok(chunks.every(chunk => chunk.text.includes('复核前提。')));
    process.env.ASSISTANT_EMBEDDING_REVISION = 'next-revision';
    assert.notEqual(configuredEmbeddingProfile().id, profile.id);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

test('public facts cannot establish a company rule and conflicts require explicit uncertainty', () => {
  const web: SynthesisSource = { sourceId: 'W1', kind: 'web', text: '一般建议先核对基层。', title: '公开资料' };
  const answer = (text: string) => JSON.stringify({ kind: 'synthesis',
    segments: [{ basis: 'evidence', text, citations: [{ sourceId: web.sourceId, quote: web.text }] }] });
  assert.throws(() => parseSynthesis(answer('公司施工标准要求先核对基层。'), [web], { enterpriseKnowledgeAuthority: true }), /ungrounded_response_scope/);
  assert.equal(parseSynthesis(answer('公开资料建议先核对基层。'), [web], { enterpriseKnowledgeAuthority: true }).segments.length, 1);
  const conflict: SynthesisSource = { sourceId: 'K1', kind: 'knowledge', text: '规则存在冲突，适用范围未核实。', title: '待核对资料' };
  assert.equal(unresolvedSynthesisConflict([conflict]), true);
  assert.throws(() => parseSynthesis(answer('公开资料建议先核对基层。'), [web, conflict]), /unresolved_evidence_conflict/);
  assert.equal(siteKnowledgeQuestion('本项目现场记录和公司标准相比，有什么差异？', 'query', 0), true);
});
