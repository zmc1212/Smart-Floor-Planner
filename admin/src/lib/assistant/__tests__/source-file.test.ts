import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticDocx, syntheticPdf, syntheticZip, syntheticChinesePdf } from '../../../../scripts/assistant-file-fixtures';
import { parseSourceFile, uploadedFile, fileContent, fileChunks, fileQuoteSpans } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';
import { parseSynthesis, synthesisRepairFeedback } from '../agent/synthesis';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';

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
test('quote offsets count Unicode and retain repeated-quote ambiguity',()=>{
  assert.deepEqual(fileQuoteSpans('😀前提；前提','前提',5),{unit:'unicode_code_point_in_indexed_text',ranges:[{start:6,end:8},{start:9,end:11}],occurrences:2,ambiguous:true});
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
