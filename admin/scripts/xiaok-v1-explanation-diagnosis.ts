/** Zero-provider discriminator using the retained original failures. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { Evidence } from '@/lib/assistant/contracts';
import { knowledgeSynthesisSources, parseSynthesis } from '@/lib/assistant/agent/synthesis';
import { prepareKnowledgeExplanation } from '@/lib/assistant/agent/knowledge-explanation';
import { parseSourceQuestionQuery } from '@/lib/assistant/agent/source-question-coverage';
import { completeJsonBeforeExtraBrace, parseAgentChat } from '@/lib/ai/providers/agent-chat';
import { createHash } from 'node:crypto';

const root = path.resolve('../tmp/v1-01-weiyun-jingyi');
const original = JSON.parse(fs.readFileSync(path.join(root, 'http-fixed-01/run-1596.json'), 'utf8'));
const evidence: Evidence[] = original.steps.find((s: { kind: string }) => s.kind === 'retrieval').private_checkpoint;
const raw: string = original.steps.find((s: { step_seq: number }) => s.step_seq === 1110).private_checkpoint.text;
const sources = knowledgeSynthesisSources(evidence);
const question = '我在看《精艺》这份装修手册，卫生间防水前要准备什么？';
assert.throws(() => parseSynthesis(raw, sources, { currentQuestion: question }), /ungrounded_response_scope/);
const coverage = parseSourceQuestionQuery({ questions: ['卫生间防水前要准备什么'] }, question);
const draft = prepareKnowledgeExplanation(JSON.stringify({ kind: 'knowledge_explanation', answers: { Q1: JSON.parse(raw).segments } }),
  sources, coverage, { currentQuestion: question });
const omitted = JSON.parse(fs.readFileSync(path.join(root, 'semantic-final-01/run-1602.json'), 'utf8'));
const omittedRaw = omitted.steps.find((s: { step_seq: number }) => s.step_seq === 1110).private_checkpoint.text;
const omittedQuestion = '微云内部的精艺工艺复核资料里，电视墙线管拐弯和穿线顺序该怎么理解？';
const omittedCoverage = parseSourceQuestionQuery({ questions: ['电视墙线管拐弯', '穿线顺序'] }, omittedQuestion);
assert.throws(() => prepareKnowledgeExplanation(omittedRaw,
  knowledgeSynthesisSources(omitted.steps.find((s: { kind: string }) => s.kind === 'retrieval').private_checkpoint),
  omittedCoverage, { currentQuestion: omittedQuestion }), /invalid_model_answer/);
const report = { modelCalls: 0, originalFailures: ['1596', '1602'], owningDomain: 'Agent', knowledgeChangeRequired: false,
  literalGuardOriginal: 'ungrounded_response_scope', naturalDraftPrepared: true, draftBinding: draft.binding,
  semanticAcceptance: 'not asserted: a durable configured-model review is still required',
  omittedSelectorCannotBypassNewQuestionContract: true, inheritedD2RepairCount: 2 };
fs.writeFileSync(path.join(root, 'explanation-implementation/saved-trace-diagnosis.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
const frameFile=path.join(root,'explanation-frame-discriminator-03/run-1608.json');
if(fs.existsSync(frameFile)){
  const trace=JSON.parse(fs.readFileSync(frameFile,'utf8'));
  const frame=trace.steps.find((s:{kind:string})=>s.kind==='agent_invalid_provider_frame').private_checkpoint.payload;
  const args=frame.choices[0].message.tool_calls[0].function.arguments as string;
  assert.throws(()=>JSON.parse(args));const normalized=completeJsonBeforeExtraBrace(args);assert.ok(normalized);
  const copy=structuredClone(frame);copy.choices[0].message.tool_calls[0].function.arguments=normalized;
  const parsed=parseAgentChat(copy);assert.equal(parsed.toolCalls.length,1);
  const replay={modelCalls:0,originalRun:'1608',originalStatusUnchanged:true,rawArgumentsHash:createHash('sha256').update(args).digest('hex'),
    transformation:'exactly one unmatched trailing brace removed after a complete JSON object',decoded:true,semanticAcceptance:false};
  fs.writeFileSync(path.join(root,'explanation-implementation/trailing-brace-replay.json'),JSON.stringify(replay,null,2));console.log(JSON.stringify(replay));
}
