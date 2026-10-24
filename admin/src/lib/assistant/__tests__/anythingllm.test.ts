import test from 'node:test';
import assert from 'node:assert/strict';
import { anythingLlmMessages, anythingLlmPrompt, anythingLlmToolPolicy, assertAnythingLlmAction, designerQuoteAllowed, knowledgeQuery, type AnythingLlmContext } from '../integrations/anythingllm';

test('follow-up retrieval preserves customer intent without accepting external assistant history', () => {
  const messages = [{ id: '1', text: '我家预算10万，地暖先不做。你们量房大概要多久？' },
    { id: '2', text: '量房的时间还是之前说的那样吗？' }];
  assert.match(knowledgeQuery(messages), /量房大概要多久/);
  const context: AnythingLlmContext = { epoch: 2, sourceSeq: '2', version: 2, customerMessages: messages,
    historyTruncated: false, requirements: { latest: null, confirmed: null }, knowledge: [] };
  const prompt = anythingLlmPrompt(context);
  assert.ok(!prompt.includes('90分钟'));
  assert.ok(prompt.includes('地暖先不做'));
  assert.ok(prompt.includes('"knowledge":[]'));
  const toolCall = {role:'assistant',content:null,tool_calls:[{id:'call-1',function:{name:'request_designer',arguments:'{}'}}]};
  const toolResult = {role:'tool',tool_call_id:'call-1',content:'{"state":"waiting"}'};
  const projected = anythingLlmMessages(context, [{role:'system',content:prompt}, {role:'user',content:messages[0].text},
    {role:'assistant',content:'以前量房90分钟，草稿已生成'}, {role:'user',content:messages[1].text}, toolCall, toolResult]);
  assert.deepEqual(projected.slice(1,3), messages.map(m=>({role:'user',content:m.text})));
  assert.strictEqual(projected.at(-2),toolCall); assert.strictEqual(projected.at(-1),toolResult);
  assert.ok(!JSON.stringify(projected).includes('以前量房90分钟'));
  assert.throws(()=>anythingLlmMessages(context,[{role:'user',content:'另一条会话的问题'}]),/context_changed/);
});

test('explicit handoff cannot finish as a prose-only success before the real service receipt', () => {
  const text = '我想直接跟设计师聊，帮我联系一下。';
  const context: AnythingLlmContext = {epoch:2,sourceSeq:'3',version:4,customerMessages:[{id:'3',text}],
    historyTruncated:false,requirements:{latest:null,confirmed:null},knowledge:[]};
  const policy = anythingLlmToolPolicy(context,false);
  assert.deepEqual(policy.tool_choice,{type:'function',function:{name:'sfp-renovation'}});
  assert.throws(()=>assertAnythingLlmAction(context,false,{}),/required_action_not_executed/);
  assert.throws(()=>assertAnythingLlmAction(context,false,{tool_calls:[{function:{name:'sfp-renovation',arguments:'{"action":"read_project"}'}}]}),/required_action_not_executed/);
  assert.doesNotThrow(()=>assertAnythingLlmAction(context,false,{tool_calls:[{function:{name:'sfp-renovation',arguments:JSON.stringify({action:'request_designer',quote:text})}}]}));
  assert.deepEqual(anythingLlmToolPolicy(context,true),{tool_choice:'none'});
  assert.doesNotThrow(()=>assertAnythingLlmAction(context,true,{}));
  assert.deepEqual(anythingLlmToolPolicy({...context,customerMessages:[{id:'3',text:'不要联系设计师'}]},false),{});
});

test('real natural handoff requires a current direct request, not negation, quotation or a hypothetical', () => {
  for (const text of ['我想直接跟设计师聊，帮我联系一下。', '帮我联系一下设计师', '找个设计师聊聊', '转人工']) {
    assert.equal(designerQuoteAllowed(text, text), true, text);
  }
  for (const text of ['不要帮我联系设计师', '如果要装修再帮我联系设计师', '我问过“帮我联系设计师”是什么意思',
    '是不是需要找设计师', '先别联系设计师', '朋友说：帮我联系设计师', '帮我联系设计师，但我不想分享对话']) {
    assert.equal(designerQuoteAllowed(text, text), false, text);
  }
  assert.equal(designerQuoteAllowed('我的预算10万', '帮我联系设计师'), false);
  assert.equal(designerQuoteAllowed('朋友说：帮我联系设计师', '帮我联系设计师'), false);
  assert.equal(designerQuoteAllowed('之前说过帮我联系设计师，现在先算了', '帮我联系设计师'), false);
});
