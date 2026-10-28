import { withTenantTransaction } from '@/db/transaction';
import { runContext, type Lease } from '../infrastructure/job-queue';
import { processAnswer } from '../infrastructure/answer-worker';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { processSiteAction } from '@/lib/construction/site-action-worker';

/** Application assembly chooses a domain processor; the job/lease core stays domain-neutral. */
export async function processAssistantRun(lease: Lease) {
  // A revoked lease is handled by each processor's existing failure path.
  let purpose = '';
  try { purpose = await withTenantTransaction(lease.enterpriseId, async tx => String((await runContext(tx, lease)).run.purpose)); }
  catch { /* The ordinary processor records the failed authorization without invoking a model. */ }
  if (purpose === 'site.record') await processSiteRecord(lease);
  else if (purpose === 'site.action') await processSiteAction(lease);
  else await processAnswer(lease);
}
