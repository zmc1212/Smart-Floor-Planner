/** Read-only: replay the saved report answer against its own report sources to
 * name the exact rejected segment and citation. No provider call, no writes. */
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { businessSynthesisSources, parseSynthesis, synthesisRepairIssue } from '@/lib/assistant/agent/synthesis';
import { reportAnswerSynthesis, reportQuestionCoverage } from '@/lib/assistant/agent/report-final';
import { fitAgentContext, estimateAgentRequest } from '@/lib/assistant/agent/context-budget';
import { nativeFinalMessages } from '@/lib/assistant/agent/native-final';
import { reportFinalOutputTokenLimit } from '@/lib/assistant/contracts/model';
import { reportNumericFailure, reportCoverageGapFailure, reportAbsenceScopeFailure } from '@/lib/assistant/agent/report-answer-review';
import type { BusinessSnapshot } from '@/lib/assistant/agent/business-tools';

loadEnvConfig(process.cwd(), true);
const eid = '1454';
const runId = process.argv[2] || '2727';
const question = '我家现在施工到哪一步了？最近工地上都做了些什么？';
async function stepTx(seq: number) {
  return withTenantTransaction(eid, tx => one(tx, sql`select private_checkpoint,input_summary from app.assistant_run_steps
    where enterprise_id=${eid} and run_id=${runId} and step_seq=${seq}`));
}
async function main() {
  const checkpoint = (await stepTx(1000))?.private_checkpoint as Row | undefined;
  const raw = String((checkpoint?.output as Row)?.text || '');
  const tool = (await stepTx(1210))?.private_checkpoint as Row | undefined;
  const report = (await stepTx(740))?.private_checkpoint as Row | undefined;
  const messages = (checkpoint?.messages as Array<Row> | undefined) || [];
  const packet = [...messages].reverse().find(message => message.role === 'tool' && String(message.content).includes('"reportReference"'));
  const fromPacket = packet ? JSON.parse(String(packet.content)) as Row : null;
  const snapshot = (fromPacket?.reportReference ? fromPacket : tool?.reportReference ? tool : report?.snapshot) as unknown as BusinessSnapshot;
  if (!snapshot || !('reportReference' in snapshot) || !snapshot.reportReference) throw new Error('no report snapshot on this run');
  const resultKey = String((fromPacket?.resultKey ?? tool?.resultKey ?? report?.resultKey) || 'report:' + runId);
  console.log('RESULTKEY', resultKey);
  const sources = businessSynthesisSources(resultKey, snapshot);
  console.log('RAW', raw.slice(0, 400));
  const coverage = ((snapshot as unknown as Row).reportQuestionPlan as Row)?.coverage as ReturnType<typeof reportQuestionCoverage>
    ?? (fromPacket?.questionCoverage as ReturnType<typeof reportQuestionCoverage> | undefined) ?? reportQuestionCoverage(question);
  if (process.argv.includes('--repair')) {
    const draft = String(((await stepTx(1120))?.private_checkpoint as Row | undefined)?.text || '');
    const failure = (await stepTx(1302))?.input_summary as Row | undefined;
    const feedback = failure?.code === 'unsupported_model_commitment' ? reportNumericFailure(draft, sources)
      : failure?.code === 'incomplete_model_answer' ? reportCoverageGapFailure(draft, coverage) ?? reportAbsenceScopeFailure(draft, sources, coverage)
      : null;
    const repairMessages = [...messages, { role: 'assistant' as const, content: draft },
      ...(feedback ? [{ role: 'system' as const, content: [{ type: 'text' as const, text: feedback.feedback }] }] : [])];
    const projected = nativeFinalMessages(repairMessages as Parameters<typeof nativeFinalMessages>[0]);
    const tool = { name: 'final_response', description: 'final', parameters: { type: 'object' } };
    console.log('REPAIR failure', failure?.code, 'feedback', feedback?.code, String(feedback?.feedback || '').length);
    const budget = { reportFinalOutputTokens: reportFinalOutputTokenLimit, purpose: 'answer' as const };
    try { console.log('REPAIR estimate', JSON.stringify(estimateAgentRequest(projected, [tool], budget))); }
    catch (e) { console.log('REPAIR estimate FAIL', (e as Error).message); }
    try { const fitted = fitAgentContext(projected, [tool], budget);
      console.log('REPAIR fit ok kept', fitted.messages.length, 'of', projected.length); }
    catch (e) { console.log('REPAIR fit FAIL', (e as Error).message); }
  }
  const parsed = { answers: {} } as Row;
  if (!process.argv.includes('--repair')) Object.assign(parsed, JSON.parse(raw) as Row);
  const segments = (parsed.answers ? Object.values(parsed.answers as Record<string, Row[]>).flat() : parsed.segments) as Array<Row>;
  console.log('SEGMENTS', segments.length);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    try {
      parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [segment] }), sources, { currentQuestion: question });
      console.log('SEG', i, 'ok');
    } catch (e) {
      console.log('SEG', i, 'FAIL', (e as Error).message, '|', segment.text, '| citations', JSON.stringify(segment.citations));
      const issue = synthesisRepairIssue(JSON.stringify({ kind: 'synthesis', segments: [segment] }), sources, { currentQuestion: question });
      console.log('SEG', i, 'REPAIR', JSON.stringify(issue)?.slice(0, 1500));
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
