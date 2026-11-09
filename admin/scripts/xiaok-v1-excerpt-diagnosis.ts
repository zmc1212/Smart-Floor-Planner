/** Reuse the saved failing first draft; no database, network or model execution. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseSynthesis, type SynthesisSource } from '@/lib/assistant/agent/synthesis';
import type { Evidence } from '@/lib/assistant/contracts';
import { compileModelRequest } from '@/lib/assistant/agent/model-request';
import { agentToolsForMessage,agentToolsForTurn } from '@/lib/assistant/agent/worker';
import { sourceExcerptInstructions,parseSourceExcerptAnswer } from '@/lib/assistant/agent/source-excerpts';
import {answerExcerpts} from '@/lib/assistant/knowledge/answer';
import { parseSourceQuestionAnswer, sourceQuestionCoverageProtocol, type SourceQuestionCoverage } from '@/lib/assistant/agent/source-question-coverage';
import type { ModelMessage } from '@/lib/assistant/contracts/model';

const directory=path.resolve('../tmp/v1-01-weiyun-jingyi/http-fixed-01');
const trace=JSON.parse(fs.readFileSync(path.join(directory,'run-1596.json'),'utf8'));
const evidence=trace.steps.find((s:{kind:string})=>s.kind==='retrieval').private_checkpoint as Evidence[];
const checkpoint=trace.steps.find((s:{kind:string})=>s.kind==='agent_checkpoint').private_checkpoint;
const packets=checkpoint.messages.filter((m:{role:string})=>m.role==='tool').map((m:{content:string})=>{try{return JSON.parse(m.content);}catch{return null;}});
const packet=packets.find((p:{synthesisSources?:unknown[]}|null)=>p?.synthesisSources);
const sources:SynthesisSource[]=packet.synthesisSources.map((s:SynthesisSource)=>({...s,evidence:evidence.find(e=>'K'+e.ref.id===s.sourceId)}));
const raw=trace.steps.find((s:{kind:string;step_seq:number})=>s.kind==='agent_model'&&s.step_seq===1110).private_checkpoint.text;
const context={currentQuestion:'我在看《精艺》这份装修手册，卫生间防水前要准备什么？'};
let originalCode='';try{parseSynthesis(raw,sources,context);}catch(error){originalCode=(error as Error).message;}
assert.equal(originalCode,'ungrounded_response_scope');
const selected=sources.filter(s=>['K2835','K2837'].includes(s.sourceId));assert.equal(selected.length,2);
const literal={kind:'synthesis',segments:selected.map(s=>({basis:'evidence',text:s.text,citations:[{sourceId:s.sourceId,quote:s.text}]}))};
parseSynthesis(JSON.stringify(literal),sources,context);
const report={originalCode,exactOriginalAccepted:true,sourceIds:selected.map(s=>s.sourceId),modelCalls:0,
  finding:'The existing exact-condition guard rejects the paraphrased directive; the same guard accepts program-selected verbatim source clauses. No guard is relaxed.'};
fs.writeFileSync(path.join(directory,'excerpt-diagnosis.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));

if(process.argv.includes('--compiled')){
  const nextDirectory=path.resolve('../tmp/v1-01-weiyun-jingyi/excerpt-http-02');
  const next=JSON.parse(fs.readFileSync(path.join(nextDirectory,'run-1597.json'),'utf8'));
  const state=next.steps.find((s:{kind:string})=>s.kind==='agent_checkpoint').private_checkpoint;
  const messages=state.messages as ModelMessage[],readIndex=messages.findIndex(m=>m.role==='tool'&&m.content.includes('"knowledgeStatus"'));
  assert.ok(readIndex>0);const beforeAnswer=messages.slice(0,readIndex+1);
  const original=beforeAnswer.flatMap(m=>m.role==='user'?m.content.flatMap(part=>{if(part.type!=='text')return [];try{return [JSON.parse(part.text)];}catch{return [];}}):[])
    .find(value=>value.sourceRole==='current_request');assert.ok(original?.sourceMessageId);const triggerId=String(original.sourceMessageId);
  const compiled=compileModelRequest({question:context.currentQuestion,triggerId,turn:1,purpose:'answer',messages:beforeAnswer,
    tools:agentToolsForMessage(context.currentQuestion,true),sourceExcerpts:true,
    toolsForTurn:(q,m,t,id)=>agentToolsForTurn(q,m,t,id,{sourceExcerpts:true})});
  const final=compiled.dispatchTools.find(tool=>tool.name==='final_response')!,fields=final.parameters.properties as Record<string,Record<string,unknown>>;
  assert.deepEqual(fields.kind.enum,['knowledge']);const ids=(fields.selections.items as {enum:string[]}).enum;assert.ok(ids.length>=4);
  const data=JSON.parse((compiled.modelMessages.find(m=>m.role==='tool') as {content:string}).content);
  assert.equal(data.instructions,sourceExcerptInstructions);
  const compiledReport={originalRun:'1597',originalFailure:'invalid_model_answer',modelCalls:0,actualSelectionIds:ids,finalKind:'knowledge',
    finding:'The real saved input now compiles compact selectionLines IDs and one consistent system/tool/final contract; durable checkpoints are unchanged.'};
  fs.writeFileSync(path.join(nextDirectory,'compiled-diagnosis.json'),JSON.stringify(compiledReport,null,2));console.log(JSON.stringify(compiledReport));
}

if(process.argv.includes('--shared-coverage')){
  const target=path.resolve('../tmp/v1-01-weiyun-jingyi/semantic-final-01'),trace=JSON.parse(fs.readFileSync(path.join(target,'run-1602.json'),'utf8'));
  const source=trace.steps.find((s:{kind:string})=>s.kind==='retrieval').private_checkpoint as Evidence[];
  const draft=trace.steps.find((s:{kind:string;step_seq:number})=>s.kind==='agent_model'&&s.step_seq===1110).private_checkpoint.text;
  const selected=JSON.parse(draft).selections,actual=parseSourceExcerptAnswer(JSON.stringify({selections:selected}),source);
  assert.ok(source.some(e=>e.text.includes('开槽后，铺设线管进行穿线')));
  assert.ok(!actual.segments.some(s=>s.text.includes('布管穿线')));
  const alternatives=answerExcerpts(source).filter(e=>e.sourceId===source[0].ref.id&&/线管弯头|布管穿线/.test(e.text));assert.equal(alternatives.length,2);
  const literal=parseSourceExcerptAnswer(JSON.stringify({selections:alternatives.map(e=>e.selectionId)}),source);
  assert.ok(literal.segments.some(s=>s.text.includes('布管穿线')));
  const result={originalRun:'1602',modelCalls:0,owningDomain:'Agent',knowledgeChangeRequired:false,actualSelections:selected,availableSelections:alternatives.map(e=>e.selectionId),
    actualOutcome:'Bending clause and test-source preface selected; requested threading order omitted despite correct complete Evidence.',
    mechanismHypothesis:'The current selector has no semantic completeness check across the current question; source identity and literal rendering guards cannot establish that every requested facet was answered.',
    stopped:'Do not add another wording/regex variant or sample until two passes. Preserve D2 count2, original failed batches and all usage.'};
  fs.writeFileSync(path.join(target,'coverage-diagnosis.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}

if(process.argv.includes('--coverage-contract')){
  const target=path.resolve('../tmp/v1-01-weiyun-jingyi/semantic-final-01'),saved=JSON.parse(fs.readFileSync(path.join(target,'run-1602.json'),'utf8'));
  const evidence=saved.steps.find((s:{kind:string})=>s.kind==='retrieval').private_checkpoint as Evidence[];
  const original=saved.steps.find((s:{kind:string;step_seq:number})=>s.kind==='agent_model'&&s.step_seq===1110).private_checkpoint.text;
  const coverage:SourceQuestionCoverage={protocol:sourceQuestionCoverageProtocol,questions:['电视墙线管拐弯','穿线顺序']};
  assert.throws(()=>parseSourceQuestionAnswer(original,evidence,coverage),/invalid_model_answer/);
  const excerpts=answerExcerpts(evidence),bending=excerpts.find(e=>e.text.includes('线管弯头'))!,threading=excerpts.find(e=>e.text.includes('布管穿线'))!;
  assert.ok(bending&&threading);
  const accepted=parseSourceQuestionAnswer(JSON.stringify({kind:'knowledge',selections:[bending.selectionId,threading.selectionId],
    coverage:{Q1:[bending.selectionId],Q2:[threading.selectionId]}}),evidence,coverage);
  assert.equal(accepted.answer.answerKind,'grounded');assert.deepEqual(accepted.missing,[]);
  assert.ok(accepted.answer.segments.some(s=>s.text.includes('布管穿线')));
  const output=path.resolve('../tmp/v1-01-weiyun-jingyi/coverage-implementation/saved-1602-check.json');
  assert.ok(!fs.existsSync(output),'Preserve original diagnostic attempts');
  const result={originalRun:'1602',originalRetained:true,modelCalls:0,knowledgeChangeRequired:false,protocol:coverage.protocol,
    oldDraftRejected:true,completeOriginalAccepted:true,selections:[bending.selectionId,threading.selectionId],
    limitation:'Per-question semantic matching still requires the fixed configured-model trials; this check establishes protocol completeness, not semantic acceptance.'};
  fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
