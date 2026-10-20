import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticDocx, syntheticPdf, syntheticZip, syntheticChinesePdf, syntheticDateXlsx, syntheticTimeXlsx } from '../../../../scripts/assistant-file-fixtures';
import { parseSourceFile, uploadedFile, fileContent, fileChunks, fileQuoteSpans } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';
import { parseSynthesis, synthesisRepairFeedback, focusedSynthesisMessages, knowledgeSynthesisSources } from '../agent/synthesis';
import { answerExcerpts, parseSelection } from '../knowledge/answer';
import type { Evidence } from '../contracts';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';
import { assertToolPairs } from '../agent/context-budget';
import type { ModelMessage } from '../contracts/model';

const passageFixture = (count = 9): SourceFile => ({ version: 1, assetId: '1', hash: 'a'.repeat(64), name: '合成并发.docx', format: 'docx',
  parsed: { parser: 'synthetic-passages-v1', warnings: [], blocks: Array.from({ length: count }, (_, index) => ({ id: 'p'+index,
    kind: 'paragraph', section: [], paragraph: index + 1, text: `合成原段${index}😀，前提和例外必须保留。` })) },
  review: { adminId: '1', at: '2026-10-20T00:00:00Z', excluded: [] } });

test('file passage checks use at most four concurrent calls and preserve Unicode source order and locators', async () => {
  const file = passageFixture(), before = JSON.stringify(file); let active = 0, maximum = 0;
  const completed: number[] = [];
  const chunks = await fileChunks(file, async text => {
    const index = Number(/原段(\d+)/.exec(text)![1]); active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, (10-index)*2)); completed.push(index); active--;
    return [{ text, start: 0, end: Array.from(text).length, tokens: 30 }];
  });
  assert.equal(maximum, 4); assert.equal(active, 0); assert.notDeepEqual(completed, [...completed].sort((a,b)=>a-b));
  assert.deepEqual(chunks.map(chunk=>chunk.file.blockId), file.parsed!.blocks.map(block=>block.id));
  for (const chunk of chunks) assert.equal(Array.from(fileContent(file).body).slice(chunk.start,chunk.end).join(''),chunk.text);
  assert.equal(JSON.stringify(file), before);
});

test('a failed passage stops new dispatches and drains the already in-flight checks before returning failure', async () => {
  const gates: Array<()=>void> = []; let calls = 0, active = 0, settled = false;
  const pending = fileChunks(passageFixture(12), async text => {
    calls++; if (calls === 1) throw Error('source_revoked');
    active++; await new Promise<void>(resolve => gates.push(resolve)); active--;
    return [{text,start:0,end:Array.from(text).length,tokens:30}];
  });
  const observed = pending.then(()=>{settled=true;}, error=>{settled=true;throw error;});
  const rejected = assert.rejects(observed,/source_revoked/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,4); assert.equal(active,3); assert.equal(settled,false);
  gates.forEach(release=>release()); await rejected;
  assert.equal(active,0); assert.equal(calls,4);
});

test('concurrent validation still refuses clipped conditions and enforces original block bounds before dispatch', async () => {
  let calls = 0;
  await assert.rejects(fileChunks(passageFixture(),async text=>{calls++;return [{text:text.slice(0,-1),start:0,end:Array.from(text).length-1,tokens:30}];}),/knowledge_file_block_limit/);
  assert.ok(calls<=4);
  calls=0;await assert.rejects(fileChunks(passageFixture(129),async()=>{calls++;return [];}),/knowledge_file_block_limit/);assert.equal(calls,0);
});

