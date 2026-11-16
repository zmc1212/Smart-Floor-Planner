import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { executeBailianResponses } from '@/lib/ai/providers/bailian-responses-client';
import { asObject } from '@/lib/ai/providers/http';
import { BAILIAN_KNOWLEDGE_MODEL, BAILIAN_RAG, BailianKnowledgeProvider } from '@/lib/assistant/knowledge/bailian-provider';
import type { TextModelGateway } from '@/lib/assistant/contracts';
import type { ModelMessage } from '@/lib/assistant/contracts/model';
import { LiveLedger, liveIdPattern, liveIndexName, liveModels, readLiveApproval, type LiveAttempt, type LiveEnv, type LiveOperation } from './xiaok-i7515-bailian-live-policy';

type InferenceModel = typeof liveModels[number];
type PermissionWrite = 'permissions_grant' | 'permissions_restore';
const [, deepseek] = liveModels;
const permissions = '/api/v1/models/permissions';
const connector = '/api/v1/connector/dash/';
const index = '/api/v1/indices/rag/index/';
const routes = new Map<string, LiveOperation>([
  ['GET ' + index + 'list', 'list'], ['GET ' + permissions, 'permissions_read'],
  ...(['applyFileUploadLease', 'addFile', 'describeFile', 'deleteFile'] as const).map(op => ['POST ' + connector + op, op] as const),
  ...(['create_v2', 'job/create', 'chunklist', 'retrieve', 'delete', 'delete_file'] as const).map(op => ['POST ' + index + op, op] as const),
  ['GET ' + index + 'files', 'files'], ['GET /api/v1/indices/rag/index_job/status', 'job/status'],
  ['POST /compatible-mode/v1/responses', 'responses'],
]);
const id = (value: unknown) => typeof value === 'string' && liveIdPattern.test(value) && !value.startsWith('sk-') ? value : null;
const jsonSuccess = (response: Response, payload: Record<string, unknown>) => {
  const status = payload.status ?? payload.status_code;
  return response.ok && payload.code === 'Success' && payload.success !== false && (status === undefined || status === 200);
};
function inferenceState(payload: Record<string, unknown>, model: InferenceModel) {
  const rows = asObject(payload.output).permissions;
  if (payload.success !== true || !Array.isArray(rows)) return null;
  const entries = rows.map(asObject);
  if (entries.some(entry => typeof (entry.model_id ?? entry.model) !== 'string')) return null;
  const matches = entries.filter(entry => (entry.model_id ?? entry.model) === model);
  if (matches.length > 1) return null;
  const inference = asObject(matches[0]?.permissions).inference;
  if (inference !== undefined && typeof inference !== 'boolean') return null;
  return matches.length === 1 && inference !== false;
}
const uncertainWrites = new Set<LiveOperation>(['create_v2', 'addFile', 'job/create', 'permissions_grant', 'permissions_restore', 'delete', 'deleteFile', 'delete_file']);
const permissionChangeAllowed = (scope: ReturnType<typeof readLiveApproval>) => scope.allowModelPermissionChanges
  && scope.reserveMicrosCny.permissions_grant !== undefined && scope.reserveMicrosCny.permissions_restore !== undefined;

type LiveOptions = { env?: LiveEnv; ledgerRoot?: string; fetcher?: typeof fetch; now?: () => number };

/** Acceptance transport. Always sends production adapter calls to the dedicated
 * workspace. Captures receipts without headers, credentials or signed URLs. */
export class LiveBailianAcceptance {
  readonly workspace: string;
  readonly client: BailianKnowledgeProvider;
  readonly model: TextModelGateway;
  readonly receipts: Array<Record<string, unknown>> = [];
  readonly budgetRefusals: Array<{ operation: LiveOperation; reason: string }> = [];
  readonly modelResults: Array<Record<string, unknown>> = [];
  private readonly originalFetch = globalThis.fetch;
  private readonly origin: string;
  private readonly key: string;
  private readonly embeddingOrigin: string;
  private readonly leases = new Map<string, { url: string; bytes: number; put: 'available' | 'reserved' | 'uploaded'; registered: boolean }>();
  private readonly documents = new Set<string>();
  private missingModels: InferenceModel[] | null = null;
  private readonly rentals: Array<{ indexId: string; createdAt: number; deletedAt: number }> = [];
  private lastRetrieve = 0;
  private nextFault: 'transport' | 'gateway' | 'denied' | null = null;
  private installed = false;
  private previousProviderEnv: { workspace?: string; key?: string } | null = null;
  stopEmbedding = false;

