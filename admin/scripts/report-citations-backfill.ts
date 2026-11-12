/** Deterministic, server-verified citation backfill for already saved report
 * versions. It never calls a model, never changes prose, and only fills empty
 * citations on the server-written sections when the exact fact span still
 * exists in the current authorization. Every added citation passes the same
 * resolver used by the save gate and the read projection.
 *
 * Usage (from admin/, against the isolated B database):
 *   $env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
 *   npx tsx scripts/report-citations-backfill.ts --development --enterprise-id 1454 `
 *     --report 9:2 --report 16:1 --report 17:1 --report 18:1 --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { assertB4ConnectionIdentity, describeB4DatabaseTarget, resolveB4DatabaseTarget } from '@/lib/native-workflow/live/dev-config';
import { projectReportFacts, type ReportFacts } from '@/lib/construction/report-scope';
import { attachReportFactCitations, assertReportBodyCitations, verifyReportCitation } from '@/lib/construction/report-citations';
import type { ReportBody } from '@/lib/construction/report-composition';

loadEnvConfig(process.cwd());

function failJson(payload: Record<string, unknown>): never {
  console.error(JSON.stringify({ success: false, ...payload }, null, 2));
  process.exit(1);
}
function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) failJson({ error: `${name} requires a value` });
  return value;
}
function positiveId(name: string, value: string | undefined): string {
  if (!value || !/^[1-9]\d{0,18}$/.test(value)) failJson({ error: `${name} must be a positive integer id` });
  return value;
}
function revisionSpecs(): Array<{ reportId: string; revision: number }> {
  const specs: Array<{ reportId: string; revision: number }> = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] !== '--report') continue;
    const raw = process.argv[index + 1];
    const match = raw && /^([1-9]\d{0,18}):([1-9]\d{0,8})$/.exec(raw);
    if (!match) failJson({ error: '--report must be <reportId>:<revision>' });
    specs.push({ reportId: match[1], revision: Number(match[2]) });
  }
  return [...new Map(specs.map(spec => [`${spec.reportId}:${spec.revision}`, spec])).values()];
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eid = positiveId('--enterprise-id', option('--enterprise-id'));
const specs = revisionSpecs();
if (!specs.length) failJson({ error: 'at least one --report <reportId>:<revision> is required' });
const apply = process.argv.includes('--apply');
const output = path.resolve(option('--output') || `tmp/b5-9-4-citations-${Date.now()}.json`);

const database = resolveB4DatabaseTarget({ purpose: 'app' });
process.env.DATABASE_URL = database.url;
const receipt: Record<string, unknown> = { capturedAt: new Date().toISOString(), database: describeB4DatabaseTarget(database),
  enterpriseId: eid, apply, reports: [] as unknown[], success: false };

async function backfill(reportId: string, revision: number) {
  return withTenantTransaction(eid, async tx => {
    const row = await one(tx, sql`select r.id,r.binding_id,v.revision,v.facts,v.generated_at,v.body,b.*
      from app.construction_reports r join app.construction_report_versions v
        on v.enterprise_id=r.enterprise_id and v.report_id=r.id
      join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      where r.enterprise_id=${eid} and r.id=${reportId} and v.revision=${revision}`);
    if (!row) return { reportId, revision, skipped: 'not_found' };
    if (!row.body) return { reportId, revision, skipped: 'body_missing' };
    const facts = await projectReportFacts(tx, eid, row, row.facts as ReportFacts, new Date(String(row.generated_at)));
    if (!facts.projects.length) return { reportId, revision, skipped: 'source_unavailable' };
    const body = structuredClone(row.body) as ReportBody;
    const projectList = body.projects.map(project => {
      const current = facts.projects.find(candidate => candidate.id === project.projectId);
      if (!current) failJson({ error: `report ${reportId}:${revision} project ${project.projectId} is not in the revalidated facts` });
      return { projectId: project.projectId, selection: project.selection, context: project.context, facts: current };
    });
    const before = body.projects.map(project => ({ projectId: project.projectId,
      citations: Object.values(project.sections).flatMap(section => section.segments.map(segment => segment.citations.length)) }));
    attachReportFactCitations(body, projectList);
    assertReportBodyCitations(body, projectList, row.audience as 'customer' | 'worker' | 'designer' | 'boss');
    const added = body.projects.flatMap(project => {
      const current = projectList.find(candidate => candidate.projectId === project.projectId)!;
      const original = before.find(item => item.projectId === project.projectId)?.citations || [];
      return Object.entries(project.sections).flatMap(([kind, section]) => section.segments.flatMap((segment, index) =>
        original[index]
          ? []
          : segment.citations.map(citation => ({ kind, index, text: segment.text, sourceId: citation.sourceId, quote: citation.quote,
            original: verifyReportCitation(current, citation) }))));
    });
    const changed = digest(row.body) !== digest(body);
    if (changed && apply) {
      await tx.execute(sql`update app.construction_report_versions set body=${JSON.stringify(body)}::jsonb
        where enterprise_id=${eid} and report_id=${reportId} and revision=${revision}`);
    }
    return { reportId, revision, audience: row.audience, bindingId: String(row.binding_id), changed, applied: changed && apply,
      beforeHash: digest(row.body), afterHash: digest(body), before, added };
  });
}

async function main() {
  const connected = await withTenantTransaction(eid, tx => one(tx, sql`select current_database() as database, current_user as username`));
  assertB4ConnectionIdentity(database, { database: String(connected?.database ?? ''), username: String(connected?.username ?? '') });
  for (const spec of specs) (receipt.reports as unknown[]).push(await backfill(spec.reportId, spec.revision));
  receipt.success = true;
}
main().then(async () => {
  receipt.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
  await closePostgresPool();
}, async error => {
  receipt.error = (error as Error).message;
  receipt.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2));
  console.error(error);
  await closePostgresPool();
  process.exitCode = 1;
});