test('DOCX keeps chapters/merged headers/cells/footnotes/Unicode without invented pages',async()=>{
  const parsed=await parseSourceFile(syntheticDocx({image:true}),'docx');
  const row=parsed.blocks.find(b=>b.text.includes('TEST-A'))!;assert.ok(row);assert.equal(row.table,1);assert.equal(row.row,3);assert.deepEqual(row.cells?.map(c=>c.column),[1,2,3]);
  assert.match(row.headers!.join('\n'),/核对要求/);assert.equal(parsed.blocks.find(b=>b.row===1)?.cells?.[1].span,2);assert.match(row.notes!.join(''),/不据此确认验收/);
  assert.ok(parsed.blocks.every(b=>b.page===undefined));assert.ok(parsed.warnings.includes('images_not_parsed'));assert.match(parsed.blocks.at(-1)!.text,/😀/);assert.match(parsed.blocks.at(-1)!.notes!.join(''),/合成脚注/);
  const file:SourceFile={version:1,assetId:'1',hash:'a'.repeat(64),name:'合成.docx',format:'docx',parsed,review:{adminId:'1',at:'2026-10-18T00:00:00Z',excluded:[]}};
  const chunks=await fileChunks(file,async text=>[{text,start:0,end:Array.from(text).length,tokens:100}]);
  const c=chunks.find(c=>c.file.row===3)!;assert.match(c.text,/型号[\s\S]*\n/);assert.match(c.text,/2 mm/);assert.match(c.text,/地暖/);assert.match(c.text,/不据此确认验收/);assert.match(c.file.label,/表1·第3行/);
  assert.equal(Array.from(fileContent(file).body).slice(c.start,c.end).join(''),c.text);
});
test('24-hour format names need an exact authorized XLSX clock quote and cannot license quantities or commitments',async()=>{
  const parsed=await parseSourceFile(syntheticTimeXlsx('1904'),'xlsx');
  const file:SourceFile={version:1,assetId:'1',hash:'a'.repeat(64),name:'合成时刻.xlsx',format:'xlsx',parsed,review:{adminId:'1',at:'2026-10-19T00:00:00Z',excluded:[]}};
  const chunks=await fileChunks(file,async text=>[{text,start:0,end:Array.from(text).length,tokens:150}]);
  const chunk=chunks.find(c=>c.file.sheet==='材料核对'&&c.file.row===3)!;
  const sources=knowledgeSynthesisSources([{ref:{type:'knowledge_chunk',id:'1'},hash:'test',text:chunk.text,file:chunk.file}]);
  const source=sources[0],quote='A3: TEST-A | B3: 2026-10-19 09:30:00 | C3: 13:30:00 | D3: 仅合成定位数据。须先核对厂家资料与实际基层；地暖场景不能直接套用。';
  const parse=(text:string,list=sources,quoted=quote)=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text,citations:[{sourceId:source.sourceId,quote:quoted}]}]}),list);
  const text='原表的参考时刻是2026-10-19 09:30:00和13:30:00，采用24小时制写法。';
  assert.equal(parse(text).segments[0].text,text);
  assert.throws(()=>parse('采用24小时制，施工将在24小时内完成。'),/unsupported_model_commitment/);
  assert.throws(()=>parse('采用24小时制，净宽800毫米。'),/unsupported_model_commitment/);
  assert.throws(()=>parse('采用24小时制，已经验收合格。'),/unsupported_model_commitment/);
  assert.throws(()=>parse(text,sources,'地暖场景不能直接套用。'),/unsupported_model_commitment/);
  for(const changed of [undefined,{...chunk.file,format:'docx' as const},{...chunk.file,parser:'date-v1'}]) {
    const list=[{...source,evidence:{...source.evidence!,file:changed}}];
    assert.throws(()=>parse(text,list),/unsupported_model_commitment/);
  }
  assert.throws(()=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{basis:'advice',text:'采用24小时制，24小时后施工。',citations:[]}]}),sources),/unsupported_model_commitment/);
});

test('quote offsets count Unicode and retain repeated-quote ambiguity',()=>{
  assert.deepEqual(fileQuoteSpans('😀前提；前提','前提',5),{unit:'unicode_code_point_in_indexed_text',ranges:[{start:6,end:8},{start:9,end:11}],occurrences:2,ambiguous:true});
});

