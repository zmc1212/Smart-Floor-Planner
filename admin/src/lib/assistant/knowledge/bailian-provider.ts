import { createHash } from 'node:crypto';
import { AssistantError, fail } from '../contracts';
import type { ManagedDocument, ManagedKnowledgeProvider, ManagedReceipt, ManagedSlice, ManagedState } from './managed-provider';

const connector = '/api/v1/connector/dash/';
const index = '/api/v1/indices/rag/index/';
export const MANAGED_PAGE_SIZE = 50;
export const BAILIAN_KNOWLEDGE_MODEL = 'text-embedding-v4';
const SOURCE = 'DATA_CENTER_FILE';
const CATEGORY_TYPE = 'UNSTRUCTURED';
const remoteId = /^[a-zA-Z0-9_.:-]{1,240}$/;
const workspaceName = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function knowledgeProviderMode(): 'bailian' | 'local' {
  const mode = process.env.ASSISTANT_KNOWLEDGE_PROVIDER?.trim() || 'bailian';
  if (mode !== 'bailian' && mode !== 'local') fail('knowledge_provider_invalid', 503);
  return mode;
}
export function bailianKnowledgeConfig() {
  const workspaceId = process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID?.trim() ?? '';
  const apiKey = process.env.ASSISTANT_BAILIAN_RAG_API_KEY?.trim() ?? '';
  const category = process.env.ASSISTANT_BAILIAN_RAG_CATEGORY_ID?.trim() || 'default';
  const model = process.env.ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL?.trim() || BAILIAN_KNOWLEDGE_MODEL;
  if (!workspaceId || !apiKey) fail('bailian_knowledge_not_configured', 503);
  if (!workspaceName.test(workspaceId) || !remoteId.test(category)
    || !['text-embedding-v4', 'qwen3.7-text-embedding'].includes(model)) fail('bailian_knowledge_config_invalid', 503);
  return { workspaceId, apiKey, category, model };
}

