import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { currentSynthesisContext } from '@/lib/assistant/agent/synthesis-sources';
import { businessSynthesisSources, parseSynthesis } from '@/lib/assistant/agent/synthesis';
import { reportAnswerSynthesis, reportQuestionCoverage } from '@/lib/assistant/agent/report-final';
import { prepareReportAnswerReview } from '@/lib/assistant/agent/report-answer-review';
import type { ActorContext } from '@/lib/assistant/contracts';

loadEnvConfig(process.cwd(), true);
const eid = '1454';
const question = '我家现在施工到哪一步了？最近工地上都做了些什么？';
async function main() {
  const raw = String(((await withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
    where enterprise_id=${eid} and run_id='2703' and step_seq=1120`)))?.private_checkpoint as Row)?.text || '');
  const tool = (await withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
    where enterprise_id=${eid} and run_id='2703' and step_seq=1210`)))?.private_checkpoint as Row;
  const coverage = (tool?.reportQuestionPlan as Row)?.coverage as ReturnType<typeof reportQuestionCoverage>
    ?? reportQuestionCoverage(question);
  const snapshot = tool as unknown as Parameters<typeof businessSynthesisSources>[1];
  const direct = businessSynthesisSources('report:2703', snapshot);
  const normalized = reportAnswerSynthesis(raw, coverage);
  try {
    parseSynthesis(normalized, direct, { currentQuestion: question });
    console.log('DIRECT PARSE OK');
  } catch (e) { console.log('DIRECT PARSE FAIL', (e as Error).message); }

  const conversation = await withTenantTransaction(eid, tx => one(tx, sql`select * from app.assistant_conversations
    where enterprise_id=${eid} and id='1522'`));
  const actor = { enterpriseId: eid, principal: { kind: 'user', userId: '645' }, capabilities: ['assistant.chat.self'] } as unknown as ActorContext;
  const ctx = await withTenantTransaction(eid, tx => currentSynthesisContext(tx, actor, conversation as Row, '2703'));
  console.log('CTX SOURCES', ctx.sources.map(s => ({ id: s.sourceId, kind: s.reportScope?.kind, has2248: s.text.includes('22:48') })));
  try {
    const draft = prepareReportAnswerReview(raw, ctx.sources, { currentQuestion: question }, [], coverage);
    console.log('REVIEW OK', JSON.stringify(draft.answer).slice(0, 500));
  } catch (e) { console.log('REVIEW FAIL', (e as Error).message); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