test('model file projection preserves complete originals/locators and version identities without repeated copy hints',()=>{
  const text='材料核对\n参考日期：2026-10-19；合成示例不代表项目安排。地暖须核对厂家条件。😀';
  const source={sourceId:'K1',kind:'knowledge',title:'合成日期',text,citationQuote:text,citationQuotes:[text],
    file:{assetId:'1',sourceHash:'a'.repeat(64),parser:'date-v1',blockId:'b1',format:'xlsx',name:'合成.xlsx',
      kind:'table_row',section:['材料核对'],row:3,sheet:'材料核对',range:'A3:D3',label:'工作表「材料核对」 · A3:D3 · 第3行'}};
  const messages:ModelMessage[]=[{role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'1',text:'参考日期是哪天？'})}]},
    {role:'assistant',content:'',toolCalls:[{id:'read',name:'search_knowledge',arguments:'{}'}]},
    {role:'tool',callId:'read',content:JSON.stringify({synthesisSources:[source,
      {...source,sourceId:'K2',file:{...source.file,sourceHash:'b'.repeat(64)}},
      {...source,sourceId:'K3',citationQuote:'2026-10-19',citationQuotes:['2026-10-19']},
      {...source,sourceId:'K4'}],evidence:[{selectionId:'K1',text}]})}];
  const original=JSON.stringify(messages),focused=focusedSynthesisMessages(messages,'1');assertToolPairs(focused);
  const tool=focused.find(m=>m.role==='tool')!;assert.equal(tool.role,'tool');
  const packet=JSON.parse(tool.content);assert.equal(packet.synthesisSources.length,4,'Different original hashes/chunk IDs and nonidentical hints retain distinct sources');
  assert.equal(packet.synthesisSources[0].text,text);assert.equal(packet.synthesisSources[0].citationQuote,undefined);
  assert.equal(packet.synthesisSources[0].citationQuotes,undefined);
  assert.deepEqual(packet.synthesisSources[0].file,{name:source.file.name,label:source.file.label});
  assert.equal(packet.synthesisSources[2].citationQuote,undefined);assert.equal(packet.synthesisSources[2].citationQuotes,undefined);
  assert.equal(packet.synthesisSources[2].text,text);assert.ok(packet.synthesisSources[2].citationOptions[0].citationId,
    'The new catalog replaces copy hints while preserving the complete date, headers, conditions and original');
  assert.deepEqual(packet.evidence,[{selectionId:'K1',text}],'Legacy excerpt identities remain usable');
  assert.equal(JSON.stringify(messages),original,'Durable checkpoints/original file metadata are never modified');
});

test('multi-block file selections reconstruct exact originals including Unicode and sentence spans',async()=>{
  const parsed=await parseSourceFile(syntheticDateXlsx('1904'),'xlsx');
  const file:SourceFile={version:1,assetId:'1',hash:'a'.repeat(64),name:'合成日期.xlsx',format:'xlsx',parsed,
    review:{adminId:'1',at:'2026-10-19T00:00:00Z',excluded:[]}};
  const chunks=await fileChunks(file,async text=>[{text,start:0,end:Array.from(text).length,tokens:100}]);
  const evidence:Evidence[]=chunks.map((chunk,i)=>({ref:{type:'knowledge_chunk',id:String(i+1)},hash:'test',text:chunk.text,file:chunk.file}));
  evidence.push({ref:{type:'knowledge_chunk',id:'99'},hash:'test',text:'😀前提保留。第二句保留例外，不能视为项目安排。'});
  const excerpts=answerExcerpts(evidence),sources=knowledgeSynthesisSources(evidence).map(({evidence:original,...source})=>({...source,...(original?.file?{file:original.file}:{} )}));
  const messages:ModelMessage[]=[{role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'1',text:'原文件怎么写？'})}]},
    {role:'assistant',content:'',toolCalls:[{id:'read',name:'search_knowledge',arguments:'{}'}]},
    {role:'tool',callId:'read',content:JSON.stringify({evidence:excerpts,synthesisSources:sources})}];
  const original=JSON.stringify(messages),view=focusedSynthesisMessages(messages,'1');assertToolPairs(view);
  const packet=JSON.parse((view.find(m=>m.role==='tool') as {content:string}).content);
  assert.ok(packet.selectionLineFormat);assert.ok(packet.evidence.length<excerpts.length);
  let partial=0;
  for(const excerpt of excerpts){
    const retained=packet.evidence.find((e:{selectionId:string})=>e.selectionId===excerpt.selectionId);
    const source=packet.synthesisSources.find((s:{sourceId:string})=>s.sourceId==='K'+excerpt.sourceId);
    assert.equal(source.text,evidence.find(e=>e.ref.id===excerpt.sourceId)!.text);
    if(retained){assert.deepEqual(retained,excerpt);continue;}
    const span=source.selectionLines[excerpt.selectionId],lines=source.text.split('\n');
    const text=Array.isArray(span)?lines[span[0]-1].slice(span[1],span[2]):lines[span-1];
    if(Array.isArray(span))partial++;
    assert.equal(text,excerpt.text);
    assert.equal(parseSelection(JSON.stringify({selections:[excerpt.selectionId]}),evidence).segments[0].text,excerpt.text);
  }
  assert.ok(partial>0,'Sentence spans retain exact UTF16 positions, including emoji before later sentences');
  assert.equal(JSON.stringify(messages),original);
});

