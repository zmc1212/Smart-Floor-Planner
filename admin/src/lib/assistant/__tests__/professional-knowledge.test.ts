import assert from 'node:assert/strict';
import { test } from 'node:test';
import { content } from '../knowledge/service';
import { applicability, professionalKnowledge } from '../knowledge/professional';
import { knowledgeSynthesisSources, unresolvedSynthesisConflict, parseSynthesis } from '../agent/synthesis';
import { professionalEntry } from '../../../../scripts/assistant-professional-cases';

const stamp={adminId:'17',reviewedAt:'2026-10-18T00:00:00.000Z'};
const entry=(overrides:Record<string,unknown>={})=>professionalKnowledge(professionalEntry(overrides),stamp)!;
test('metadata is versioned content, preserves units/exceptions and legacy hashes',()=>{
  const legacy=content('manual_text',{body:'基层检查后再施工。'}),p=entry({conditions:[{field:'material',operator:'in',values:['C2TE S1']}],exceptions:['标注单位为毫米，温度条件待核实']});
  assert.equal(legacy.hash,content('manual_text',{body:'基层检查后再施工。',professional:null}).hash);
  const current=content('manual_text',{body:'基层检查后再施工。',professional:p});assert.notEqual(current.hash,legacy.hash);assert.match(current.rendered,/C2TE S1/);assert.match(current.rendered,/温度条件待核实/);assert.doesNotMatch(current.rendered,/INTERNAL_KB_REVIEW_NOTE/);
  assert.notEqual(current.hash,content('manual_text',{body:'基层检查后再施工。',professional:entry({origin:{...p.origin,version:'synthetic-v2'}})}).hash);
});
test('missing context differs from explicit non-applicability, including exclusions',()=>{
  const p=entry({conditions:[{field:'stage',operator:'in',values:['waterproofing']}]});
  assert.equal(applicability(p,{}).status,'unknown');assert.deepEqual(applicability(p,{}).missing,['实际阶段']);
  assert.equal(applicability(p,{stage:'utilities'}).status,'not_applicable');assert.equal(applicability(p,{stage:'waterproofing'}).status,'applicable');
  const excluded=entry({conditions:[{field:'stage',operator:'not_in',values:['utilities']}]});assert.equal(applicability(excluded,{stage:'utilities'}).status,'not_applicable');
  assert.equal(applicability(entry({conditions:[{field:'room',operator:'in',values:['书房']}]}),{stage:'utilities'}).status,'unknown');
});
test('untrusted fields, malformed conditions, oversized metadata and empty authority fail closed',()=>{
  for (const changes of [{unknown:'injection'}, {conditions:[{field:'tenant',operator:'in',values:['all']}]},{conditions:[{field:'stage',operator:'in',values:[]}]},
    {origin:{title:'',version:'v1',locator:'a',authority:'reference'}},{prerequisites:['x\0y']}, {claim:{key:'a',value:''}},
    {conditions:[{field:'stage',operator:'in',values:['a']},{field:'stage',operator:'in',values:['b']}]}])assert.throws(()=>entry(changes),/invalid_professional_knowledge/);
  assert.equal(professionalKnowledge({...professionalEntry(),review:{note:'核对完成',adminId:'999',reviewedAt:'2099-01-01'}},stamp)!.review.adminId,'17');
  assert.equal(professionalKnowledge({...professionalEntry(),review:{note:'出处已核对\n例外仍需保留'}},stamp)!.review.note,'出处已核对\n例外仍需保留');
});
test('explicit incompatible claims require uncertainty without depending on conflict marker prose',()=>{
  const evidence=(id:string,value:string,status:'unknown'|'not_applicable'='unknown')=>({ref:{type:'knowledge_chunk',id,version:'1'},hash:'h',text:'办公屏幕方向须核对眩光。',professional:{documentId:id,title:'测试',contentHash:'h',entry:entry({claim:{key:'屏幕朝向',value}}),applicability:{status,matched:[],missing:[],mismatched:[]},context:{}}});
  const a=evidence('1','侧放'),b=evidence('2','正对窗');assert.equal(unresolvedSynthesisConflict(knowledgeSynthesisSources([a,b])),true);
  assert.equal(unresolvedSynthesisConflict(knowledgeSynthesisSources([a,evidence('3','正对窗','not_applicable')])),false);
  assert.throws(()=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'应当侧放。',citations:[{sourceId:'K1',quote:'办公屏幕方向须核对眩光。'}]}]}),knowledgeSynthesisSources([a,b])),/unresolved_evidence_conflict/);
});