export class BailianKnowledgeError extends AssistantError {
  constructor(readonly operation: string, readonly providerCode: string, readonly requestId: string | null,
    readonly httpStatus: number | null, readonly outcomeKnown: boolean, code = 'bailian_knowledge_request_failed') {
    super(code, 503);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function id(value: unknown) {
  return typeof value === 'string' && remoteId.test(value) ? value : null;
}
function requiredId(value: unknown) {
  const result = id(value);
  if (!result) fail('bailian_knowledge_response_invalid', 503);
  return result;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail('bailian_knowledge_response_invalid', 503);
  return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('bailian_knowledge_response_invalid', 503);
  return value;
}
function documents(value: unknown): ManagedDocument[] {
  return array(value).map(item => {
    const row = object(item);
    return { id: requiredId(row.doc_id), status: String(row.status ?? row.code ?? ''),
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => !!id(tag)) : [] };
  });
}
function slices(value: unknown): ManagedSlice[] {
  return array(value).flatMap(item => {
    const node = object(item), meta = object(node.metadata);
    const sliceId = id(meta._id), workspaceId = id(meta.workspace_id), indexId = id(meta.pipeline_id), documentId = id(meta.doc_id);
    if (!sliceId || !workspaceId || !indexId || !documentId || typeof node.text !== 'string' || !node.text.trim() || node.text.length > 24000
      || typeof node.score !== 'number' || !Number.isFinite(node.score)
      || meta.is_displayed_chunk_content === false || meta.is_displayed_chunk_content === 'false'
      || meta._chunk_status !== undefined && String(meta._chunk_status) !== '0') return [];
    const heading = typeof meta.hier_title === 'string' ? meta.hier_title : typeof meta.title === 'string' ? meta.title : '';
    return [{ id: sliceId, workspaceId, indexId, documentId, text: node.text, score: node.score,
      section: heading.split('|').map(value => value.trim().slice(0, 200)).filter(Boolean).slice(0, 8) }];
  });
}
async function readJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const buffers: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('bailian_response_limit');
      buffers.push(value);
    }
    return object(JSON.parse(Buffer.concat(buffers).toString('utf8')));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export class BailianKnowledgeProvider implements ManagedKnowledgeProvider {
  readonly workspaceId: string;
  readonly model: string;
  private readonly origin: string;
  constructor(private readonly config = bailianKnowledgeConfig(), private readonly fetcher: typeof fetch = fetch) {
    if (!workspaceName.test(config.workspaceId)) fail('bailian_knowledge_config_invalid', 503);
    this.workspaceId = config.workspaceId;
    this.model = config.model;
    this.origin = new URL('https://' + config.workspaceId + '.cn-beijing.maas.aliyuncs.com').origin;
  }

  private async request(path: string, data?: object, query?: Record<string, string>, signal?: AbortSignal) {
    const url = new URL(path, this.origin);
    if (query) url.search = new URLSearchParams(query).toString();
    const operation = path.slice(path.lastIndexOf('/') + 1);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: data ? 'POST' : 'GET', redirect: 'error', cache: 'no-store',
        headers: { authorization: 'Bearer ' + this.config.apiKey, 'content-type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      });
    } catch {
      throw new BailianKnowledgeError(operation, 'transport_error', null, null, false);
    }
    let envelope: Record<string, unknown>;
    try { envelope = await readJson(response); } catch { envelope = {}; }
    const requestId = id(envelope.request_id ?? envelope.requestId);
    const status = typeof envelope.status === 'number' ? envelope.status : envelope.status_code;
    if (!response.ok || envelope.code !== 'Success' || envelope.success === false || (status !== undefined && status !== 200)) {
      const businessStatus = typeof status === 'number' ? status : response.status;
      throw new BailianKnowledgeError(operation, id(envelope.code) ?? 'invalid_response', requestId, businessStatus,
        businessStatus >= 400 && businessStatus < 500 && ![408, 409].includes(businessStatus));
    }
    return { value: object(envelope.data), requestId };
  }

  async upload(file: { name: string; data: Buffer; tag: string }) {
    const { category } = this.config;
    const lease = await this.request(connector + 'applyFileUploadLease', {
      category, categoryType: CATEGORY_TYPE, fileName: file.name, sizeBytes: String(file.data.length),
      contentMd5: createHash('md5').update(new Uint8Array(file.data)).digest('base64'),
    });
    const params = object(lease.value.param), signed = object(params.headers);
    let url: URL;
    try { url = new URL(String(params.url)); } catch { return fail('bailian_upload_lease_invalid', 503); }
    if (lease.value.type !== 'OSS.PreSignedUrl' || params.method !== 'PUT' || url.protocol !== 'https:'
      || url.username || url.password || url.port || !/^[a-z0-9][a-z0-9.-]*\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname))
      fail('bailian_upload_lease_invalid', 503);
    const leaseId = requiredId(lease.value.leaseId);
    const headers = new Headers();
    for (const [name, value] of Object.entries(signed)) {
      if (typeof value !== 'string' || !/^(content-type|content-md5|x-bailian-extra|x-oss-[a-z0-9-]+)$/i.test(name))
        fail('bailian_upload_lease_invalid', 503);
      headers.set(name, value);
    }
    let uploaded: Response;
    try {
      uploaded = await this.fetcher(url, { method: 'PUT', headers, body: new Uint8Array(file.data),
        redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch { throw new BailianKnowledgeError('oss_put', 'transport_error', lease.requestId, null, false); }
    await uploaded.body?.cancel().catch(() => undefined);
    if (!uploaded.ok) throw new BailianKnowledgeError('oss_put', 'oss_rejected', lease.requestId, uploaded.status, uploaded.status < 500);
    const registered = await this.request(connector + 'addFile', {
      leaseId, category, categoryType: CATEGORY_TYPE, parser: 'AUTO_SELECT', tags: [file.tag],
    });
    return { value: requiredId(registered.value.fileId), requestId: registered.requestId };
  }

  async fileStatus(fileId: string): Promise<ManagedReceipt<ManagedState>> {
    const r = await this.request(connector + 'describeFile', { fileId });
    const status = r.value.status;
    if (r.value.fileId !== fileId) fail('bailian_knowledge_response_invalid', 503);
    return { value: status === 'PARSE_SUCCESS' ? 'ready' : status === 'INIT' || status === 'PARSING' ? 'pending' : 'failed', requestId: r.requestId };
  }

  async createIndex(name: string, fileId: string) {
    const r = await this.request(index + 'create_v2', {
      name, description: name, structureType: 'unstructured', knowledgeType: 'document', knowledgeScene: 'basic_document_qa',
      sinkType: 'BUILT_IN', sourceType: SOURCE, embeddingModelName: this.model, chunkSize: 800,
      docIds: [fileId], dataSources: [{ sourceType: SOURCE }],
    });
    return { value: requiredId(r.value.id), requestId: r.requestId };
  }

  async listIndices() {
    const r = await this.request(index + 'list', undefined, { page_number: '1', page_size: String(MANAGED_PAGE_SIZE) });
    return { value: array(r.value.rows).map(item => ({ id: requiredId(object(item).id), name: String(object(item).name ?? '') })), requestId: r.requestId };
  }

  async importDocument(indexId: string, fileId: string) {
    const r = await this.request(index + 'job/create', {
      indexId, sourceType: SOURCE, docIds: [fileId], chunkMode: 'length', chunkSize: 800, overlapSize: 120, enableHeaders: true,
    });
    if (r.value.pipelineId !== indexId) fail('bailian_knowledge_response_invalid', 503);
    return { value: requiredId(r.value.ingestionId), requestId: r.requestId };
  }

  async importStatus(indexId: string, jobId: string): Promise<ManagedReceipt<ManagedState>> {
    const r = await this.request('/api/v1/indices/rag/index_job/status', undefined, { index_id: indexId, job_id: jobId });
    if (r.value.id !== jobId) fail('bailian_knowledge_response_invalid', 503);
    const status = r.value.ingestion_status;
    return { value: status === 'COMPLETED' ? 'ready' : status === 'PENDING' || status === 'RUNNING' ? 'pending' : 'failed', requestId: r.requestId };
  }

  async listDocuments(indexId: string, page: number) {
    const r = await this.request(index + 'files', undefined, { index_id: indexId, page_number: String(page), page_size: String(MANAGED_PAGE_SIZE) });
    return { value: { documents: documents(r.value.rows), total: count(r.value.total_count) }, requestId: r.requestId };
  }

  async listSlices(indexId: string, documentId: string, page: number) {
    const r = await this.request(index + 'chunklist', { indexId, docId: documentId, pageNum: page, pageSize: MANAGED_PAGE_SIZE });
    if (r.value.isDowngrade === true) fail('retrieval_unavailable', 503);
    return { value: { slices: slices(r.value.nodes), total: count(r.value.total) }, requestId: r.requestId };
  }

  async retrieve(input: { indexId: string; tags: string[]; query: string; topK: number; signal?: AbortSignal }) {
    if (!input.tags.length) fail('context_changed');
    const r = await this.request(index + 'retrieve', {
      index_id: input.indexId, query: input.query, top_k: input.topK, search_filters: [{ tags: input.tags }],
    }, undefined, input.signal);
    if (r.value.isDowngrade === true) fail('retrieval_unavailable', 503);
    return { value: slices(r.value.nodes), requestId: r.requestId };
  }

  async deleteDocument(indexId: string, documentId: string) {
    const r = await this.request(index + 'delete_file', { index_id: indexId, doc_ids: [documentId] });
    return { value: Array.isArray(r.value.deleted) && r.value.deleted.includes(documentId), requestId: r.requestId };
  }

  async deleteFile(fileId: string) {
    const r = await this.request(connector + 'deleteFile', { fileId });
    return { value: undefined, requestId: r.requestId };
  }
}