test('ambiguous, FAQ and unknown excerpt shapes retain text; custom locators retain coordinates',()=>{
  const long='合成说明保留完整条件和例外，仅用于精确定位，不表示施工安排。'.repeat(8);
  const text=Array.from({length:6},(_,i)=>`独立原行${i}：${long}`).join('\n')+'\n重复原文重复原文\n重复原文\nFAQ答复保留原意';
  const source={sourceId:'K1',kind:'knowledge',title:'合成',text,file:{format:'xlsx',name:'合成.xlsx',section:['材料核对'],sheet:'材料核对',row:3,range:'A3:D3',columns:[1,4],label:'自定义完整定位'}};
  const compactable=text.split('\n').slice(0,6).map((text,i)=>({sourceId:'1',selectionId:`E${i+1}`,text}));
  const retained=[{sourceId:'1',selectionId:'E20',text:'重复原文'},{sourceId:'1',selectionId:'E21',text:'FAQ答复保留原意',question:'原问题'},
    {sourceId:'2',selectionId:'E22',text:long},{sourceId:'1',selectionId:'E23',text:long,extra:'preserve'},
    {sourceId:'1',selectionId:'E24',text:text.split('\n')[0]},{sourceId:'1',selectionId:'E24',text:text.split('\n')[1]}];
  const messages:ModelMessage[]=[{role:'user',content:[{type:'text',text:JSON.stringify({sourceMessageId:'1',text:'原件？'})}]},
    {role:'assistant',content:'',toolCalls:[{id:'read',name:'search_knowledge',arguments:'{}'}]},
    {role:'tool',callId:'read',content:JSON.stringify({evidence:[...compactable,...retained],synthesisSources:[source]})}];
  const view=focusedSynthesisMessages(messages,'1'),packet=JSON.parse((view.find(m=>m.role==='tool') as {content:string}).content);
  assert.deepEqual(packet.evidence,retained);assert.deepEqual(packet.synthesisSources[0].file,source.file);
  const small=structuredClone(messages);(small.at(-1) as {content:string}).content=JSON.stringify({evidence:[compactable[0]],synthesisSources:[source]});
  const smallView=focusedSynthesisMessages(small,'1'),smallPacket=JSON.parse((smallView.find(m=>m.role==='tool') as {content:string}).content);
  const catalog=smallPacket.synthesisSources[0].citationOptions;
  assert.equal(smallPacket.synthesisSources[0].text,text,'Catalog hints never replace the complete original');
  assert.ok(catalog.every((c:{hint?:string;quote?:string})=>c.quote===undefined&&(!c.hint||Array.from(c.hint).length<=25)));
  const withoutCatalog=structuredClone(smallPacket);delete withoutCatalog.synthesisSources[0].citationOptions;
  assert.ok(Buffer.byteLength(JSON.stringify(withoutCatalog))<=Buffer.byteLength((small.at(-1) as {content:string}).content),
    'Projection overhead is limited to the bounded reference catalog rather than duplicated original clauses');
});
test('canonical negative conclusions preserve meaning, source quotes and all positive-claim guards',()=>{
  const sources=[{sourceId:'K1',kind:'knowledge' as const,title:'合成',text:'当前阶段不证明检查通过。'}];
  const segment={basis:'evidence',text:'当前资料不支持“已经验收”这个结论。',citations:[{sourceId:'K1',quote:sources[0].text}]};
  const answer=parseSynthesis(JSON.stringify({kind:'synthesis',segments:[segment,{basis:'uncertainty',text:'仍需核对实际检查记录。'}]}),sources);
  assert.equal(answer.segments[0].text,'当前证据不能支持该结论。');assert.equal(answer.segments[0].citations[0].quote,sources[0].text);assert.deepEqual(answer.segments[1].citations,[]);
  for(const text of ['团队已经验收。','当前资料不支持“已经验收”这个结论。但是团队已经批准。'])assert.throws(()=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{...segment,text}]}),sources),/unsupported_model_commitment/);
  assert.throws(()=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'当前证据不能支持该结论。'}]}),sources),/invalid_model_answer/);
});
test('known file-citation repairs stay in one bounded graph with business tools disabled and durable resume',async()=>{
  const sources=[{sourceId:'K1',kind:'knowledge' as const,title:'合成',text:'TEST-A 2 mm，仅合成示例。',evidence:{ref:{type:'knowledge_chunk',id:'1'},hash:'x',text:'TEST-A 2 mm，仅合成示例。',file:{assetId:'1',sourceHash:'a'.repeat(64),name:'合成.docx',format:'docx' as const,parser:'test',blockId:'b1',kind:'table_row' as const,section:[],label:'表1第1行'}}}];
  const bad=JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'示例是2 mm。',citations:[{sourceId:'K1',quote:'仅合成示例。'}]}]});
  const good=JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'示例是2 mm。',citations:[{sourceId:'K1',quote:sources[0].text}]}]});
  const messages=[{role:'user' as const,content:[{type:'text' as const,text:'合成材料问题'}]}],tools=[{name:'record_need',description:'not during repair',parameters:{}}];
  let checkpoint:AgentCheckpoint|undefined,calls=0;
  const ports={authorize:async()=>{},checkpoint:async(s:AgentCheckpoint)=>{checkpoint=s;},tool:async()=>{throw Error('Business tool must not execute');},
    validateFinal:async(text:string)=>synthesisRepairFeedback(text,sources),model:async(turn:number,_messages:unknown,available:unknown[])=>{
      calls++;if(turn)assert.deepEqual(available,[]);return{text:turn?good:bad,toolCalls:[],usage:null,finishReason:null,providerRequestId:null};}};
  const result=await runRenovationAgent({messages,tools,ports});assert.equal(result.output?.text,good);assert.equal(calls,2);assert.equal(checkpoint!.validationRepairs,1);
  const resumed=await runRenovationAgent({messages,tools,ports,resume:checkpoint});assert.equal(resumed.output?.text,good);assert.equal(calls,2,'Known completed response is not re-dispatched');
  await assert.rejects(runRenovationAgent({messages,tools,ports:{...ports,model:async()=>({text:bad,toolCalls:[],usage:null,finishReason:null,providerRequestId:null})}}),/unsupported_model_commitment/);
  await assert.rejects(runRenovationAgent({messages,tools,ports:{...ports,model:async(turn)=>({text:turn?'':bad,toolCalls:turn?[{id:'forbidden',name:'record_need',arguments:'{}'}]:[],usage:null,finishReason:null,providerRequestId:null})}}),/assistant_capability_forbidden/);
  let unknownCalls=0;await assert.rejects(runRenovationAgent({messages,tools,ports:{...ports,model:async()=>{unknownCalls++;throw Error('provider_outcome_unknown');}}}),/provider_outcome_unknown/);assert.equal(unknownCalls,1);
  assert.throws(()=>synthesisRepairFeedback(JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'已经验收。',citations:[{sourceId:'K1',quote:sources[0].text}]}]}),sources),/unsupported_model_commitment/);
});
test('numeric repair separates a cited document edition from unsupported advice measurements',()=>{
  const text='TEST-A 2 mm，仅合成示例。';
  const sources=[{sourceId:'K1',kind:'knowledge' as const,title:'合成参考手册2.0',text,evidence:{ref:{type:'knowledge_chunk',id:'1'},hash:'x',text,
    file:{assetId:'1',sourceHash:'a'.repeat(64),name:'合成手册2.0.pdf',format:'pdf' as const,parser:'test',blockId:'b1',kind:'paragraph' as const,section:[],page:1,label:'PDF第1页'}}}];
  const raw=JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'按手册2.0，示例为2 mm。',citations:[{sourceId:'K1',quote:text}]},
    {basis:'advice',text:'请核对1500mm和1000mm的测量位置。',citations:[]}]});
  assert.throws(()=>parseSynthesis(raw,sources),/unsupported_model_commitment/);
  const repair=synthesisRepairFeedback(raw,sources)!;assert.equal(repair.code,'unsupported_model_commitment');
  assert.ok(repair.feedback.includes('"numericGaps":[{"segment":2,"unsupportedNumbers":["1500","1000"]}]'));
  assert.ok(!repair.feedback.includes('"path":"segments[0].text"'));
  assert.ok(repair.feedback.includes('"path":"segments[1].text","removeUnsupportedNumbers":["1500","1000"],"permittedQuoteNumbers":[]'));
  const editionOnly={...JSON.parse(raw),segments:[JSON.parse(raw).segments[0]]};
  assert.doesNotThrow(()=>parseSynthesis(JSON.stringify(editionOnly),sources),'Trusted named metadata is not a measurement');
  assert.throws(()=>parseSynthesis(raw,sources),/unsupported_model_commitment/,'Feedback never changes acceptance or original text');
  assert.equal(sources[0].text,text);
});

