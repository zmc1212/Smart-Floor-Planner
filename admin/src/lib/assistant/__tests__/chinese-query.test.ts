import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chineseQueryTerms,chineseTerms,expandChineseQuery,fuseAuthorizedCandidates,queryExpansionConfiguration,queryLexicalScore } from '../knowledge/chinese-lexical';
test('contract-signing paraphrases match existing indexed signing terms without a reindex',()=>{
  for(const query of ['签装修合同之前重点看什么？','订立装修合同要检查什么？','施工协议签署要注意哪些条款？'])assert.ok(chineseQueryTerms(query).includes('签约'));
  assert.ok(!chineseQueryTerms('合同约定工期多长？').includes('签约'));
  assert.deepEqual(chineseTerms('签约前确认公司主体'),chineseQueryTerms('签约前确认公司主体'));
  const rows=[{id:'1',distance:.4,terms:chineseTerms('签约前确认公司主体、施工范围、材料清单、付款方式、违约责任和争议处理条款。')},
    {id:'2',distance:.5,terms:chineseTerms('合同约定开工和竣工日期。')},
    {id:'3',distance:.55,terms:chineseTerms('装修完成后持续通风。')}];
  assert.equal(fuseAuthorizedCandidates(rows,'签装修合同之前重点看什么？',1)[0].id,'1');
});

test('K01 alternate professional spellings find literal terms in existing indexes',()=>{
  const cases=[
    ['瓷砖黏结剂要核对什么？','瓷砖胶'],
    ['瓷砖粘合剂的资料在哪里？','瓷砖粘结剂'],
    ['蓄水测试需要先核对什么？','闭水试验'],
    ['闭水实验的记录在哪里？','蓄水试验'],
    ['卫生间等电位连接要问谁？','等电位联结'],
    ['墙面批腻子前检查什么？','刮腻子'],
  ];
  for(const [question,source] of cases){
    const oldIndex=chineseTerms(source),before=new Set(chineseTerms(question)),expanded=expandChineseQuery(question);
    assert.ok(oldIndex.some(t=>!before.has(t)&&expanded.terms.includes(t)),question);
    assert.ok(expanded.originalTerms.every(t=>expanded.terms.includes(t)));
    assert.ok(expanded.expansion.matches.some(m=>m.addedTerms.length));
  }
});

test('K01 lexical alternatives improve recall without replacing exact question terms',()=>{
  const query=expandChineseQuery('等电位连接');
  assert.ok(queryLexicalScore(chineseTerms('等电位联结'),query)>queryLexicalScore(chineseTerms('等电位联结'),{...query,expansion:{...query.expansion,addedTerms:[]}}));
  const rows=[{id:'1',distance:.4,terms:chineseTerms('等电位连接')},{id:'2',distance:.4,terms:chineseTerms('等电位联结')}];
  assert.ok(queryLexicalScore(rows[0].terms,query)>queryLexicalScore(rows[1].terms,query));
  assert.equal(fuseAuthorizedCandidates(rows,query,1)[0].id,'1');
  assert.equal(queryLexicalScore(['连接'],query),queryExpansionConfiguration.originalWeight);
  assert.equal(queryLexicalScore(['联结'],query),queryExpansionConfiguration.expandedWeight);
});

test('K01 full-width/spaced explicit adhesive designations preserve every grade suffix',()=>{
  const query=expandChineseQuery('Ｃ ２ Ｔ Ｅ Ｓ ２ 瓷砖胶');
  assert.ok(query.expansion.addedTerms.includes('c2tes2'));
  assert.ok(!query.expansion.addedTerms.some(t=>['c1','c2','c2te','c2tes1'].includes(t)));
  assert.ok(query.expansion.matches.some(m=>m.rule==='adhesive_designation_spacing'&&m.matched==='c 2 t e s 2'));
  for(const q of ['ABC2TEX','C20','C 20','C2 TE100','C2-TEX','C 2 TE100','C 2 T E S 3','C 2 T E S 22','C 2-TE','C 2 T E / 100']){
    assert.ok(!expandChineseQuery(q).expansion.matches.some(m=>m.rule==='adhesive_designation_spacing'),q);
  }
});

test('K01 expansion never equates different materials, tests or grade numbers',()=>{
  for(const q of ['瓷砖背胶怎么用？','填缝剂怎么选？','水压试验检查什么？','卫生间渗水了','型号ABC-123']){
    assert.deepEqual(expandChineseQuery(q).expansion.addedTerms,[],q);
  }
  const query=expandChineseQuery('瓷砖粘结剂 C1');
  assert.ok(!query.terms.includes('背胶')&&!query.terms.includes('c2'));
  assert.ok(!query.expansion.addedTerms.some(t=>t.startsWith('renovation:')));
});

test('K01 query expansion has deterministic budgets and retains the unexpanded fallback',()=>{
  const codes=[];for(const grade of ['1','2'])for(const suffix of ['','T','E','T E'])for(const deform of ['','S 1','S 2'])codes.push(`C ${grade} ${suffix} ${deform}`.trim());
  const query='签订装修合同，瓷砖胶闭水试验等电位连接批腻子 '+codes.join('，');
  const expanded=expandChineseQuery(query);
  assert.ok(expanded.expansion.matches.length<=queryExpansionConfiguration.maxRules);
  assert.ok(expanded.expansion.addedTerms.length<=queryExpansionConfiguration.maxAddedTerms);
  assert.equal(new Set(expanded.terms).size,expanded.terms.length);
  assert.deepEqual(expanded,expandChineseQuery(query));
  assert.deepEqual(expandChineseQuery('没有登记术语的问题').terms,chineseTerms('没有登记术语的问题'));
  assert.deepEqual(expandChineseQuery('').terms,[]);
});
