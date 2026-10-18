import test from 'node:test';
import assert from 'node:assert/strict';
import {checkKnowledgeEvaluation} from '../knowledge/evaluation-check';
import {businessSynthesisSource} from '../agent/synthesis';
import type {BusinessSnapshot} from '../agent/business-tools';
const source={documentId:'12',versionId:'23',hash:'a'.repeat(64)};
const base={expectation:{kind:'grounded' as const,requiredDocumentIds:['12'],forbiddenDocumentIds:[]},required:[source],selected:['23'],recalled:['23'],cited:['23'],status:'succeeded',answerKind:'grounded',diagnosticAvailable:true};
test('recall alone cannot pass selection, citation, version, or semantic review',()=>{
  const r=checkKnowledgeEvaluation(base);assert.equal(r.passed,true);assert.equal(r.semanticCorrectness,'requires_review');
  for(const change of [{selected:[]},{cited:[]},{recalled:[]},{cited:['22']},{answerKind:'insufficient_evidence'},{status:'failed'},{diagnosticAvailable:false}])assert.equal(checkKnowledgeEvaluation({...base,...change}).passed,false);
});
test('expected missing evidence is a separate result, never positive-answer coverage',()=>{
  const input={...base,expectation:{kind:'missing' as const,requiredDocumentIds:[],forbiddenDocumentIds:['99']},required:[],selected:[],recalled:[],cited:[],answerKind:'insufficient_evidence'};
  assert.equal(checkKnowledgeEvaluation(input).passed,true);assert.equal(checkKnowledgeEvaluation({...input,answerKind:'grounded'}).passed,false);
});
test('missing home-material snapshots keep their evidence but cannot claim consulted drawings/records in a footer',()=>{
  const snapshot={query:{domain:'materials'},data:{resolution:'missing',sources:[]},displayText:'目前没有可关联的本人房屋档案，可以继续聊装修想法。'} as unknown as BusinessSnapshot;
  const missing=businessSynthesisSource('missing',snapshot);assert.equal(missing.summaryTitle,null);assert.equal(missing.text,snapshot.displayText);assert.ok(missing.citationQuotes?.length);
  for(const [types,title]of [[['customer_need'],'本咨询原话'],[['formal_floorplan'],'正式户型'],[['site_record'],'已发布现场资料'],[['customer_need','formal_floorplan','site_record'],'本咨询原话、正式户型与已发布现场资料']] as const){
    const present={...snapshot,data:{sources:types.map(type=>({ref:{type}}))}} as unknown as BusinessSnapshot;
    assert.equal(businessSynthesisSource('present',present).summaryTitle,title);
  }
});
