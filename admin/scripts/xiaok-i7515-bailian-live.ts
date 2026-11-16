import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { executeBailianResponses } from '@/lib/ai/providers/bailian-responses-client';
import { asObject } from '@/lib/ai/providers/http';
import { BAILIAN_KNOWLEDGE_MODEL, BAILIAN_RAG, BailianKnowledgeProvider } from '@/lib/assistant/knowledge/bailian-provider';
import type { TextModelGateway } from '@/lib/assistant/contracts';
import type { ModelMessage } from '@/lib/assistant/contracts/model';

const deepseek = 'deepseek-v4.1-flash-1017';
const models = [BAILIAN_KNOWLEDGE_MODEL, deepseek];
const permissions = '/api/v1/models/permissions';
const requestIdPattern = /^[a-zA-Z0-9_.:-]{1,240}$/;
const id = (value: unknown) => typeof value === 'string' && requestIdPattern.test(value) ? value : null;
const summarizedRows = (value: unknown) => Array.isArray(value) ? value.slice(0, 15).map(item => {
  const row = asObject(item), meta = asObject(row.metadata);
  return { id: id(row.id), documentId: id(row.doc_id ?? meta.doc_id), status: row.status,
    tags: row.tags, name: row.name, sliceId: id(meta._id), indexId: id(meta.pipeline_id),
    workspaceId: id(meta.workspace_id), chunkStatus: meta._chunk_status, score: row.score,
    textPreview: typeof row.text === 'string' ? row.text.slice(0, 250) : undefined };
}) : undefined;

/** Acceptance transport. Always sends production adapter calls to the dedicated
 * workspace. Captures receipts without headers, credentials or signed URLs. */
export class LiveBailianAcceptance {
  readonly workspace: string;
  readonly client: BailianKnowledgeProvider;
  readonly model: TextModelGateway;
  readonly receipts: Array<Record<string, unknown>> = [];
  readonly modelResults: Array<Record<string, unknown>> = [];
  private readonly nativeFetch = globalThis.fetch;
  private readonly origin: string;
  private readonly key: string;
  private readonly embeddingOrigin: string;
  private readonly requestedIndices = new Map<string, number>();
  private readonly files = new Set<string>();
  private readonly deletedFiles = new Set<string>();
  private readonly granted = new Set<string>();
  private readonly rentals: Array<{ indexId: string; createdAt: number; deletedAt: number }> = [];
  private lastRetrieve = 0;
  private readonly startedAt = Date.now();
  private nextFault: 'transport' | 'gateway' | 'denied' | null = null;
  private installed = false;
  stopEmbedding = false;

