import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {proseNumberView,groundedNumberTokens} from '../agent/prose-number-view';
import {parseSynthesis,type SynthesisSource} from '../agent/synthesis';
import {reportAnswerSynthesis,reportQuestionCoverage} from '../agent/report-final';

const reply=(text:string)=>JSON.stringify({kind:'synthesis',segments:[{basis:'advice',text,citations:[]}]});

test('printed thousands separators preserve exact decimal grounding in both directions',()=>{
  const check=(text:string,quote:string)=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{
    basis:'evidence',text,citations:[{sourceId:'K1',quote}],
  }]}),[{sourceId:'K1',kind:'knowledge',title:'原始预算',text:quote}]);
  assert.deepEqual(groundedNumberTokens('12,522.25 / 1,234,567.00 / 12,52.25'),['12522.25','1234567.00','12','52.25']);
  for(const [text,quote] of [['瓷砖小计12,522.25元。','瓷砖小计12522.25元。'],
    ['瓷砖小计12522.25元。','瓷砖小计12,522.25元。']])
    assert.equal(check(text,quote).segments[0].text,text);
  for(const text of ['瓷砖小计12,523.25元。','瓷砖小计12,52.25元。','瓷砖小计12522.250元。','瓷砖小计12,522.25元，已付款。'])
    assert.throws(()=>check(text,'瓷砖小计12522.25元。'),/unsupported_model_commitment/,text);
});

test('CommonMark ordered-list markers are presentation, while original prose and source-free advice stay unchanged',()=>{
  for(const text of ['可比较：\n1. 脚感与清洁习惯。\n2. 核对厂家适用条件。\n3. 未知现场仍需核对。',
    '😀先看需求：\n1) **脚感**与清洁习惯。\n2) 地暖型号待核对。',
    '1. 先核对产品。\n   1. 保留条件与例外。\n   2. 保留独立需求。\n2. 现场仍需核对。']){
    const view=proseNumberView(text);assert.equal(view.length,text.length);assert.equal(/\d/.test(view),false);
    assert.equal(parseSynthesis(reply(text),[]).segments[0].text,text);
  }
});

test('item quantities, ambiguous unit prefixes, dates, decimals, code and completion claims retain every original guard',()=>{
  for(const text of ['1. 现场温度为27℃。','1. **27毫米**就能施工。','1. ℃为现场温度。','1. `mm`可以满足要求。',
    '1. 米足够施工。','1. 费用300元。','1. 等待三天。','1. 于2027年完成。','1.5米足够。','1)27毫米足够。',
    '```\n1. 现场温度为27℃。\n```','1. 已付款。','1. 保证承重安全。'])
    assert.throws(()=>parseSynthesis(reply(text),[]),/unsupported_model_commitment/,text);
  assert.equal(proseNumberView('这是第3项工艺要求。'),'这是第3项工艺要求。');
  assert.match(proseNumberView('1. 核对27℃要求。'),/27℃/);
});

test('plain inline-list grammar annotates only consecutive decorations and retains all body claims',()=>{
  for(const text of ['待核实：1. 地板型号；2. 设备类型；3. 基层状态；4. 匹配条件。',
    '😀仍有条件： 1) 核对原件; 2) 现场待核实。']){
    assert.equal(proseNumberView(text).length,text.length);
    assert.doesNotMatch(proseNumberView(text),/\d/);
    assert.equal(parseSynthesis(reply(text),[]).segments[0].text,text);
  }
  for(const text of ['条件：1. 现场27℃；2. 干燥。','条件：1. 米足够；2. 可以施工。',
    '条件：1. 型号；3. 状态。','条件：01. 型号；02. 状态。','条件：1.5米；2.5米。',
    '条件：1. 型号；2) 状态。','条件：1. 等三天；2. 已验收。',
    '`条件：1. 型号；2. 状态。`','> 条件：1. 型号；2. 状态。'])
    assert.throws(()=>parseSynthesis(reply(text),[]),/unsupported_model_commitment/,text);
  assert.match(proseNumberView('条件：1. 温度27℃；2. 含水率1.5%。'),/27℃/);
});

