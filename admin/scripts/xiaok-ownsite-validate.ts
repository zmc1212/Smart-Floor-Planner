import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { businessSynthesisSources, parseSynthesis } from '@/lib/assistant/agent/synthesis';
import { reportAnswerSynthesis, reportQuestionCoverage } from '@/lib/assistant/agent/report-final';
import type { BusinessSnapshot } from '@/lib/assistant/agent/business-tools';

loadEnvConfig(process.cwd(), true);
const eid = '1454';
const question = '我家现在施工到哪一步了？最近工地上都做了些什么？';
async function main() {
  const rawStep = await withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
    where enterprise_id=${eid} and run_id='2703' and step_seq=1120`));
  const toolStep = await withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
    where enterprise_id=${eid} and run_id='2703' and step_seq=1210`));
  const raw = String((rawStep?.private_checkpoint as Row)?.text || '');
  const snapshot = (toolStep?.private_checkpoint ?? {}) as BusinessSnapshot;
  const sources = businessSynthesisSources('report:2703', snapshot);
  console.log('SOURCES', sources.map(s => ({ id: s.sourceId, kind: s.reportScope?.kind, text: s.text.slice(0, 80) })));
  const coverage = ((snapshot as unknown as Row).reportQuestionPlan as Row)?.coverage as ReturnType<typeof reportQuestionCoverage>
    ?? reportQuestionCoverage(question);
  console.log('COVERAGE', JSON.stringify(coverage));
  const normalized = reportAnswerSynthesis(raw, coverage);
  const segments = JSON.parse(normalized).segments as Array<Row>;
  for (let i = 0; i < segments.length; i++) {
    try {
      parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [segments[i]] }), sources, { currentQuestion: question });
      console.log('SEG', i, 'ok', segments[i].text);
    } catch (e) {
      console.log('SEG', i, 'FAIL', (e as Error).message, '|', segments[i].text, '| citations', JSON.stringify(segments[i].citations));
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
