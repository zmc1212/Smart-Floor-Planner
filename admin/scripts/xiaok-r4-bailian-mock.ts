import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chineseTerms } from '@/lib/assistant/knowledge/chinese-lexical';
import { filePassages, parseSourceFile } from '@/lib/assistant/knowledge/source-file';
import type { SourceFile } from '@/lib/assistant/contracts/source-file';

type Slice = { text: string; score: number; metadata: { _id: string; doc_id: string; workspace_id: string; pipeline_id: string; hier_title: string } };
type File = { id: string; name: string; tag: string; statusReads: number; blocks: Array<{ text: string; section: string }> };

export const mockWorkspace = 'llm-r4-mock';
const mockKey = 'r4-synthetic-http-fixture';
const cloudHost = mockWorkspace + '.cn-beijing.maas.aliyuncs.com';
const ossHost = 'r4-fixture.oss-cn-beijing.aliyuncs.com';

export function mockBailianRag() {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const leases = new Map<string, { name: string; hash: string; size: string; bytes?: Buffer }>();
  const files = new Map<string, File>();
  const libraries = new Map<string, { name: string; documents: Set<string> }>();
  const ingestions = new Map<string, { indexId: string; polls: number }>();
  const intercept = { extraSlices: [] as Slice[], failNext: null as string | null, beforeRetrieve: null as null | (() => Promise<unknown>) };
  const getSlices = (indexId: string, fileId: string): Slice[] => {
    const file = files.get(fileId);
    if (!file || !libraries.get(indexId)?.documents.has(fileId)) return [];
    return file.blocks.map((block, i) => ({
      text: block.text, score: 0, metadata: { _id: indexId + '_' + fileId + '_' + i, doc_id: fileId,
        workspace_id: mockWorkspace, pipeline_id: indexId, hier_title: block.section },
    }));
  };
  function install() {
    const next = globalThis.fetch;
    process.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID = mockWorkspace;
    process.env.ASSISTANT_BAILIAN_RAG_API_KEY = mockKey;
    process.env.ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL = 'text-embedding-v4';
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== cloudHost && url.hostname !== ossHost) return next(input, init);
      assert.equal(init?.redirect, 'error');
      const headers = new Headers(init?.headers);
      if (url.hostname === ossHost) {
        const lease = leases.get(url.pathname.slice(1))!;
        assert.ok(lease);
        assert.equal(headers.has('authorization'), false);
        assert.equal(headers.get('x-bailian-extra'), 'signed-mock-header');
        assert.equal(init?.method, 'PUT');
        const bytes = Buffer.from(init.body as Uint8Array);
        assert.equal(String(bytes.length), lease.size);
        assert.equal(createHash('md5').update(new Uint8Array(bytes)).digest('base64'), lease.hash);
        lease.bytes = bytes;
        calls.push({ path: 'oss_put' });
        return new Response(null, { status: 200 });
      }
      assert.equal(headers.get('authorization'), 'Bearer ' + mockKey);
      const body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {};
      const operation = url.pathname.split('/').at(-1)!;
      const id = 'request-' + (calls.length + 1);
      const done = (data: unknown) => Response.json({ code: 'Success', success: true, status_code: 200, request_id: id, data });
      calls.push({ path: url.pathname, body });
      if (intercept.failNext === operation) {
        intercept.failNext = null;
        return Response.json({ code: 'AccessDenied', status: 403, request_id: id }, { status: 200 });
      }
      if (operation === 'applyFileUploadLease') {
        const leaseId = 'lease-' + leases.size;
        leases.set(leaseId, { name: String(body.fileName), hash: String(body.contentMd5), size: String(body.sizeBytes) });
        return done({ leaseId, type: 'OSS.PreSignedUrl', param: { method: 'PUT',
          url: 'https://' + ossHost + '/' + leaseId + '?signature=mock', headers: { 'x-bailian-extra': 'signed-mock-header' } } });
      }
      if (operation === 'addFile') {
        const lease = leases.get(String(body.leaseId))!;
        const format = lease.name.split('.').at(-1) as SourceFile['format'];
        assert.ok(lease.bytes);
        assert.equal(body.parser, 'AUTO_SELECT');
        const fileId = 'file-' + files.size + '-' + leases.size;
        const parsed = await parseSourceFile(lease.bytes, format);
        const blocks = filePassages({ version: 1, assetId: 'mock', hash: 'mock', name: lease.name, format, parsed, review: null })
          .map(p => ({ text: p.text, section: p.block.section.join('|') }));
        files.set(fileId, { id: fileId, name: lease.name, tag: String((body.tags as string[])[0]), blocks, statusReads: 0 });
        return done({ fileId });
      }
      if (operation === 'describeFile') {
        const file = files.get(String(body.fileId))!;
        return done({ fileId: file.id, status: file.statusReads++ ? 'PARSE_SUCCESS' : 'PARSING' });
      }
      if (operation === 'create_v2') {
        assert.equal(body.embeddingModelName, 'text-embedding-v4');
        assert.equal(body.sinkType, 'BUILT_IN');
        assert.equal(body.sourceType, 'DATA_CENTER_FILE');
        assert.equal((body.docIds as string[]).length, 1);
        const indexId = 'index-' + libraries.size;
        libraries.set(indexId, { name: String(body.name), documents: new Set(body.docIds as string[]) });
        return done({ id: indexId });
      }
      if (operation === 'list') return done({ rows: [...libraries].map(([id, library]) => ({ id, name: library.name })) });
      if (operation === 'create') {
        const indexId = String(body.indexId), docs = body.docIds as string[];
        assert.equal(body.sourceType, 'DATA_CENTER_FILE');
        assert.equal(docs.length, 1);
        libraries.get(indexId)!.documents.add(docs[0]);
        const ingestionId = 'import-' + ingestions.size;
        ingestions.set(ingestionId, { indexId, polls: 0 });
        return done({ ingestionId, pipelineId: indexId, status: 'PENDING' });
      }
      if (operation === 'status') {
        const id = url.searchParams.get('job_id')!, state = ingestions.get(id)!;
        assert.equal(state.indexId, url.searchParams.get('index_id'));
        return done({ id, ingestion_status: state.polls++ ? 'COMPLETED' : 'RUNNING' });
      }
      if (operation === 'files') {
        const library = libraries.get(url.searchParams.get('index_id')!)!;
        const rows = [...library.documents].map(id => ({ doc_id: id, status: 'FINISH', tags: [files.get(id)?.tag] }));
        return done({ rows, total_count: rows.length });
      }
      if (operation === 'chunklist') {
        const slices = getSlices(String(body.indexId), String(body.docId));
        return done({ nodes: slices, total: slices.length, isDowngrade: false });
      }
      if (operation === 'retrieve') {
        await intercept.beforeRetrieve?.();
        const indexId = String(body.index_id), tags = (body.search_filters as Array<{ tags: string[] }>)[0].tags;
        const terms = new Set(chineseTerms(String(body.query)));
        const nodes = [...libraries.get(indexId)!.documents].filter(id => tags.includes(files.get(id)!.tag))
          .flatMap(id => getSlices(indexId, id)).map(node => ({ ...node,
            score: Math.min(1, chineseTerms(node.text).filter(term => terms.has(term)).length / 10) }))
          .filter(node => node.score > 0).sort((a, b) => b.score - a.score).slice(0, Number(body.top_k));
        return done({ nodes: [...intercept.extraSlices, ...nodes], isDowngrade: false });
      }
      if (operation === 'delete_file') {
        const library = libraries.get(String(body.index_id))!, ids = body.doc_ids as string[];
        assert.equal(ids.length, 1);
        library.documents.delete(ids[0]);
        // Some successful deletions return an empty deleted array.
        return done({ deleted: [] });
      }
      if (operation === 'deleteFile') {
        files.delete(String(body.fileId));
        return done({});
      }
      throw new Error('Unexpected mock request ' + url.pathname);
    };
    return () => { globalThis.fetch = next; };
  }
  return { install, calls, getSlices, intercept, libraries, files };
}
