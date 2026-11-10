/** Read-only: does a run's final draft cite only catalog IDs? */
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { businessSynthesisSources } from '@/lib/assistant/agent/synthesis';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';

loadEnvConfig(process.cwd(), true);
const eid = '1454';
const runId = process.argv[2] || '2733';
const stepOf = (seq: number) => withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
  where enterprise_id=${eid} and run_id=${runId} and step_seq=${seq}`));
async function main() {
  const checkpoint = (await stepOf(1000))?.private_checkpoint as Row;
  const messages = (checkpoint?.messages as Array<Row>) || [];
  const packet = [...messages].reverse().find(message => message.role === 'tool' && String(message.content).includes('"reportReference"'));
  const snapshot = JSON.parse(String(packet!.content)) as Row;
  const sources = businessSynthesisSources(String(snapshot.resultKey || runId + ':1:0'), snapshot as never);
  const catalog = sources.flatMap(sourceCitationCatalog);
  console.log('CATALOG', catalog.length, catalog.slice(0, 3).map(c => c.citationId));
  const model = (await stepOf(1120))?.private_checkpoint as Row;
  const raw = String((model?.output as Row)?.text || '');
  const ids = [...raw.matchAll(/"citationId":\s*"([^"]+)"/g)].map(match => match[1]);
  for (const id of ids) console.log(id, catalog.some(c => c.citationId === id) ? 'valid' : 'MISSING');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
