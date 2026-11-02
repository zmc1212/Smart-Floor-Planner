/** Deterministic discriminator using the retained original1929. No DB/model. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { finalToolForMessages } from '@/lib/assistant/agent/worker';
import { reportFinalResponseIssue, reportQuestionCoverage, reportAnswerSynthesis, reportCoverageFailure } from '@/lib/assistant/agent/report-final';
import { reportFactText } from '@/lib/assistant/agent/report-context';
import { focusedSynthesisMessages } from '@/lib/assistant/agent/synthesis';
import { toolSchemaIssue } from '@/lib/assistant/agent/tool-protocol';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import type { AgentCheckpoint } from '@/lib/assistant/agent/runtime';
import type { BusinessSnapshot } from '@/lib/assistant/agent/business-tools';
import type { ReportProject } from '@/lib/construction/report-scope';
import type { ReportBusinessReference } from '@/lib/assistant/agent/report-context';

async function main() {
  const coverageMode = process.argv.includes('--coverage');
  const root = path.resolve('..'), input = path.join(root, coverageMode ? 'tmp/v1-02-live-followups/report-final-configured01/run-1931.json' : 'tmp/v1-02-live-followups/configured-03/run-1929.json');
  const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-live-followups/report-final-offline.json');
  assert.ok(!fs.existsSync(output), 'Preserve original discriminators');
  const bytes = fs.readFileSync(input), saved = JSON.parse(bytes.toString());
  const state = saved.steps.find((s: { kind: string }) => s.kind === 'agent_checkpoint').private_checkpoint as AgentCheckpoint;
  const snapshot = saved.steps.find((s: { step_seq: number }) => s.step_seq === 1200).private_checkpoint as BusinessSnapshot & { reportReference: ReportBusinessReference };
  const original = state.output!.text, before = JSON.stringify({ state, snapshot });
  assert.equal(JSON.parse(original).kind, coverageMode ? 'synthesis' : 'business');
  // Citation options are added by the normal model projection. The durable
  // unprojected packet intentionally retains the complete original instead.
  const triggerId = String(saved.run.trigger_message_id);
  const view = focusedSynthesisMessages(state.messages, triggerId);
  const currentQuestion = state.messages.flatMap(m => m.role === 'user' ? m.content.flatMap(part => {
    if (part.type !== 'text') return []; try { const packet = JSON.parse(part.text); return packet.sourceMessageId === triggerId ? [String(packet.text)] : []; } catch { return []; }
  }) : [])[0];
  const schema = finalToolForMessages(view, coverageMode ? currentQuestion : '');
  const generationIssue = await toolSchemaIssue(schema, original);
  let serverIssue = reportFinalResponseIssue(original, snapshot);
  if (coverageMode) {
    try { reportAnswerSynthesis(original, reportQuestionCoverage(currentQuestion)); }
    catch (error) { serverIssue = reportCoverageFailure(error); }
  }
  assert.ok(generationIssue); assert.equal(serverIssue?.code, 'invalid_model_answer');
  const originalSources = JSON.parse(state.messages.find(m => m.role === 'tool')!.content as string).synthesisSources;
  for (const source of originalSources) for (const citation of sourceCitationCatalog(source)) assert.ok(JSON.stringify(schema).includes(citation.citationId));
  const local = reportFactText(snapshot.reportReference.selection, (snapshot.data as unknown as ReportProject[])[0]);
  assert.match(local, /事实截止：2026-11-01 20:00:00（Asia\/Shanghai，UTC\+08:00）/);
  assert.equal(JSON.stringify({ state, snapshot }), before);
  assert.equal(createHash('sha256').update(fs.readFileSync(input)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  const evidence = { at: new Date().toISOString(), input: path.relative(root, input).replaceAll('\\', '/'),
    sourceHash: createHash('sha256').update(bytes).digest('hex'), originalRun: saved.run, originalFinal: original,
    schemaKinds: (schema.parameters.properties as { kind: { enum: string[] } }).kind.enum,
    generationIssue: generationIssue.code, serverIssue: serverIssue.code, originalCatalogPreserved: true,
    ...(coverageMode ? { currentOriginalPreserved: true, questionCoverage: reportQuestionCoverage(currentQuestion),
      scope: 'Saved1931 rejected before ordinary synthesis decoding; no resampling or original-run replay.' } : {}),
    cutoffShanghai: '2026-11-01 20:00:00 Asia/Shanghai UTC+08:00', originalsUnchanged: true,
    dbWrites: 0, providerCalls: 0, needWrites: 0, reportBodyCalls: 0, knowledgeChanges: 0 };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