  static open(receiptFile: string, changePermissions: boolean, options: LiveOptions = {}) {
    const env = options.env ?? process.env;
    const scope = readLiveApproval(env, options.now?.());
    assert.ok(!changePermissions || permissionChangeAllowed(scope), 'Model permission writes require independent batch authorization');
    const ledger = LiveLedger.open(scope, options.ledgerRoot, options.now);
    try {
      ledger.checkCapacity(['list', 'permissions_read', 'permissions_read']);
      return new LiveBailianAcceptance(receiptFile, ledger, scope.workspace, changePermissions, env, options.fetcher ?? globalThis.fetch);
    } catch (error) { ledger.close(); throw error; }
  }

  private constructor(private readonly receiptFile: string, private readonly ledger: LiveLedger, workspace: string,
    private readonly changePermissions: boolean, env: LiveEnv, private readonly nativeFetch: typeof fetch) {
    this.workspace = workspace;
    this.key = env.XIAOK_I7515_LIVE_API_KEY?.trim() ?? '';
    assert.ok(/^sk-[a-zA-Z0-9_-]+$/.test(this.key), 'Dedicated workspace key missing');
    const embeddingUrl = env.ASSISTANT_EMBEDDING_URL ?? '';
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(embeddingUrl), 'Use the isolated loopback embedding service');
    this.origin = 'https://' + this.workspace + '.cn-beijing.maas.aliyuncs.com';
    this.embeddingOrigin = new URL(embeddingUrl).origin;
    this.client = new BailianKnowledgeProvider({ workspaceId: this.workspace, apiKey: this.key, model: BAILIAN_KNOWLEDGE_MODEL, category: 'default' }, this.fetch);
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
      workspace: this.workspace, batchBudget: this.budget(), budgetRefusals: this.budgetRefusals,
      receipts: this.receipts, modelResults: this.modelResults, rentals: this.rentals,
    }, (_key, value) => typeof value === 'string' ? value.replaceAll(this.key, '[REDACTED]') : value, 2) + '\n');
  }

  private readonly fetch: typeof fetch = (input, init) => this.dispatch(input, init);

  private confirmed(op: LiveOperation) {
    return this.ledger.attempts.filter(a => a.operation === op && a.status === 'received' && a.requestId);
  }

  private async dispatch(input: Parameters<typeof fetch>[0], init?: RequestInit, permissionWrite?: PermissionWrite) {
    assert.ok(this.installed && !(input instanceof Request), 'Live acceptance transport is not installed or the request is unsupported');
    this.ledger.assertActive();
    const url = new URL(input.toString()), method = init?.method ?? 'GET';
    assert.ok(!url.username && !url.password && !url.hash, 'Unexpected URL in live acceptance');
    const route = method + ' ' + url.pathname;
    const ticket = method === 'PUT' ? [...this.leases.values()].find(lease => lease.url === url.href) : undefined;
    let operation: LiveOperation | undefined;
    if (url.origin === this.origin) {
      operation = routes.get(route);
      if (route === 'POST ' + permissions && this.changePermissions) operation = permissionWrite;
      assert.ok(new Headers(init?.headers).get('authorization') === 'Bearer ' + this.key, 'Unexpected workspace credential');
    } else if (url.origin === this.embeddingOrigin && !url.search) {
      if (route === 'POST /v1/embeddings') operation = 'embedding';
      if (route === 'POST /v1/chunks') operation = 'chunks';
      if (operation && this.stopEmbedding) throw new Error('acceptance_embedding_fault');
    } else if (ticket) operation = 'oss_put';
    assert.ok(operation, 'Destination or operation not allowed in live acceptance');
    assert.ok(this.missingModels?.length === 0 || ['list', 'permissions_read', 'permissions_grant', 'permissions_restore', 'delete', 'deleteFile'].includes(operation),
      'Read-only Workspace and model preflight must pass before live work');
    const encoded = typeof init?.body === 'string' ? init.body : '';
    const body = encoded ? asObject(JSON.parse(encoded)) : {};
    const target: LiveAttempt['target'] = {};
    const indexId = id(body.index_id ?? body.indexId ?? url.searchParams.get('index_id'));
    const fileId = id(body.fileId ?? (Array.isArray(body.docIds) ? body.docIds[0] : undefined));
    const permissionRead = operation === 'permissions_read' ? liveModels.find(model => model === url.searchParams.get('model')) : undefined;
    if (operation === 'permissions_read') {
      assert.ok(permissionRead && url.searchParams.size === 3 && url.searchParams.get('authorization_scope') === 'AUTHORIZED'
        && url.searchParams.get('action') === 'INFERENCE', 'Unexpected model permission lookup');
      target.models = [permissionRead];
    }

    if (['job/create', 'job/status', 'files', 'chunklist', 'retrieve', 'delete', 'delete_file'].includes(operation)) {
      assert.ok(indexId && this.confirmed('create_v2').some(a => a.confirmedId === indexId), 'Index has no verified receipt in this batch');
      target.indexId = indexId;
    }
    if (['describeFile', 'create_v2', 'job/create', 'deleteFile'].includes(operation)) {
      assert.ok(fileId && this.confirmed('addFile').some(a => a.confirmedId === fileId), 'File has no verified receipt in this batch');
      target.fileId = fileId;
    }
    if (operation === 'delete_file') {
      assert.ok(Array.isArray(body.doc_ids) && body.doc_ids.length === 1 && this.documents.has(JSON.stringify([indexId, body.doc_ids[0]])),
        'Document has no verified receipt in this batch');
    }
    if (operation === 'create_v2' || operation === 'job/create') {
      assert.ok(Array.isArray(body.docIds) && body.docIds.length === 1, 'Use a single synthetic file per indexing request');
      if (operation === 'create_v2') {
        assert.ok(body.sinkType === 'BUILT_IN' && body.embeddingModelName === BAILIAN_KNOWLEDGE_MODEL
          && typeof body.name === 'string' && liveIndexName.test(body.name), 'Use a standard synthetic knowledge base');
        target.name = body.name;
      }
    }
    let uploadBytes = 0;
    if (operation === 'applyFileUploadLease') {
      uploadBytes = Number(body.sizeBytes);
      assert.ok(Number.isInteger(uploadBytes) && uploadBytes > 0 && uploadBytes <= 2048 && body.category === 'default', 'Synthetic upload size or category invalid');
    }
    const register = operation === 'addFile' ? this.leases.get(id(body.leaseId) ?? '') : undefined;
    if (operation === 'addFile') {
      const tag = id(Array.isArray(body.tags) && body.tags.length === 1 ? body.tags[0] : null);
      assert.ok(register?.put === 'uploaded' && !register.registered && tag && body.category === 'default', 'Registration lacks a batch upload lease');
      target.tag = tag;
    }
    if (operation === 'oss_put') {
      assert.ok(ticket?.put === 'available' && init?.body instanceof Uint8Array && init.body.byteLength === ticket.bytes,
        'Signed upload does not match an unused batch lease');
    }
    if (permissionWrite) {
      assert.ok(Array.isArray(body.models) && body.models.length > 0 && body.models.length <= liveModels.length);
      target.models = body.models.map(entry => {
        const row = asObject(entry);
        assert.ok(liveModels.includes(row.model as InferenceModel) && row.inference === (permissionWrite === 'permissions_grant'));
        return row.model as InferenceModel;
      });
    }
    if (operation === 'responses') {
      assert.ok(body.model === deepseek && body.store === false && body.tools === undefined && body.stream === undefined
        && body.previous_response_id === undefined && Number.isInteger(body.max_output_tokens) && Number(body.max_output_tokens) >= 1
        && Number(body.max_output_tokens) <= 512 && Buffer.byteLength(encoded) <= 16_384, 'Responses request exceeds fixed acceptance scope');
    }
    if (operation === 'retrieve') {
      assert.ok(typeof body.query === 'string' && Buffer.byteLength(body.query) <= 2048 && Number.isInteger(body.top_k)
        && Number(body.top_k) > 0 && Number(body.top_k) <= 50, 'Retrieval request exceeds fixed acceptance scope');
      const fault = this.nextFault;
      this.nextFault = null;
      if (fault) {
        this.receipts.push({ operation, indexId, provider: BAILIAN_RAG, model: BAILIAN_KNOWLEDGE_MODEL, simulatedFault: fault });
        if (fault === 'transport') throw new Error('acceptance_bailian_transport_fault');
        const status = fault === 'gateway' ? 503 : 403;
        return Response.json({ code: 'AcceptanceInjectedFault' }, { status });
      }
      this.lastRetrieve = Math.max(Date.now(), this.lastRetrieve + 1100);
      if (this.lastRetrieve > Date.now()) await delay(this.lastRetrieve - Date.now());
    }

    let sequence: number;
    try { sequence = this.ledger.reserve(operation, target); }
    catch (error) {
      this.budgetRefusals.push({ operation, reason: error instanceof Error ? error.message : 'Unknown ledger refusal' });
      this.save();
      throw error;
    }
    if (ticket && operation === 'oss_put') ticket.put = 'reserved';
    if (register && operation === 'addFile') register.registered = true;
    const receipt: Record<string, unknown> = { sequence, at: new Date().toISOString(), operation, method, ...target,
      status: 'reserved', requestId: null, estimatedYuan: null };
    this.receipts.push(receipt);
    let requestId: string | null = null, confirmedId: string | null = null;
    let status: 'received' | 'failed' | 'unknown' = 'unknown';
    let inference: boolean | undefined;
    try {
      this.save();
      this.ledger.assertActive();
      const response = await this.nativeFetch(url, { ...init, redirect: 'error' });
      const opaque = ['oss_put', 'embedding', 'chunks'].includes(operation);
      const payload = opaque ? {} : asObject(await response.clone().json().catch(() => null));
      const data = asObject(payload.data), error = asObject(payload.error);
      const usage = asObject(payload.usage ?? data.usage);
      const tokens = usage.input_tokens ?? usage.prompt_tokens, output = usage.output_tokens ?? usage.completion_tokens;
      requestId = id(payload.requestId ?? payload.request_id) ?? id(response.headers.get('x-request-id'))
        ?? id(response.headers.get('x-dashscope-request-id')) ?? id(response.headers.get('x-oss-request-id'));
      if (permissionRead && response.ok) {
        const current = inferenceState(payload, permissionRead);
        assert.ok(requestId && current !== null, 'Missing or malformed model permissions readback');
        inference = current;
      }
      const success = operation === 'delete' || permissionWrite ? response.ok && payload.success === true : jsonSuccess(response, payload);
      if (operation === 'create_v2' && success && (data.id == null || data.pipelineId == null || data.id === data.pipelineId))
        confirmedId = id(data.id ?? data.pipelineId);
      if (operation === 'addFile' && success) confirmedId = id(data.fileId);
      if (operation === 'job/create' && success && data.pipelineId === indexId) confirmedId = id(data.ingestionId);
      const responseWorkspace = data.workspaceId ?? data.workspace_id;
      const bound = (!['create_v2', 'addFile', 'job/create'].includes(operation) || confirmedId !== null)
        && (responseWorkspace === undefined || responseWorkspace === this.workspace);
      const knownRefusal = operation === 'delete' && payload.code === 'Index.IndexStatusError'
        || response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status);
      status = uncertainWrites.has(operation)
        ? success && bound && requestId ? 'received' : knownRefusal ? 'failed' : 'unknown'
        : response.ok ? 'received' : 'failed';
      if (status !== 'received') confirmedId = null;
      Object.assign(receipt, {
        httpStatus: response.status, providerCode: id(payload.code ?? error.code),
        usage: typeof tokens === 'number' ? { inputTokens: tokens, outputTokens: typeof output === 'number' ? output : null } : null,
        providerStatus: id(data.status ?? data.ingestion_status), total: Number.isSafeInteger(data.total_count ?? data.total) ? data.total_count ?? data.total : null,
      });
      if (operation === 'applyFileUploadLease' && success) this.bindLease(data, uploadBytes);
      if (operation === 'oss_put' && response.ok && ticket) ticket.put = 'uploaded';
      if (operation === 'files' && success && indexId) this.bindDocuments(indexId, data.rows);
      if (success && uncertainWrites.has(operation) && status === 'unknown') throw Error('Bailian write lacks a verified batch receipt');
      return response;
    } catch (error) {
      status = 'unknown';
      confirmedId = null;
      inference = undefined;
      throw error;
    } finally {
      this.ledger.finish(sequence, { status, requestId, confirmedId, inference });
      Object.assign(receipt, { status, requestId, confirmedId, inference });
      this.save();
    }
  };

  private bindLease(data: Record<string, unknown>, bytes: number) {
    const params = asObject(data.param), lease = id(data.leaseId);
    const url = new URL(String(params.url));
    assert.ok(lease && !this.leases.has(lease) && ![...this.leases.values()].some(a => a.url === url.href)
      && data.type === 'OSS.PreSignedUrl' && params.method === 'PUT' && url.protocol === 'https:'
      && !url.username && !url.password && !url.port && !url.hash && /\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname),
    'Invalid batch upload lease');
    this.leases.set(lease, { url: url.href, bytes, put: 'available', registered: false });
  }

  private bindDocuments(indexId: string, rows: unknown) {
    if (!Array.isArray(rows)) return;
    const files = [...this.confirmed('create_v2').filter(a => a.confirmedId === indexId),
      ...this.confirmed('job/create').filter(a => a.target.indexId === indexId)].map(a => a.target.fileId);
    for (const item of rows) {
      const row = asObject(item), documentId = id(row.doc_id);
      if (!documentId || !Array.isArray(row.tags)) continue;
      const tags = row.tags;
      if (this.confirmed('addFile').some(a => a.confirmedId && files.includes(a.confirmedId) && tags.includes(a.target.tag)
        && (documentId === a.confirmedId || documentId.startsWith(a.confirmedId + '_')))) {
        this.documents.add(JSON.stringify([indexId, documentId]));
      }
    }
  }

  budget() { return this.ledger.summary(); }

  count(operation: string) {
    return this.receipts.filter(item => item.operation === operation && !item.simulatedFault).length;
  }

  fault(kind: 'transport' | 'gateway' | 'denied') { this.nextFault = kind; }

  private async request(path: string, body?: object, pendingCode?: string, permissionWrite?: PermissionWrite) {
    const response = await this.dispatch(new URL(path, this.origin), {
      method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12_000),
    }, permissionWrite);
    const data = asObject(await response.json());
    if (pendingCode && data.code === pendingCode) return data;
    assert.ok(response.ok && data.success === true, 'Bailian operation rejected: ' + path);
    return data;
  }

  private async inference(model: InferenceModel) {
    const path = permissions + '?authorization_scope=AUTHORIZED&action=INFERENCE&model=' + model;
    const value = inferenceState(await this.request(path), model);
    assert.ok(value !== null, 'Malformed model permissions readback');
    return value;
  }

  async start() {
    this.ledger.assertActive();
    assert.ok(!this.installed && globalThis.fetch === this.originalFetch, 'Live acceptance transport already in use');
    this.previousProviderEnv = { workspace: process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID, key: process.env.ASSISTANT_BAILIAN_RAG_API_KEY };
    this.installed = true;
    globalThis.fetch = this.fetch;
    process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID = this.workspace;
    process.env.ASSISTANT_BAILIAN_RAG_API_KEY = this.key;
    const listing = await this.client.listIndices();
    assert.deepEqual(listing.value, [], 'Use an empty dedicated RAG workspace');
    assert.ok(listing.requestId, 'Missing Workspace preflight receipt');
    assert.ok(!this.unresolvedPermissionWrite() && !this.outstandingGrants().size, 'Prior batch permission changes must be reconciled or restored');
    const missing: InferenceModel[] = [];
    for (const model of liveModels) if (!await this.inference(model)) missing.push(model);
    this.missingModels = missing;
    return { requestId: listing.requestId, missingModels: [...missing] };
  }

  private async changeInference(models: InferenceModel[], write: PermissionWrite) {
    assert.ok(this.changePermissions, 'Model permission changes require --allow-model-permission-changes and separate authorization');
    const inference = write === 'permissions_grant';
    await this.request(permissions, { models: models.map(model => ({ model, inference })) }, undefined, write);
    for (const model of models) assert.equal(await this.inference(model), inference, 'Model permission readback differs from the confirmed change');
  }

  async enableMissingInference() {
    assert.ok(this.missingModels?.length && !this.unresolvedPermissionWrite() && !this.outstandingGrants().size, 'No verified missing inference permissions to enable');
    assert.ok(this.changePermissions, 'Model permission changes require --allow-model-permission-changes and separate authorization');
    const reads = this.missingModels.map(() => 'permissions_read' as const);
    this.ledger.checkCapacity(['permissions_grant', ...reads, 'permissions_restore', ...reads]);
    await this.changeInference(this.missingModels, 'permissions_grant');
    this.missingModels = [];
  }

  private outstandingGrants() {
    const models = new Map<InferenceModel, 'granted' | 'verify_restore'>();
    for (const a of this.ledger.attempts) if (a.status === 'received' && a.requestId) {
      for (const model of a.target.models ?? []) {
        if (a.operation === 'permissions_grant') models.set(model, 'granted');
        if (a.operation === 'permissions_restore' && models.has(model)) models.set(model, 'verify_restore');
        if (a.operation === 'permissions_read' && a.inference === false && models.get(model) === 'verify_restore') models.delete(model);
      }
    }
    return models;
  }

  private unresolvedPermissionWrite() {
    return this.ledger.attempts.some(a => (a.operation === 'permissions_grant' || a.operation === 'permissions_restore')
      && (a.status === 'reserved' || a.status === 'unknown'));
  }

  async cleanup() {
    if (!this.installed) return { status: 'not_run' };
    const errors: unknown[] = [];
    try {
      const owned = this.confirmed('create_v2');
      if (owned.length) {
        for (const item of (await this.client.listIndices()).value) {
          const created = owned.find(a => a.confirmedId === item.id);
          if (!created) continue;
          try {
            assert.equal(item.name, created.target.name, 'Knowledge base name differs from the verified create receipt');
            let removed = false;
            for (let attempt = 0; attempt < 7; attempt++) {
              const result = await this.request(index + 'delete', { index_id: item.id }, 'Index.IndexStatusError');
              if (result.success === true) { removed = true; break; }
              if (attempt < 6) await delay(10_000);
            }
            assert.ok(removed, 'The temporary knowledge base is still provisioning: ' + item.id);
            this.rentals.push({ indexId: item.id, createdAt: created.at, deletedAt: Date.now() });
          } catch (error) { errors.push(error); }
        }
        const remaining = (await this.client.listIndices()).value.filter(item => owned.some(a => a.confirmedId === item.id));
        assert.deepEqual(remaining, [], 'Verified temporary knowledge bases remain');
      }
    } catch (error) { errors.push(error); }
    const deletedFiles = new Set(this.confirmed('deleteFile').map(a => a.target.fileId));
    for (const { confirmedId } of this.confirmed('addFile')) if (confirmedId && !deletedFiles.has(confirmedId)) {
      try {
        await this.client.deleteFile(confirmedId);
        deletedFiles.add(confirmedId);
      } catch (error) { errors.push(error); }
    }
    const grants = this.outstandingGrants();
    try {
      if (grants.size && !this.unresolvedPermissionWrite()) {
        const toRestore = [...grants.keys()].filter(model => grants.get(model) === 'granted');
        if (toRestore.length) await this.changeInference(toRestore, 'permissions_restore');
        for (const [model, state] of grants) if (state === 'verify_restore') {
          assert.equal(await this.inference(model), false, 'Previously acknowledged model permission restore is unverified');
        }
      }
      if (this.budget().unresolvedAttempts.some(a => uncertainWrites.has(a.operation))) {
        errors.push(Error('Unconfirmed Bailian writes require reconciliation; unverified resources were not deleted'));
      }
    } catch (error) { errors.push(error); }
    finally { this.uninstall(); this.save(); }
    if (errors.length) throw new AggregateError(errors, 'Bailian test cleanup incomplete');
    return { temporaryIndicesDeleted: this.rentals.length, registeredFilesDeleted: deletedFiles.size,
      modelPermissionsRestored: [...grants.keys()] };
  }

  private uninstall() {
    if (this.installed) {
      this.installed = false;
      globalThis.fetch = this.originalFetch;
      const env = this.previousProviderEnv!;
      if (env.workspace === undefined) delete process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID;
      else process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID = env.workspace;
      if (env.key === undefined) delete process.env.ASSISTANT_BAILIAN_RAG_API_KEY;
      else process.env.ASSISTANT_BAILIAN_RAG_API_KEY = env.key;
    }
  }

  close() {
    this.uninstall();
    this.ledger.close();
  }
}
