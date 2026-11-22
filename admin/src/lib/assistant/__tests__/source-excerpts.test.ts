import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import { answerExcerpts } from '../knowledge/answer';
import { finalToolForMessages, agentToolsForMessage, agentToolsForTurn } from '../agent/worker';
import { knowledgeSynthesisSources, parseSynthesis, synthesisInstructions } from '../agent/synthesis';
import { synthesisQuestionPrefix } from '../agent/model-policy';
import { compileModelRequest } from '../agent/model-request';
import { hasQualifiedMeasurementExcerpt, parseSourceExcerptAnswer, sourceExcerptInstructions } from '../agent/source-excerpts';

const currentQuestion='我在看《精艺》这份装修手册，卫生间防水前要准备什么？';
const evidence:Evidence[]=[{ref:{type:'knowledge_chunk',id:'2835',version:'411'},hash:'synthetic',
  text:'防水工艺标准：1、基层找平：防水前，地基放坡找平，坡度1-2%，坡向地漏。还需做好梯形水泥浆防水坝，顶面离地砖表面10mm。'}];
const paired=(items:Evidence[]=evidence):ModelMessage[]=>[
  {role:'assistant',content:'',toolCalls:[{id:'read',name:'search_knowledge',arguments:'{"query":"精艺 防水前"}'}]},
  {role:'tool',callId:'read',content:JSON.stringify({knowledgeStatus:'ready',evidence:answerExcerpts(items),synthesisSources:knowledgeSynthesisSources(items)})},
];
const properties=(messages:ModelMessage[],enabled=true)=>finalToolForMessages(messages,currentQuestion,enabled).parameters.properties as Record<string,Record<string,unknown>>;

test('fresh opted-in source reads expose actual excerpt identities while legacy and unpaired reads retain their envelope',()=>{
  const actual=properties(paired());
  assert.deepEqual(actual.kind.enum,['knowledge']);
  assert.deepEqual((actual.selections.items as Record<string,unknown>).enum,['E1','E2']);
  assert.deepEqual(properties(paired(),false).kind.enum,['synthesis']);
  assert.notDeepEqual(properties(paired().slice(1)).kind.enum,['knowledge']);
  assert.notDeepEqual(properties([{role:'tool',callId:'read',content:JSON.stringify({knowledgeStatus:'ready',evidence:answerExcerpts(evidence)})}]).kind.enum,['knowledge']);
  const empty=properties(paired([]));
  assert.deepEqual(empty.kind.enum,['knowledge']);assert.equal(empty.selections.maxItems,0);
});

test('saved failure paraphrase remains rejected; exact selected clauses pass the same scope and numeric guards',()=>{
  const text='需对地基进行放坡找平，坡度控制在1-2%并坡向地漏；同时做好梯形水泥浆防水坝，其顶面离地砖表面10mm。';
  assert.throws(()=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text,
    citations:[{sourceId:'K2835',quote:evidence[0].text}]}]}),knowledgeSynthesisSources(evidence),{currentQuestion}),/ungrounded_response_scope/);
  const answer=parseSourceExcerptAnswer('{"selections":["E1","E2"]}',evidence,{currentQuestion});
  assert.equal(answer.answerKind,'grounded');assert.equal(answer.segments[0].text,evidence[0].text);
  assert.deepEqual(answer.segments[0].citations,[{sourceId:'2835',quote:evidence[0].text}]);
});

test('the complete request compiler preserves compact excerpt identities and binds one matching final contract',()=>{
  const messages:ModelMessage[]=[{role:'system',content:[{type:'text',text:synthesisInstructions+synthesisQuestionPrefix+JSON.stringify({currentQuestion})}]},
    {role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'current',text:currentQuestion})}]},...paired()];
  const input={question:currentQuestion,triggerId:'current',turn:1,purpose:'answer' as const,messages,tools:agentToolsForMessage(currentQuestion,true),
    toolsForTurn:(q:string,m:ModelMessage[],t:ReturnType<typeof agentToolsForMessage>,id:string)=>agentToolsForTurn(q,m,t,id,{sourceExcerpts:true})};
  const compiled=compileModelRequest({...input,sourceExcerpts:true}),final=compiled.dispatchTools.find(t=>t.name==='final_response')!;
  const fields=final.parameters.properties as Record<string,Record<string,unknown>>;
  assert.deepEqual(fields.kind.enum,['knowledge']);assert.deepEqual((fields.selections.items as Record<string,unknown>).enum,['E1','E2']);
  assert.ok(compiled.modelMessages.some(m=>m.role==='system'&&m.content.some(p=>p.type==='text'&&p.text.startsWith(sourceExcerptInstructions))));
  const packet=JSON.parse(compiled.modelMessages.find(m=>m.role==='tool')!.content as string);
  assert.equal(packet.instructions,sourceExcerptInstructions);
  const legacy=compileModelRequest({...input,sourceExcerpts:false,toolsForTurn:(q,m,t,id)=>agentToolsForTurn(q,m,t,id)});
  assert.deepEqual((legacy.dispatchTools.find(t=>t.name==='final_response')!.parameters.properties as Record<string,Record<string,unknown>>).kind.enum,['synthesis']);
});