test('run10419 bold labels in a consecutive inline list leave item claims and the displayed prose intact',()=>{
  const text='结合当前项目进度（客餐厅），建议您重点检查：1. **平面布局**是否保留了原有餐边柜等固定设施；2. **插座/开关点位**在两张图上的位置是否一致，如有不同需请设计师再次核对确认。';
  assert.equal(proseNumberView(text).length,text.length);
  assert.doesNotMatch(proseNumberView(text),/\d/);
  assert.equal(parseSynthesis(reply(text),[]).segments[0].text,text);
  for(const invalid of ['核对：1. **毫米**够用；2. **型号**要一致。','核对：1. **温度27℃**；2. **型号**。',
    '核对：1. **户型**；2. **已验收**。','核对：1. **型号；2. 位置**。','核对：1. **型号**；3. **位置**。',
    '核对：1. `型号`；2. **位置**。'])
    assert.throws(()=>parseSynthesis(reply(invalid),[]),/unsupported_model_commitment/,invalid);
});

test('a natural Chinese date is the same recorded day as the source "09", while another day stays unsupported',()=>{
  const source={sourceId:'K1',kind:'knowledge' as const,title:'日报阶段原文',text:'报告周期内团队标记阶段：2026-11-09 22:32:10，安装；2026-11-09 22:48:24，软装。'};
  const check=(text:string)=>parseSynthesis(JSON.stringify({kind:'synthesis',segments:[{
    basis:'evidence',text,citations:[{sourceId:'K1',quote:'2026-11-09 22:32:10，安装'}],
  }]}),[source]);
  assert.equal(check('团队在2026年11月9日22:32标记了安装阶段。').segments[0].text,'团队在2026年11月9日22:32标记了安装阶段。');
  assert.equal(check('团队在11月9日标记了安装阶段。').segments[0].text,'团队在11月9日标记了安装阶段。');
  for(const text of ['团队在11月15日标记了安装阶段。','团队在2026年11月9日22:33标记了安装阶段。'])
    assert.throws(()=>check(text),/unsupported_model_commitment/,text);
});

test('Unicode sentence boundaries and CommonMark item structure distinguish inline question ordinals from quantities',()=>{
  for(const text of ['建议先问：1. 回路设计是否确定？2. 何时能够核对？3. 有更新安排吗？仍须团队确认。',
    '😀核对： 1) 位置正确吗？ 2) 条件是否适用？',
    '可询问：1. 材料适用性待核实。2. 产品说明待核对。3. 现场条件仍未知。']){
    const view=proseNumberView(text);assert.equal(view.length,text.length);assert.doesNotMatch(view,/\d/);
    assert.equal(parseSynthesis(reply(text),[]).segments[0].text,text);
  }
  for(const text of ['建议先问：1. 回路设计是否确定？3. 有更新安排吗？',
    '建议先问：01. 位置对吗？02. 条件对吗？','建议先问：1. 位置对吗？2) 条件对吗？',
    '建议先问：1. 米够吗？2. 可以施工吗？','建议先问：1. 位置对吗？2. ℃合适吗？',
    '建议先问：1. 现场27℃可以施工吗？2. 要等三天吗？',
    '建议先问：1. 位置对吗？2. 已验收。','建议先问：1. 位置对吗？2. 将于2027年完工。',
    '`建议先问：1. 位置对吗？2. 条件对吗？`','> 建议先问：1. 位置对吗？2. 条件对吗？'])
    assert.throws(()=>parseSynthesis(reply(text),[]),/unsupported_model_commitment/,text);
  assert.match(proseNumberView('建议先问：1. 27℃满足要求吗？2. 厚度3.2mm够吗？'),/27℃/);
  assert.match(proseNumberView('建议先问：1. 27℃满足要求吗？2. 厚度3.2mm够吗？'),/3\.2mm/);
});

test('saved1947 first final and sole repair retain their complete prose and catalog citations after ordinal analysis',()=>{
  const saved: {question:string;sources:SynthesisSource[];frames:Array<{step:number;raw:string}>}=
    JSON.parse(readFileSync(new URL('./fixtures/report-inline-ordinals.json',import.meta.url),'utf8'));
  const before=structuredClone(saved);
  for(const frame of saved.frames){
    const normalized=reportAnswerSynthesis(frame.raw,reportQuestionCoverage(saved.question));
    const answer=parseSynthesis(normalized,saved.sources,{currentQuestion:saved.question});
    assert.deepEqual(answer.segments.map(s=>s.text),JSON.parse(normalized).segments.map((s:{text:string})=>s.text));
    assert.ok(answer.segments.every(s=>s.citations.length===1));
  }
  assert.deepEqual(saved,before);
});