test('flow PDFs group wrapped clauses without losing conditions, numbers, pages or the original text',async()=>{
  const lines=Array.from({length:10},(_,i)=>[`${i+1}) SYNTHETIC RULE-${i+1}: retain all conditions.`,
    'Wait 48 hours before the test and keep 20mm of water.',
    'Notify the team before starting; inspect every 2-3 hours.',
    'If leakage occurs, stop and recheck before continuing.']).flat();
  const parsed=await parseSourceFile(syntheticPdf(false,4,lines),'pdf');
  assert.equal(parsed.pages,4);assert.ok(parsed.blocks.length<128);assert.match(parsed.parser,/:flow-paragraphs-v1$/);
  for(let page=1;page<=4;page++){
    const blocks=parsed.blocks.filter(b=>b.page===page);
    assert.equal(blocks.map(b=>b.text).join('').replace(/\s/g,''),lines.join('').replace(/\s/g,''),'Every non-whitespace source character remains exactly once on its page');
    const rule=blocks.find(b=>b.text.startsWith('7)'))!;assert.ok(rule);
    assert.match(rule.text,/48 hours/);assert.match(rule.text,/20mm/);assert.match(rule.text,/2-3 hours/);assert.match(rule.text,/If leakage occurs, stop and recheck/);
  }
  const file:SourceFile={version:1,assetId:'1',hash:'a'.repeat(64),name:'合成多页条款.pdf',format:'pdf',parsed,review:{adminId:'1',at:'2026-10-19T00:00:00Z',excluded:[]}};
  const chunks=await fileChunks(file,async text=>[{text,start:0,end:Array.from(text).length,tokens:200}]);
  assert.ok(chunks.every(c=>c.file.page&&c.file.paragraph));
  const c=chunks.find(c=>c.file.page===3&&c.text.startsWith('7)'))!,quote='If leakage occurs, stop and recheck before continuing.';
  const span=fileQuoteSpans(c.text,quote,c.start).ranges[0];assert.equal(Array.from(fileContent(file).body).slice(span.start,span.end).join(''),quote);
});

