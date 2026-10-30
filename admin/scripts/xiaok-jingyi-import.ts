/** User-selected development knowledge; resumable original-key writes only. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { authorizeKnowledgeManager } from '@/lib/assistant/knowledge/manager';
import { parseSourceFile } from '@/lib/assistant/knowledge/source-file';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { readOriginal } from '@/lib/assistant/knowledge/file-service';
import type { SourceFile } from '@/lib/assistant/contracts/source-file';

type ImportedPart = {page:number;derivativeHash:string;reviewed:boolean;keys:Record<string,string>;documentId?:string;versionId?:string;
  parseJobId?:string;indexJobId?:string;status?:string;originalReadbackVerified?:boolean;blocks?:number;chunks?:number};
type ImportReport = {enterpriseId:string;enterpriseName:unknown;sourceHash:string;sourcePath:string;startedAt:string;scope:string;
  parts:ImportedPart[];completedAt?:string;status?:string};

loadEnvConfig(process.cwd(), true);
const eid = '1454', adminId = '16';
const originalHash = 'efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b';
async function main() {
  const output = path.resolve('../tmp/v1-01-weiyun-jingyi'); fs.mkdirSync(output, { recursive: true });
  if (process.argv.includes('--parse-check')) {
    const prepared = JSON.parse(fs.readFileSync(path.join(output, 'prepared.json'), 'utf8'));
    const results = [];
    for (const part of prepared.parts) {
      const bytes = fs.readFileSync(part.path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256);
      const parsed = await parseSourceFile(bytes, 'pdf');
      assert.equal(parsed.pages, 1);
      results.push({ page: part.page, blocks: parsed.blocks.length, chars: parsed.blocks.reduce((n, b) => n + b.text.length, 0), parser: parsed.parser });
      fs.writeFileSync(path.join(output, 'searchable', `${String(part.page).padStart(2, '0')}.parsed.json`), JSON.stringify(parsed, null, 2));
    }
    fs.writeFileSync(path.join(output, 'parse-check-final.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ pages: results.length, blocks: results.reduce((n, r) => n + r.blocks, 0), maxBlocks: Math.max(...results.map(r => r.blocks)) }));
    return;
  }
  const database = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(database.hostname)
    && database.port === '5432' && database.pathname === '/smart_floor_planner', 'Approved development primary required');
  const enterprise = await withPlatformTransaction(tx => one(tx, sql`select id,name,code,status from app.enterprises where id=${eid}`));
  assert.ok(enterprise && /微云/.test(String(enterprise.name)), 'Verify the actual 微云 enterprise before importing');
  const state = await withTenantTransaction(eid, async tx => {
    await authorizeKnowledgeManager(tx, eid, adminId);
    return {
      documents: await rows(tx, sql`select d.id,d.title,d.audience,d.status,d.published_version_id,v.chunk_count,
        v.index_status from app.assistant_knowledge_documents d left join app.assistant_knowledge_versions v
        on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id where d.enterprise_id=${eid} order by d.id`),
      storage: await one(tx, sql`select count(*) assets,coalesce(sum(octet_length(data)),0) bytes from app.assistant_knowledge_assets where enterprise_id=${eid}`),
      settings: await one(tx, sql`select enabled,knowledge_epoch,active_index_profile_id from app.assistant_enterprise_settings where enterprise_id=${eid}`),
      activeJobs: await rows(tx, sql`select id,kind,status from app.assistant_jobs where enterprise_id=${eid} and status in ('queued','running')`),
    };
  });
  const before = path.join(output, 'enterprise-before.json');
  if (!fs.existsSync(before)) fs.writeFileSync(before, JSON.stringify({ enterprise, ...state }, null, 2));
  if (!process.argv.includes('--import')) { console.log(JSON.stringify({ enterprise,documents:state.documents.length,storage:state.storage,
    settings:state.settings,activeJobs:state.activeJobs.length,designated:state.documents.filter(d=>['404','405'].includes(String(d.id))) }, null, 2)); return; }
  const prepared = JSON.parse(fs.readFileSync(path.join(output, 'prepared.json'), 'utf8'));
  assert.equal(prepared.sha256, originalHash);
  assert.equal(createHash('sha256').update(fs.readFileSync(prepared.path)).digest('hex'), originalHash);
  assert.deepEqual(prepared.parts.map((p: Row) => p.page), Array.from({ length: 30 }, (_, i) => i + 1));
  const manifestPath = path.join(output, 'import.json');
  const report: ImportReport = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {
    enterpriseId: eid, enterpriseName: enterprise.name, sourceHash: originalHash, sourcePath: prepared.path,
    startedAt: new Date().toISOString(), scope: 'Approved development primary only; 30 page-preserving local OCR derivatives, reviewed construction pages29/30 published for local tests; remaining pages private drafts.', parts: [],
  };
  assert.equal(report.enterpriseId, eid); assert.equal(report.sourceHash, originalHash);
  const save = () => fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2));
  const service = new KnowledgeService({ enterpriseId: eid, adminId });
  const waitJob = async (jobId: string) => {
    const until = Date.now() + 180000;
    while (Date.now() < until) {
      const job = await service.execute('job', { jobId });
      if (job.status === 'succeeded') return;
      if (['failed', 'cancelled', 'indeterminate'].includes(String(job.status))) throw Error(`Retained job ${jobId}: ${job.status}/${job.last_error}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error(`Job ${jobId} pending; resume the original operation, never create a replacement blindly`);
  };
  for (const part of prepared.parts) {
    const bytes = fs.readFileSync(part.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256);
    assert.equal(part.originalImageUnchanged, true);
    let record = report.parts.find(p => p.page === part.page);
    if (!record) {
      record = { page: part.page, derivativeHash: part.sha256, reviewed: part.visuallyReviewedBusinessText,
        keys: Object.fromEntries(['create', 'review', 'index', 'publish'].map(k => [k, randomUUID()])) };
      report.parts.push(record); save();
    }
    assert.equal(record.derivativeHash, part.sha256, 'A changed derivative needs a separate explicit version');
    if (!record.documentId) {
      const matches = await withTenantTransaction(eid, tx => rows(tx, sql`select d.id from app.assistant_knowledge_documents d
        join app.assistant_knowledge_assets a on a.enterprise_id=d.enterprise_id and a.document_id=d.id
        where d.enterprise_id=${eid} and a.source_hash=${part.sha256} and d.status<>'retired'`));
      const receipt = await withTenantTransaction(eid, tx => one(tx, sql`select id from app.assistant_idempotency_records
        where enterprise_id=${eid} and principal_key=${'admin:' + adminId} and operation='knowledge:createFile' and key=${record!.keys.create}`));
      assert.ok(!matches.length || receipt, 'An independently imported duplicate requires reconciliation');
      const result = await service.execute('createFile', {
        title: `精艺 · 原PDF第${part.page}页${record.reviewed ? ' · 施工工艺（校对参考）' : ' · OCR待复核草稿'}`,
        category: '精艺原件 · 微云本地测试', audience: record.reviewed ? 'customer_public' : 'staff_internal',
        fileName: path.basename(part.path), fileBase64: bytes.toString('base64'),
        authorization: `用户2026-10-31指定用于微云本地测试。精艺.pdf原件SHA-256=${originalHash}，原PDF第${part.page}页。原扫描图像未改动；Windows中文OCR检索副本，${record.reviewed ? '工艺正文经扫描图校对，原件冲突值保留，仅为参考，不证明现场合格、国家标准或本企业承诺。' : '表格、数值及文字尚未全部校对，不发布为有效企业标准或当前报价。'}`,
      }, record.keys.create);
      record.documentId = String((result.document as Row).id); record.versionId = String((result.draft as Row).id);
      record.parseJobId = String(result.jobId); save();
    }
    assert.ok(record.parseJobId && record.documentId && record.versionId);
    await waitJob(record.parseJobId);
    let detail = await service.execute('detail', { documentId: record.documentId });
    let draft = (detail.versions as Row[]).find(v => String(v.id) === record!.versionId)!;
    assert.ok(draft && (draft.source_file as Row).parsed);
    if (record.reviewed) {
      if (!(draft.source_file as Row).review) {
        await service.execute('reviewFile', { documentId: record.documentId, versionId: record.versionId,
          expectedEditVersion: Number(draft.edit_version), acknowledgeWarnings: true, excludedBlockIds: [] }, record.keys.review);
        detail = await service.execute('detail', { documentId: record.documentId }); draft = (detail.versions as Row[])[0];
      }
      if (draft.index_status !== 'ready') {
        const indexed = await service.execute('index', { documentId: record.documentId, versionId: record.versionId,
          expectedEditVersion: Number(draft.edit_version) }, record.keys.index);
        record.indexJobId = String(indexed.jobId); save(); await waitJob(record.indexJobId);
        detail = await service.execute('detail', { documentId: record.documentId }); draft = (detail.versions as Row[])[0];
      }
      if (String((detail.document as Row).published_version_id) !== record.versionId) {
        await service.execute('publish', { documentId: record.documentId, versionId: record.versionId,
          expectedVersion: Number((detail.document as Row).version), expectedEditVersion: Number(draft.edit_version) }, record.keys.publish);
      }
    }
    const original = await readOriginal({ enterpriseId: eid, adminId }, record.documentId, record.versionId);
    assert.equal(createHash('sha256').update(original.data as Buffer).digest('hex'), part.sha256);
    record.status = record.reviewed ? 'published' : 'draft'; record.originalReadbackVerified = true;
    record.blocks = (draft.source_file as SourceFile).parsed!.blocks.length; record.chunks = Number(draft.chunk_count); save();
    console.log(JSON.stringify({ page: record.page, documentId: record.documentId, status: record.status, chunks: record.chunks }));
  }
  report.completedAt = new Date().toISOString(); report.status = 'complete'; save();
  console.log(JSON.stringify({ enterpriseId: eid, pages: report.parts.length, published: report.parts.filter(p => p.status === 'published').length, retainedDrafts: report.parts.filter(p => p.status === 'draft').length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closePostgresPool);
