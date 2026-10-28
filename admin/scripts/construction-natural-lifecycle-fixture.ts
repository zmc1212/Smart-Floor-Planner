import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { executeSiteResolution, type ResolutionCommand } from '@/lib/construction/site-resolution';
import { prepareApprovedNaturalPlans } from './construction-natural-plans-fixture';
import { parseSiteVersions } from '@/lib/construction/site-issues';
import type { D4SharingFixture } from './assistant-d4-sharing-fixture';

/** Real labelled second-project record/issue for two-site management reads.
 * Zero-provider engineering setup, not natural staff/model acceptance. */
export async function prepareOtherManagementProject(f: D4SharingFixture) {
  const s = f.site(), pid = f.otherProjectId, read = await s.read(pid), room = (read.rooms as Row[]).find(r => r.name === '客厅')!;
  const bytes = await sharp({ create: { width: 96, height: 72, channels: 3, background: '#e4ded1' } }).png().toBuffer();
  const media = await s.upload(pid, randomUUID(), bytes);
  const sent = await s.send(pid, { text: '客厅门框今天还没固定，等待核对尺寸。', mediaIds: [String(media.id)] }, randomUUID());
  assert.ok(sent.recordId, 'Engineering context must create a real record before extraction');
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '测试专用 · 工地乙门框待核对', roomId: String(room.id), completed: '', pending: '门框尺寸待复核', coordination: '安装时间未定', note: '' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } }));
  const record = (await withTenantTransaction(f.eid, tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${f.eid} and id=${String(sent.recordId)}`)))!;
  await s.mutate(pid, String(sent.recordId), 'publish', { expectedVersion: Number(record.version), audience: 'internal' }, randomUUID());
  const opened = await s.send(pid, { text: '跟进记录' + sent.recordId + '：门框复核待分配。', mediaIds: [], versions: (await s.read(pid)).versions }, randomUUID());
  return { projectId: pid, recordId: String(sent.recordId), issueId: String(opened.issueId), providerCalls: 0, source: 'existing domain writers with zero-provider record fixture' };
}

/** Fresh actual closed context for answer-only regressions. Prior native trials
 * already checked every staff action. Never regrant their withdrawn source. */
export async function prepareClosedLifecycle(f: D4SharingFixture, issueId: string, input: { first: string; second: string; cost: number; days: number }, originals: boolean) {
  const plans = await prepareApprovedNaturalPlans(f, issueId, input), worker = f.site(f.memberIds[1]);
  const bytes = await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer();
  const media = await worker.upload(f.projectId, randomUUID(), bytes);
  const sent = await worker.send(f.projectId, { text: '书房右侧底盒今天已经固定，桌子摆位复核完成。', mediaIds: [String(media.id)] }, randomUUID());
  assert.ok(sent.recordId); const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '测试专用 · 闭环答复依据', roomId: f.roomId, completed: '按V2完成固定并复核', pending: '', coordination: '', note: '' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } }));
  const row = (await withTenantTransaction(f.eid, tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${f.eid} and id=${String(sent.recordId)}`)))!;
  const published = await f.site().mutate(f.projectId, String(sent.recordId), 'publish', { expectedVersion: Number(row.version), audience: 'internal' }, randomUUID());
  for (const action of ['implement', 'resolve', 'close'] as const) {
    const service = f.site(action === 'implement' ? f.memberIds[0] : f.ownerIds[0]), versions = parseSiteVersions((await service.read(f.projectId)).versions);
    await service.withWriteScope(f.projectId, async (tx, c, _p, permission) => {
      const original = action === 'implement' ? '书房已按同意的V2完成，登记本次落实依据。'
        : `请正式${action === 'resolve' ? '解决' : '关闭'}书房底盒。内部核对记录留在项目。给业主说：“书房底盒已按同意的V2落实，事项已正式${action === 'resolve' ? '解决，尚未关闭' : '关闭'}。”${originals ? '把本次落实照片原件也回传给业主' : '只回传文字'}。`;
      const message = await appendMessage(tx, service.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: original }] } });
      const cmd: ResolutionCommand = action === 'implement' ? { action, issueId, planId: plans.plans[1].id, recordId: String(sent.recordId), conclusion: original }
        : { action, issueId, conclusion: original, excerpt: `书房底盒已按同意的V2落实，事项已正式${action === 'resolve' ? '解决，尚未关闭' : '关闭'}。`, originals };
      return executeSiteResolution(tx, service.actor, f.projectId, String(message.id), cmd, versions, permission.manage);
    });
  }
  return { plans: plans.plans, recordId: String(sent.recordId), mediaId: String(media.id), recordVersion: Number(published.version), providerCalls: 0, source: 'original typed domain services, engineering-only context; no native staff regrading' };
}
