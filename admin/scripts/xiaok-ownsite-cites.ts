import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { businessSynthesisSources } from '@/lib/assistant/agent/synthesis';
import { modelCitationCatalog, sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import type { BusinessSnapshot } from '@/lib/assistant/agent/business-tools';

loadEnvConfig(process.cwd(), true);
const eid = '1454';
async function main() {
  const toolStep = await withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
    where enterprise_id=${eid} and run_id='2703' and step_seq=1210`));
  const snapshot = (toolStep?.private_checkpoint ?? {}) as BusinessSnapshot;
  const sources = businessSynthesisSources('report:2703', snapshot);
  for (const s of sources) {
    const model = modelCitationCatalog(s) as Array<Row>;
    const plain = sourceCitationCatalog(s) as Array<Row>;
    const ids = [...model, ...plain].map(c => String(c.citationId ?? c.id ?? ''));
    console.log(JSON.stringify({ sourceId: s.sourceId, kind: s.reportScope?.kind, ids,
      has2248: s.text.includes('22:48'), text: s.text.slice(0, 220) }));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
