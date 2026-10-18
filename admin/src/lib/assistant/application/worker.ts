import { withTenantTransaction } from '@/db/transaction';
import { runContext, type Lease } from '../infrastructure/job-queue';
import { processAnswer } from '../infrastructure/answer-worker';
import { processSiteRecord } from '@/lib/construction/site-worker';

/** Application assembly chooses a domain processor; the job/lease core stays domain-neutral. */
export async function processAssistantRun(lease: Lease) {
  // A revoked lease is handled by each processor's existing failure path.
  let site = false;
  try { site = await withTenantTransaction(lease.enterpriseId, async tx => (await runContext(tx, lease)).run.purpose === 'site.record'); }
  catch { /* The ordinary processor records the failed authorization without invoking a model. */ }
  if (site) await processSiteRecord(lease);
  else await processAnswer(lease);
}
