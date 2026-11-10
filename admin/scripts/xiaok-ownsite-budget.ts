/** Read-only diagnostic: measure the saved report-answer request against the
 * existing context budget. No provider call, no writes. */
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { estimateAgentRequest, contextBudgetPolicy, agentRequestBudget } from '@/lib/assistant/agent/context-budget';
import { finalTool } from '@/lib/assistant/agent/worker';
import { businessSynthesisSources } from '@/lib/assistant/agent/synthesis';
import type { BusinessSnapshot } from '@/lib/assistant/agent/business-tools';
import type { ModelMessage } from '@/lib/assistant/contracts/model';

loadEnvConfig(process.cwd(), true);
const eid = '1454';
const runId = process.argv[2] || '2705';

async function main() {
  const data = await withTenantTransaction(eid, async tx => {
    const checkpoint = await one(tx, sql`select private_checkpoint from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${runId} and step_seq=1000`);
    const reportStep = await one(tx, sql`select private_checkpoint from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${runId} and step_seq=740`);
    return { checkpoint: checkpoint?.private_checkpoint, reportStep: reportStep?.private_checkpoint };
  });
  const messages = (data.checkpoint as { messages: ModelMessage[] }).messages;
  const report = data.reportStep as { resultKey: string; snapshot: BusinessSnapshot } | undefined;
  const sources = report ? businessSynthesisSources(report.resultKey, report.snapshot) : [];
  const reportFinalBudget = agentRequestBudget({ purpose: 'answer', reportFinalOutputTokens: 4096 });
  const plain = estimateAgentRequest(messages, [finalTool]);
  const withFinal = estimateAgentRequest(messages, [{ ...finalTool, parameters: { type: 'object', properties: { kind: { type: 'string' } } } }]);
  console.log(JSON.stringify({
    runId, messageRoles: messages.map(message => message.role),
    contextBudgetPolicy, reportFinalBudget,
    finalLimitBytes: (reportFinalBudget.inputBudget - reportFinalBudget.maxOutputTokens - 768) * 3,
    messagesBytes: plain.textBytes, messagesTokens: plain.estimatedTokens,
    perMessageBytes: messages.map((message, index) => ({ index, role: message.role, bytes: Buffer.byteLength(JSON.stringify(message)) })),
    reportSources: sources.length, reportSourcesBytes: Buffer.byteLength(JSON.stringify({ sources })),
    displayTextBytes: report ? Buffer.byteLength(String((report.snapshot as { displayText?: string }).displayText || '')) : 0,
    perSourceBytes: sources.map(source => ({ id: source.sourceId, bytes: Buffer.byteLength(JSON.stringify(source)) })),
    unreachable: withFinal.textBytes,
  }, null, 1));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
