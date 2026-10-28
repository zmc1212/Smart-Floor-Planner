import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { parseSiteVersions } from '@/lib/construction/site-issues';
import { executePlanCommand, deliverPlans, PlanCustomerService, readPlan } from '@/lib/construction/site-plans';
import type { PlanView } from '@/lib/construction/site-plans';
import type { D4SharingFixture } from './assistant-d4-sharing-fixture';

/** Labelled engineering context for C01-only regressions. The original native
 * trials already exercised staff interpretation/uploads/confirmation/C05.
 * These real domain writes make no provider calls and are not regraded as
 * natural staff or native customer-decision acceptance. */
export async function prepareApprovedNaturalPlans(f: D4SharingFixture, issueId: string, input: { first: string; second: string; cost: number; days: number }) {
  const service = f.site(f.memberIds[0]), customer = new PlanCustomerService(f.actor, f.conversationId), plans: PlanView[] = [];
  for (const [index, original] of [input.first, input.second].entries()) {
    const media = await service.upload(f.projectId, randomUUID(), await sharp({ create: { width: 96, height: 72, channels: 3,
      background: index ? '#93acbf' : '#c9dfd0' } }).png().toBuffer());
    const versions = parseSiteVersions((await service.read(f.projectId)).versions);
    const published = await service.withWriteScope(f.projectId, async (tx, c, _p, permission) => {
      const message = await appendMessage(tx, service.actor, String(c.id), { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
        content: { version: 1, blocks: [{ type: 'text', text: original }] } });
      return executePlanCommand(tx, service.actor, f.projectId, String(message.id), { action: 'publish', issueId, title: '书房插座调整',
        difference: original, costDeltaCents: index ? 0 : input.cost, scheduleDeltaDays: index ? 0 : input.days }, [String(media.id)], versions, permission.manage);
    });
    await deliverPlans(); await customer.media(published.id);
    await customer.decide(published.id, 'preview', { expectedRevision: (await customer.read(published.id)).revision }, randomUUID());
    await customer.decide(published.id, 'approve', { expectedRevision: (await customer.read(published.id)).revision }, randomUUID());
    const result = await service.withWriteScope(f.projectId, async tx => (await readPlan(tx, f.eid, published.id))!);
    plans.push(result);
  }
  return { plans, providerCalls: 0, source: 'existing domain writers and customer services; engineering-only fixture' };
}
