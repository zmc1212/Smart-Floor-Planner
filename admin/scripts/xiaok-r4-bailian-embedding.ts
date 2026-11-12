import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { getPlatformLlmRuntimeConfig } from '@/lib/platform-llm-config';
import { closePostgresPool } from '@/lib/postgresql';
import { bailianResponsesBinding } from '@/lib/ai/providers/bailian-responses-capabilities';

const rates = { 'qwen3.7-text-embedding': 0.0005, 'qwen3.7-text-embedding-flash': 0.000125, 'text-embedding-v4': 0.0005 };
const fixture = JSON.parse(readFileSync('scripts/fixtures/xiaok-ppt-craft-preview.json', 'utf8')) as { drafts: Array<{ title: string; body: string }> };
const originals = [...fixture.drafts.map(entry => entry.title + '\n' + entry.body),
  '合成检索样本：插座点位先核对平面图、家具位置和用电设备清单。', '合成检索样本：确认橱柜门开启方向与操作动线。',
  '合成检索样本：量房前确认各房间的可进入时间。', '合成检索样本：电器型号以产品说明书为准。'];
const cases = [
  { query: '师傅主要在做家里的用水管路，现在是什么工序？', target: 0 },
  { query: '卫生间防水和后续检查是谁安排的？', target: 1 },
  { query: '地砖方向怎么提，铺贴前会先做什么？', target: 2 },
  { query: '施工时门窗上的保护材料要留下吗？', target: 3 },
  { query: '先核对插座位置还是先看家具和用电设备？', target: 4 },
  { query: '柜门打开时会不会影响走动？', target: 5 },
];
const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? null;
const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);

async function main() {
  const runtime = await getPlatformLlmRuntimeConfig().finally(closePostgresPool);
  const base = process.env.ASSISTANT_BAILIAN_EMBEDDING_BASE_URL || runtime.baseUrl;
  const key = process.env.ASSISTANT_BAILIAN_EMBEDDING_API_KEY || runtime.apiKey;
  assert.ok(key && bailianResponsesBinding(base, 'qwen3.7-flash'), 'Existing authorized Bailian model credential is required');
  const origin = new URL(base).origin;
  const file = 'tmp/r4/bailian-embedding-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  const workspace = process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID
    || /^([a-z0-9-]+)\.cn-beijing\.maas\.aliyuncs\.com$/.exec(new URL(base).hostname)?.[1];
  const trials = [];
  mkdirSync('tmp/r4', { recursive: true });
  for (const model of Object.keys(rates) as Array<keyof typeof rates>) {
    const latency: number[] = [], ranks: number[][] = [], receipts: unknown[] = [];
    let tokens = 0;
    async function embed(input: string[]) {
      const started = performance.now();
      const response = await fetch(origin + '/compatible-mode/v1/embeddings', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ model, input, dimensions: 1024, encoding_format: 'float' }) });
      const elapsedMs = Math.round(performance.now() - started);
      latency.push(elapsedMs);
      const data = await response.json();
      const usage = Number(data.usage?.prompt_tokens ?? data.usage?.total_tokens) || null;
      receipts.push({ http: response.status, code: data.error?.code ?? data.code ?? null, requestId: response.headers.get('x-request-id')
        || response.headers.get('x-dashscope-request-id') || data.request_id || null, elapsedMs, inputTokens: usage });
      if (!response.ok || !Array.isArray(data.data) || data.data.length !== input.length) return null;
      const vectors = data.data.sort((a: {index: number}, b: {index: number}) => a.index - b.index).map((row: {embedding: number[]}) => row.embedding) as number[][];
      assert.ok(vectors.every(vector => vector.length === 1024 && vector.every(Number.isFinite)));
      tokens += usage ?? 0;
      return vectors;
    }
    for (let round = 0; round < 3; round++) {
      try {
        const docs = await embed(originals);
        if (!docs) break;
        const queries = await embed(cases.map(test => test.query));
        if (!queries) break;
        ranks.push(queries.map((query, i) => docs.map((doc, index) => ({ index, score: cosine(query, doc) }))
          .sort((a, b) => b.score - a.score).findIndex(hit => hit.index === cases[i].target) + 1));
      } catch (error) {
        receipts.push({ failure: error instanceof Error ? error.name : 'unknown' });
        break;
      }
    }
    const summary = { model, completedRounds: ranks.length, ranks, top1: ranks.flat().filter(rank => rank === 1).length,
      top3: ranks.flat().filter(rank => rank > 0 && rank <= 3).length, queryCount: ranks.flat().length,
      latencyMedianMs: median(latency), inputTokens: tokens || null, beijingListPricePer1000TokensCny: rates[model],
      estimatedCny: tokens ? tokens / 1000 * rates[model] : null, actualCostCny: null, receipts };
    console.log(JSON.stringify(summary));
    trials.push(summary);
  }
  writeFileSync(file, JSON.stringify({ scope: 'PPT verified craft and labeled synthetic distractors; no account settlement data',
    workspaceConfigured: !!workspace, queryCount: cases.length, corpusCount: originals.length, cases, trials }, null, 2), { flag: 'wx' });
  console.log('Evidence', file);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'bailian_probe_failed'); process.exitCode = 1; });