test('flow PDF grouping never truncates an oversize clause to fit a chunk budget',async()=>{
  const tail='Exception: never omit this original condition.';
  const parsed=await parseSourceFile(syntheticPdf(false,1,['1) '+('original '.repeat(8)),...Array(3).fill('original '.repeat(8)),tail]),'pdf');
  const block=parsed.blocks.find(b=>b.text.startsWith('1)'))!;assert.ok(block.text.length>300);assert.ok(block.text.endsWith(tail));
  const file:SourceFile={version:1,assetId:'1',hash:'a'.repeat(64),name:'合成完整条款.pdf',format:'pdf',parsed,review:{adminId:'1',at:'2026-10-19T00:00:00Z',excluded:[]}};
  await assert.rejects(fileChunks(file,async text=>[{text,start:0,end:Array.from(text).length,tokens:513}]),/knowledge_file_block_limit/);
});

test('PDF preserves actual page numbers and exposes unparsed tables/OCR limitations',async()=>{
  const parsed=await parseSourceFile(syntheticPdf(false,2),'pdf');assert.equal(parsed.pages,2);assert.ok(parsed.blocks.some(b=>b.page===2));assert.match(parsed.blocks.map(b=>b.text).join('\n'),/does not prove inspection passed/);assert.ok(parsed.warnings.includes('pdf_tables_not_structurally_parsed'));
  await assert.rejects(parseSourceFile(syntheticPdf(true),'pdf'),/knowledge_file_ocr_required/);
  const chinese=await parseSourceFile(syntheticChinesePdf(),'pdf');assert.match(chinese.blocks.map(b=>b.text).join(''),/防水施工和检查由团队安排/);assert.equal(chinese.blocks[0].page,1);
});
test('signature/format/archive/size corruption fails honestly without a parser URL',async()=>{
  for(const [fileName,data]of [['bad.pdf',Buffer.from('oops')],['bad.exe',syntheticDocx()],['bad.docx',syntheticPdf()]] as const)assert.throws(()=>uploadedFile({fileName,fileBase64:data.toString('base64'),authorization:'synthetic only'}),/knowledge_file_invalid/);
  await assert.rejects(parseSourceFile(syntheticDocx({unsafe:true}),'docx'),/knowledge_file_unsafe_archive|knowledge_file_parse_failed/);
  await assert.rejects(parseSourceFile(syntheticZip({'word/document.xml':'<!DOCTYPE doc [<!ENTITY x "injected">]><doc>&x;</doc>','[Content_Types].xml':'wordprocessingml.document.main+xml'}),'docx'),/knowledge_file_unsafe_archive/);
  await assert.rejects(parseSourceFile(Buffer.from('%PDF-corrupt'),'pdf'),/knowledge_file_parse_failed/);
});
