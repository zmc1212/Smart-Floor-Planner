import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proseNumberView} from '../agent/prose-number-view';
import {parseSynthesis} from '../agent/synthesis';

const reply=(text:string)=>JSON.stringify({kind:'synthesis',segments:[{basis:'advice',text,citations:[]}]});

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