test('source selection never authorizes foreign identities, prose, extra fields or a project approval',()=>{
  for(const raw of ['{"selections":["E999"]}','{"selections":["E1"],"text":"已经验收通过"}','{"selections":["E1","E1"]}'])
    assert.throws(()=>parseSourceExcerptAnswer(raw,evidence,{currentQuestion}),/invalid_model_/);
  const unsafe:Evidence[]=[{...evidence[0],text:'这个项目已经验收合格，可以保证安全入住。'}];
  assert.throws(()=>parseSourceExcerptAnswer('{"selections":["E1"]}',unsafe,{currentQuestion:'我家这个项目可以验收合格了吗？'}),/unsupported_model_commitment|ungrounded_response_scope/);
  assert.equal(parseSourceExcerptAnswer('{"selections":[]}',evidence,{currentQuestion}).answerKind,'insufficient_evidence');
});

test('an ordinary workmanship answer selects the authorized measurement clause without rewriting its subject', () => {
  const question = '卫生间防水做完之后，闭水试验要放多深的水、蓄多久才算合格？';
  const quote = '卫生间闭水试验时，最高蓄水深度不低于20mm，蓄水观察时间不低于48小时。';
  const source: Evidence = { ...evidence[0], text: quote, knowledge: { enterpriseName: '合成企业', documentId: '1', title: '合成工艺',
    versionId: '411', versionNumber: 1, scope: 'enterprise', projectId: null, category: '防水', sourceType: 'faq',
    effectiveFrom: '2026-11-01', effectiveTo: null, published: true } };
  const tools = agentToolsForMessage(question, true);
  const compile = (items: Evidence[], withProject = false) => {
    const excerpts = answerExcerpts(items);
    const messages: ModelMessage[] = [
      { role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] },
      { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: question }) }] },
      paired(items)[0],
      { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', evidence: excerpts,
        synthesisSources: knowledgeSynthesisSources(items), qualifiedMeasurementExcerpt: hasQualifiedMeasurementExcerpt(excerpts, items) }) },
    ];
    if (withProject) messages.push(
      { role: 'assistant', content: '', toolCalls: [{ id: 'project', name: 'query_business', arguments: '{}' }] },
      { role: 'tool', callId: 'project', content: JSON.stringify({ resultKey: 'project-result', synthesisSources: [] }) });
    return compileModelRequest({ question, triggerId: 'current', turn: 1, purpose: 'answer', messages, tools,
      sourceExcerpts: true, sourceQuestionCoverage: true,
      toolsForTurn: (q, m, t, id) => agentToolsForTurn(q, m, t, id, { sourceExcerpts: true, sourceQuestionCoverage: true }) });
  };
  const result = compile([source]);
  const fields = (compiled: typeof result) => compiled.dispatchTools.find(tool => tool.name === 'final_response')!
    .parameters.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(fields(result).kind.enum, ['knowledge']);
  assert.ok(!fields(result).coverage);
  assert.ok(result.modelMessages.some(m => m.role === 'system' && m.content.some(p => p.type === 'text' && p.text.startsWith(sourceExcerptInstructions))));
  assert.deepEqual(parseSourceExcerptAnswer('{"selections":["E1"]}', [source], { currentQuestion: question }).segments,
    [{ text: quote, citations: [{ sourceId: source.ref.id, quote }] }]);
  assert.notDeepEqual(fields(compile([source], true)).kind.enum, ['knowledge']);
  assert.notDeepEqual(fields(compile([{ ...source, text: quote.replace('最高蓄水深度', '蓄水深度') }])).kind.enum, ['knowledge']);
  assert.throws(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: quote.replace('20mm', '30mm'),
    citations: [{ sourceId: 'K' + source.ref.id, quote }] }] }), knowledgeSynthesisSources([source])), /unsupported_model_commitment/);
});

test('shared craft follow-ups keep the same source selector without relying on source-title keywords',()=>{
  for(const question of ['先穿线还是先铺管，为什么？','不是问我们现场已经做完没，我想知道这样做的原因。']){
    const messages:ModelMessage[]=[{role:'system',content:[{type:'text',text:synthesisInstructions+synthesisQuestionPrefix+JSON.stringify({currentQuestion:question})}]},
      {role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'current',text:question})}]},...paired()];
    const compiled=compileModelRequest({question,triggerId:'current',turn:1,purpose:'answer',messages,tools:agentToolsForMessage(question,true),sourceExcerpts:true,requiredKnowledge:true,
      toolsForTurn:(q,m,t,id)=>agentToolsForTurn(q,m,t,id,{sourceExcerpts:true,requiredKnowledge:true})});
    assert.deepEqual((compiled.dispatchTools.find(t=>t.name==='final_response')!.parameters.properties as Record<string,Record<string,unknown>>).kind.enum,['knowledge']);
    assert.ok(compiled.modelMessages.some(m=>m.role==='system'&&m.content.some(p=>p.type==='text'&&p.text.startsWith(sourceExcerptInstructions))));
  }
});
