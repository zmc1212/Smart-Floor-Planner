/** Saved1933 discriminator against the implemented compiler, without replay. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { finalToolForMessages } from '@/lib/assistant/agent/worker';
import { focusedSynthesisMessages } from '@/lib/assistant/agent/synthesis';
import { nativeFinalDefinition, explicitNativeObjectRoot } from '@/lib/assistant/agent/native-final';
import { compileModelRequest } from '@/lib/assistant/agent/model-request';
import { nativeImageFinalMessages } from '@/lib/assistant/agent/native-final';
import { toolSchemaIssue } from '@/lib/assistant/agent/tool-protocol';
import type { AgentCheckpoint } from '@/lib/assistant/agent/runtime';

async function main() {
  const root = path.resolve('..'), input = path.join(root, 'tmp/v1-02-live-followups/report-coverage-configured01/run-1933.json');
  const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-live-followups/report-native-offline01.json');
  assert.ok(!fs.existsSync(output), 'Preserve original evidence');
  const bytes = fs.readFileSync(input), saved = JSON.parse(bytes.toString());
  const before = createHash('sha256').update(bytes).digest('hex');
  const state = saved.steps.find((s: { kind: string }) => s.kind === 'agent_checkpoint').private_checkpoint as AgentCheckpoint;
  const question = '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？';
  const triggerId = String(saved.run.trigger_message_id), messages = focusedSynthesisMessages(state.messages, triggerId);
  const original = saved.steps.find((s: { step_seq: number }) => s.step_seq === 1120).private_checkpoint.text;
  const repair = saved.steps.find((s: { step_seq: number }) => s.step_seq === 1130).private_checkpoint.text;
  const tool = explicitNativeObjectRoot(nativeFinalDefinition(finalToolForMessages(messages, question)));
  const compiled = compileModelRequest({ question, triggerId, turn: 2, purpose: 'answer', messages, tools: [],
    toolsForTurn: () => [tool], wireProjection: nativeImageFinalMessages });
  assert.ok(await toolSchemaIssue(tool, original)); assert.ok(await toolSchemaIssue(tool, repair));
  assert.ok(JSON.stringify(compiled.policyView).includes('kind=report_answer'));
  const valid = JSON.stringify({ kind: 'report_answer', answers: {
    Q1: [{ basis: 'uncertainty', text: '当前报告没有标明对应房间，本次不能确认客厅现场状态。', citations: [] }],
    Q2: [{ basis: 'uncertainty', text: '周五安装的安排本次无法确认。', citations: [] }],
  } });
  assert.equal(await toolSchemaIssue(tool, valid), null);
  assert.equal(createHash('sha256').update(fs.readFileSync(input)).digest('hex'), before);
  fs.writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), original1933Hash: before,
    originalFirstFinalRejected: true, originalUnsafeRepairRejected: true, completeNonQuantifiedEnvelopeAccepted: true,
    reportPolicyPreserved: true, dispatchTools: compiled.dispatchTools.map(t => t.name),
    caveat: 'Deterministic schema/compiler compatibility only, not source grounding or natural room/schedule acceptance.',
    providerCalls: 0, databaseWrites: 0, originalRunsReplayed: 0 }, null, 2));
  console.log(JSON.stringify({ output, passed: true, providerCalls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
