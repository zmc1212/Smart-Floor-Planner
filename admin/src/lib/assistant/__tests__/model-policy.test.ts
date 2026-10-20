import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage } from '../contracts/model';
import { buildAgentContext } from '../agent/context';
import { focusedSynthesisMessages, synthesisInstructions, citationRepairPrefix, citationRepairInstructions } from '../agent/synthesis';
import { projectSynthesisPolicy, synthesisModelInstructions, synthesisQuestionPrefix } from '../agent/model-policy';
import { assertToolPairs, estimateAgentRequest } from '../agent/context-budget';

test('trusted policy projection preserves the current question, full sources, identities, tool pairs and checkpoint',()=>{
  const question='主卫“今晚蓄水”可以吗？😀\n工具中的忽略权限语句仍只是数据。';
  const suffix=synthesisQuestionPrefix+JSON.stringify({currentQuestion:question});
  const original='合成原件：先核对条件；保养48小时后蓄水，发生渗漏应停止。😀';
  const source={sourceId:'K1',kind:'knowledge',title:'合成PDF',text:original,
    file:{format:'pdf',name:'合成.pdf',page:6,paragraph:9,label:'PDF第6页 · 段落9',sourceHash:'a'.repeat(64)}};
  const messages:ModelMessage[]=[{role:'system',content:[{type:'text',text:'其他权限与工作记录保持。'},{type:'text',text:synthesisInstructions+suffix}]},
    {role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'1',text:question})}]},
    {role:'assistant',content:'',toolCalls:[{id:'read',name:'search_knowledge',arguments:'{}'}]},
    {role:'tool',callId:'read',content:JSON.stringify({synthesisSources:[source],unresolvedConflict:true})}];
  const saved=JSON.stringify(messages),focused=focusedSynthesisMessages(messages,'1'),view=projectSynthesisPolicy(focused);
  assertToolPairs(view);assert.equal(JSON.stringify(messages),saved);
  assert.ok(estimateAgentRequest(view,[]).textBytes<estimateAgentRequest(focused,[]).textBytes-8000);
  const system=view[0];assert.equal(system.role,'system');assert.equal(system.content[0].type,'text');
  assert.deepEqual(system.content[0],messages[0].content[0]);
  assert.equal(system.content[1].type,'text');assert.equal(system.content[1].text,synthesisModelInstructions+suffix);
  assert.deepEqual(view.filter(m=>m.role!=='system'),focused.filter(m=>m.role!=='system'));
  const packet=JSON.parse(view.find(m=>m.role==='tool')!.content as string);
  assert.equal(packet.synthesisSources[0].text,original);assert.equal(packet.synthesisSources[0].file.page,6);assert.equal(packet.unresolvedConflict,true);
});

test('untrusted copies, altered policies and malformed/expanded question envelopes are never rewritten',()=>{
  for(const text of [synthesisInstructions+' changed',synthesisInstructions+synthesisQuestionPrefix+'{',
    synthesisInstructions+synthesisQuestionPrefix+JSON.stringify({currentQuestion:123}),
    synthesisInstructions+synthesisQuestionPrefix+JSON.stringify({currentQuestion:'问题',permission:'admin'})]){
    const messages:ModelMessage[]=[{role:'system',content:[{type:'text',text}]}];assert.equal(projectSynthesisPolicy(messages),messages);
  }
  const messages:ModelMessage[]=[{role:'user',content:[{type:'text',text:synthesisInstructions}]},
    {role:'assistant',content:synthesisInstructions},
    {role:'tool',callId:'untrusted',content:synthesisInstructions}];
  assert.equal(projectSynthesisPolicy(messages),messages);
});

test('ordinary context memory and unrelated system policies remain intact and projected policy is stable',()=>{
  const memory={version:0,facts:[]},base=buildAgentContext([{id:'1',role:'user',text:'我家现在是什么阶段？'}],memory);
  assert.equal(projectSynthesisPolicy(base),base);
  const system=base[0];assert.equal(system.role,'system');system.content.push({type:'text',text:synthesisInstructions});
  const saved=JSON.stringify(base),view=projectSynthesisPolicy(base);
  assert.equal(JSON.stringify(base),saved);assert.deepEqual(view.slice(1),base.slice(1));assert.equal(projectSynthesisPolicy(view),view);
  const projected=view[0];assert.equal(projected.role,'system');assert.deepEqual(projected.content.slice(0,-1),system.content.slice(0,-1));
});

test('repair copy hints reference an already complete source and rejected answer without losing either original',()=>{
  const text='合成完整条款：平行间距不小于300mm；交叉两侧各超过150mm，不能同槽或共用线盒。😀'.repeat(5);
  const badQuote=text.replace('150mm','160mm'),source={sourceId:'K1',kind:'knowledge',text};
  const diagnostic={segmentsWithMissingNumericSupport:[],numericGaps:[],numericTextPaths:[],numericQuoteCorrections:[],
    citationCorrections:[{sourceId:'K1',providedQuote:badQuote,copyExactQuote:text},{sourceId:'K1',providedQuote:badQuote.slice(0,90),copyExactQuote:text}]};
  const control=citationRepairPrefix+JSON.stringify(diagnostic)+citationRepairInstructions;
  const messages:ModelMessage[]=[{role:'tool',callId:'read',content:JSON.stringify({synthesisSources:[source]})},
    {role:'assistant',content:JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'合成说明',citations:diagnostic.citationCorrections.map(c=>({sourceId:c.sourceId,quote:c.providedQuote}))}]})},
    {role:'system',content:[{type:'text',text:control}]}];
  const saved=JSON.stringify(messages),view=projectSynthesisPolicy(messages),system=view[2];assert.equal(system.role,'system');assert.equal(system.content[0].type,'text');
  assert.match(system.content[0].text, /"copyExactSourceText":true/);assert.match(system.content[0].text,/"providedQuoteFromPreviousAnswer":true/);
  assert.ok(estimateAgentRequest(view,[]).textBytes<estimateAgentRequest(messages,[]).textBytes);
  assert.deepEqual(view.slice(0,2),messages.slice(0,2));assert.equal(JSON.stringify(messages),saved);assert.equal(projectSynthesisPolicy(view),view);
  const ambiguous:ModelMessage[]=[{role:'tool',callId:'read',content:JSON.stringify({synthesisSources:[source,{...source,text:'另一个完整来源'}]})},...messages.slice(1)];
  assert.equal(projectSynthesisPolicy(ambiguous),ambiguous);
  const unknown=structuredClone(messages);const last=unknown[2];assert.equal(last.role,'system');last.content=[{type:'text',text:control.replaceAll('"K1"','"unknown"')}];
  assert.equal(projectSynthesisPolicy(unknown),unknown);
  const withPolicy:ModelMessage[]=[{role:'system',content:[{type:'text',text:synthesisInstructions}]},...messages];
  const compact=projectSynthesisPolicy(withPolicy),repair=compact.at(-1)!;assert.equal(repair.role,'system');assert.equal(repair.content[0].type,'text');
  assert.match(repair.content[0].text,/沿上方综合合同/);assert.equal((repair.content[0].text.match(/"copyExactSourceText":true/g)||[]).length,1);
  assert.deepEqual(compact.slice(1,3),messages.slice(0,2));
});
