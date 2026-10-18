import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chineseQueryTerms,chineseTerms,fuseAuthorizedCandidates } from '../knowledge/chinese-lexical';
test('contract-signing paraphrases match existing indexed signing terms without a reindex',()=>{
  for(const query of ['签装修合同之前重点看什么？','订立装修合同要检查什么？','施工协议签署要注意哪些条款？'])assert.ok(chineseQueryTerms(query).includes('签约'));
  assert.ok(!chineseQueryTerms('合同约定工期多长？').includes('签约'));
  assert.deepEqual(chineseTerms('签约前确认公司主体'),chineseQueryTerms('签约前确认公司主体'));
  const rows=[{id:'1',distance:.4,terms:chineseTerms('签约前确认公司主体、施工范围、材料清单、付款方式、违约责任和争议处理条款。')},
    {id:'2',distance:.5,terms:chineseTerms('合同约定开工和竣工日期。')},
    {id:'3',distance:.55,terms:chineseTerms('装修完成后持续通风。')}];
  assert.equal(fuseAuthorizedCandidates(rows,'签装修合同之前重点看什么？',1)[0].id,'1');
});