  constructor(private readonly receiptFile: string) {
    const env = parseEnv(readFileSync('.env.local', 'utf8'));
    this.workspace = env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID?.trim() ?? '';
    this.key = env.ASSISTANT_BAILIAN_RAG_API_KEY?.trim() ?? '';
    assert.match(this.workspace, /^(ws|llm)-[a-z0-9-]+$/);
    assert.equal(this.workspace, process.env.XIAOK_I7515_EXPECTED_WORKSPACE_ID, 'Set the dedicated acceptance workspace explicitly');
    assert.ok(this.key.startsWith('sk-'), 'Dedicated workspace key missing');
    this.origin = 'https://' + this.workspace + '.cn-beijing.maas.aliyuncs.com';
    this.embeddingOrigin = new URL(process.env.ASSISTANT_EMBEDDING_URL!).origin;
    process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID = this.workspace;
    process.env.ASSISTANT_BAILIAN_RAG_API_KEY = this.key;
    this.client = new BailianKnowledgeProvider(undefined, this.fetch);
    const runtime: AiProviderRuntimeConfig = {
      id: 'xiaok-i7515-acceptance', key: 'bailian', name: 'Bailian Beijing acceptance', adapterType: 'openai_compatible',
      apiKey: this.key, baseUrl: this.origin + '/compatible-mode/v1', modelMappings: { 'chat.general': deepseek },
      capabilities: ['chat'], timeoutMs: 60_000,
    };
    this.model = {
      capabilities: { streaming: false, toolCalling: false, usage: true },
      generate: async input => {
        assert.equal(input.owner.kind, 'assistant_run');
        const evidence = { logicalModel: 'deepseek-flash', runId: 'runId' in input.owner ? String(input.owner.runId) : null };
        try {
          const result = await executeBailianResponses(runtime, {
            model: deepseek, tools: [], maxTokens: Math.min(512, input.maxTokens), enableThinking: false,
            messages: input.messages.map(({role, content}): ModelMessage => role === 'assistant' ? { role, content }
              : { role, content: [{ type: 'text', text: content }] }),
          }, { retryPolicy: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } });
          const usage = result.usage;
          this.modelResults.push({ ...evidence, status: 'received', provider: runtime.key, model: result.providerModel,
            protocol: result.observation?.protocol, requestId: result.providerRequestId, usage,
            estimatedYuan: usage ? (2 * usage.inputTokens + 8 * usage.outputTokens) / 1_000_000 : null, output: result.text });
          assert.equal(result.providerModel, deepseek, 'Response model differs from the fixed snapshot');
          assert.ok(result.providerRequestId && usage, 'Responses receipt missing request ID or usage');
          return { text: result.text, attemptId: '', usage, finishReason: result.finishReason, providerRequestId: result.providerRequestId };
        } catch (error) {
          this.modelResults.push({ ...evidence, status: 'failed', provider: runtime.key, model: deepseek,
            code: error instanceof AiProviderError ? error.code : 'response_verification_failed',
            diagnostic: error instanceof AiProviderError ? error.diagnostic : undefined });
          throw error;
        } finally {
          this.save();
        }
      },
    };
  }

  private save() {
    writeFileSync(this.receiptFile, JSON.stringify({
      workspace: this.workspace, receipts: this.receipts, modelResults: this.modelResults, rentals: this.rentals,
    }, null, 2) + '\n');
  }

  private readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin === this.embeddingOrigin) {
      if (this.stopEmbedding) throw new Error('acceptance_embedding_fault');
      return this.nativeFetch(input, init);
    }
    const oss = url.protocol === 'https:' && /\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname) && init?.method === 'PUT';
    assert.ok(url.origin === this.origin || oss, 'Unexpected external destination in live acceptance');
    const operation = oss ? 'oss_put' : url.pathname.split('/').at(-1)!;
    const body = typeof init?.body === 'string' ? asObject(JSON.parse(init.body)) : {};
    const indexId = id(body.index_id ?? body.indexId ?? url.searchParams.get('index_id'));
    if (operation === 'applyFileUploadLease') {
      assert.ok(this.count(operation) < 5 && Number(body.sizeBytes) <= 2048, 'Synthetic upload budget exceeded');
    }
    if (operation === 'create_v2') {
      assert.ok(this.requestedIndices.size < 3 && body.sinkType === 'BUILT_IN'
        && typeof body.name === 'string' && /^xk-[a-f0-9]{17}$/.test(body.name), 'Temporary standard knowledge-base budget exceeded');
      this.requestedIndices.set(body.name, Date.now());
    }
    if (operation === 'retrieve') {
      const fault = this.nextFault;
      this.nextFault = null;
      if (fault) {
        this.receipts.push({ operation, indexId, provider: BAILIAN_RAG, model: BAILIAN_KNOWLEDGE_MODEL, simulatedFault: fault });
        if (fault === 'transport') throw new Error('acceptance_bailian_transport_fault');
        const status = fault === 'gateway' ? 503 : 403;
        return Response.json({ code: 'AcceptanceInjectedFault' }, { status });
      }
      assert.ok(this.count(operation) < 24, 'Retrieval budget exceeded');
      await delay(Math.max(0, this.lastRetrieve + 1100 - Date.now()));
      this.lastRetrieve = Date.now();
    }
    if (operation === 'responses') assert.ok(this.count(operation) < 2, 'DeepSeek request budget exceeded');
    if (['applyFileUploadLease', 'create_v2', 'retrieve', 'responses'].includes(operation))
      assert.ok(Date.now() - this.startedAt < 30 * 60_000, 'Live acceptance time budget exceeded');

    const receipt: Record<string, unknown> = { at: new Date().toISOString(), operation, method: init?.method ?? 'GET',
      provider: operation === 'responses' || operation === 'permissions' ? 'bailian' : BAILIAN_RAG,
      model: body.model ?? url.searchParams.get('model') ?? (operation === 'responses' ? deepseek : BAILIAN_KNOWLEDGE_MODEL),
      indexId, documentId: id(body.docId), fileId: id(body.fileId), name: body.name ?? body.fileName,
      modelPermissionChanges: operation === 'permissions' ? body.models : undefined,
      docIds: body.docIds ?? body.doc_ids, status: 'started', requestId: null, usage: null, estimatedYuan: null };
    this.receipts.push(receipt);
    this.save();
    try {
      const response = await this.nativeFetch(input, { ...init, redirect: 'error' });
      const payload = oss ? {} : asObject(await response.clone().json().catch(() => null));
      const data = asObject(payload.data), error = asObject(payload.error);
      const modelPermissions = asObject(payload.output).permissions;
      const usage = asObject(payload.usage ?? data.usage);
      const tokens = usage.input_tokens ?? usage.prompt_tokens, output = usage.output_tokens ?? usage.completion_tokens;
      const fileId = id(data.fileId);
      Object.assign(receipt, {
        status: 'received', httpStatus: response.status, providerCode: payload.code ?? error.code,
        requestId: id(payload.requestId ?? payload.request_id) ?? response.headers.get('x-request-id')
          ?? response.headers.get('x-dashscope-request-id') ?? response.headers.get('x-oss-request-id'),
        message: String(payload.message ?? error.message ?? '').replaceAll(this.key, '[REDACTED]').slice(0, 300),
        model: payload.model ?? receipt.model, indexId: indexId ?? (operation === 'create_v2' ? id(data.id ?? data.pipelineId) : null),
        fileId: fileId ?? receipt.fileId, usage: Object.keys(usage).length ? usage : null,
        estimatedYuan: typeof tokens === 'number' ? operation === 'responses'
          ? (2 * tokens + 8 * Number(output ?? 0)) / 1_000_000 : 0.0005 * tokens / 1000 : null,
        dataFields: Object.keys(data), providerStatus: data.status ?? data.ingestion_status, transportStatus: payload.status,
        total: data.total_count ?? data.total, rows: summarizedRows(data.rows ?? data.nodes),
        modelPermissions: operation === 'permissions' && Array.isArray(modelPermissions) ? modelPermissions.map(value => {
          const item = asObject(value);
          return { model: item.model_id ?? item.model, inference: asObject(item.permissions).inference };
        }) : undefined,
        ingestionId: id(data.ingestionId), pipelineId: id(data.pipelineId),
        leaseType: data.type, leaseMethod: asObject(data.param).method, leaseHeaders: Object.keys(asObject(asObject(data.param).headers)),
      });
      if (operation === 'addFile' && payload.code === 'Success' && fileId) this.files.add(fileId);
      if (operation === 'deleteFile' && payload.code === 'Success' && typeof body.fileId === 'string') this.deletedFiles.add(body.fileId);
      return response;
    } catch (error) {
      receipt.status = 'unknown';
      receipt.networkCode = error instanceof Error ? error.name : 'unexpected_error';
      throw error;
    } finally {
      this.save();
    }
  };

  count(operation: string) {
    return this.receipts.filter(item => item.operation === operation && !item.simulatedFault).length;
  }

  fault(kind: 'transport' | 'gateway' | 'denied') { this.nextFault = kind; }

  private async request(path: string, body?: object, pendingCode?: string) {
    const response = await this.fetch(new URL(path, this.origin), {
      method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12_000),
    });
    const data = asObject(await response.json());
    if (pendingCode && data.code === pendingCode) return data;
    assert.ok(response.ok && data.success === true, 'Bailian operation rejected: ' + path);
    return data;
  }

  private async inference(model: string) {
    const path = permissions + '?authorization_scope=AUTHORIZED&action=INFERENCE&model=' + model;
    const data = await this.request(path);
    const rows = asObject(data.output).permissions;
    assert.ok(Array.isArray(rows));
    return rows.map(asObject).some(entry => (entry.model_id ?? entry.model) === model);
  }

  async start() {
    this.installed = true;
    globalThis.fetch = this.fetch;
    const listing = await this.client.listIndices();
    assert.deepEqual(listing.value, [], 'Use an empty dedicated RAG workspace');
    for (const model of models) if (!await this.inference(model)) this.granted.add(model);
    if (this.granted.size) {
      await this.request(permissions, { models: [...this.granted].map(model => ({ model, inference: true })) });
      for (const model of this.granted) assert.equal(await this.inference(model), true);
    }
    return listing.requestId;
  }

  async cleanup() {
    if (!this.installed) return { status: 'not_run' };
    const errors: unknown[] = [];
    try {
      for (const index of (await this.client.listIndices()).value) {
        const createdAt = this.requestedIndices.get(index.name);
        if (createdAt === undefined) continue;
        try {
          let removed = false;
          for (let attempt = 0; attempt < 7; attempt++) {
            const result = await this.request('/api/v1/indices/rag/index/delete', { index_id: index.id }, 'Index.IndexStatusError');
            if (result.success === true) { removed = true; break; }
            if (attempt < 6) await delay(10_000);
          }
          assert.ok(removed, 'The temporary knowledge base is still provisioning: ' + index.id);
          this.rentals.push({ indexId: index.id, createdAt, deletedAt: Date.now() });
        } catch (error) { errors.push(error); }
      }
      const remaining = (await this.client.listIndices()).value.filter(index => this.requestedIndices.has(index.name));
      assert.deepEqual(remaining, [], 'Temporary knowledge bases remain');
    } catch (error) { errors.push(error); }
    for (const fileId of this.files) if (!this.deletedFiles.has(fileId)) {
      try { await this.client.deleteFile(fileId); } catch (error) { errors.push(error); }
    }
    try {
      if (this.granted.size) {
        await this.request(permissions, { models: [...this.granted].map(model => ({ model, inference: false })) });
        for (const model of this.granted) assert.equal(await this.inference(model), false);
      }
    } catch (error) { errors.push(error); }
    finally { globalThis.fetch = this.nativeFetch; this.save(); }
    if (errors.length) throw new AggregateError(errors, 'Bailian test cleanup incomplete');
    return { temporaryIndicesDeleted: this.rentals.length, registeredFilesDeleted: this.deletedFiles.size,
      modelPermissionsRestored: [...this.granted] };
  }
}
