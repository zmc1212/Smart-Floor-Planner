import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { recallHistory } from '@/lib/assistant/agent/history';
import { contextBudgetPolicy } from '@/lib/assistant/agent/context-budget';
import { summaryInput, selectedSummary, historySummaryPolicy, historySummaryCapability } from '@/lib/assistant/agent/summary';
import { fingerprint, safeText, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { minimalDialogueProtocol } from '@/lib/assistant/agent/minimal-dialogue';

const prefix = 'synthetic-history-' + (process.env.ASSISTANT_TEST_RUN_ID || randomUUID()), enterprises: string[] = [], users: string[] = [];
let actor: ActorContext, other: ActorContext;
const response = (text = '可以继续比较具体做法。'): ModelTurnOutput => ({ text: JSON.stringify({ kind: 'general', text }), toolCalls: [], usage: { inputTokens: 50, outputTokens: 10 }, finishReason: 'stop', providerRequestId: null });
const recall = (): ModelTurnOutput => ({ ...response(), text: '', toolCalls: [{ id: 'history', name: 'recall_history', arguments: JSON.stringify({ query: '书房隔音' }) }] });
const chat = () => new ConversationService(actor);
const selectSummary: NonNullable<NonNullable<Parameters<typeof processAgentAnswer>[1]>['summary']> = async messages => {
  const packet = messages.find(m => m.role === 'user'); assert.ok(packet && packet.role === 'user');
  const data = JSON.parse(packet.content.find(p => p.type === 'text')!.text);
  const source = data.originals.find((s: { text: string }) => /书房隔音/.test(s.text)) || data.originals[0];
  return { ...response(), toolCalls: [{ id: 'select', name: 'select_history', arguments: JSON.stringify({ messageIds: [source.messageId] }) }] };
};
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i=0;i<2;i++) {
      enterprises.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));
      users.push(String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+i})`);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${enterprises[i]},true,1000,12000000,1000000000,30,'{"runtime":"langgraph-v1","model":"deepseek-flash","providerKey":"deepseek","tools":true,"imageInput":false,"probeVersion":"synthetic-history-v1"}'::jsonb)`);
    }
  });
  actor = { enterpriseId: enterprises[0], principal: { kind: 'user', userId: users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  other = { ...actor, enterpriseId: enterprises[1], principal: { kind: 'user', userId: users[1] } };
});
after(async () => {
  try { await withPlatformTransaction(async tx => { for (const id of enterprises) { await deleteAssistantData(tx,BigInt(id)); await tx.execute(sql`delete from app.enterprises where id=${id}`); }
    for (const id of users) await tx.execute(sql`delete from app.users where id=${id}`); }); } finally { await closePostgresPool(); }
});
async function seed(conversationId: string, text: string, author: 'user'|'assistant' = 'user') {
  return withTenantTransaction(actor.enterpriseId, async tx => {
    if (author === 'user') return appendMessage(tx,actor,conversationId,{ author, content: { version: 1, blocks: [{ type: 'text', text }] } });
    // Labelled synthetic history only. No fabricated provider run or billing.
    const c=await one(tx,sql`update app.assistant_conversations set last_seq=last_seq+1,version=version+1 where enterprise_id=${actor.enterpriseId} and id=${conversationId} returning last_seq`);
    return (await one(tx,sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,content,purpose)
      values(${actor.enterpriseId},${conversationId},${String(c!.last_seq)},'assistant',${JSON.stringify({version:1,blocks:[{type:'text',text}]})}::jsonb,'synthetic.history') returning *`))!;
  });
}
async function longChat() {
  const id = String((await chat().create(randomUUID())).id);
  const source = await seed(id,'书房隔音只考虑不拆墙的做法，晚上十点以后不要使用会震动的设备；如果要拆墙先只比较，不代表我同意。');
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const c=await one(tx,sql`update app.assistant_conversations set last_seq=last_seq+42,version=version+1
      where enterprise_id=${actor.enterpriseId} and id=${id} returning last_seq`);
    await tx.execute(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
      select ${actor.enterpriseId},${id},${String(c!.last_seq)}::bigint-42+n,case when n%2=1 then 'user' else 'assistant' end,
        case when n%2=1 then ${users[0]}::bigint else null end,
        jsonb_build_object('version',1,'blocks',jsonb_build_array(jsonb_build_object('type','text','text',
          case when n%2=1 then '厨房柜体一般怎么选，第' || (n/2) || '个补充问题？' else '先比较防潮、五金维护和清洁。' end))),'synthetic.history'
      from generate_series(1,42) n`);
  });
  return { id, source };
}
async function archivedChat() {
  const id = String((await chat().create(randomUUID())).id);
  const source = await seed(id,'书房隔音只考虑不拆墙的做法，晚上十点以后不要使用会震动的设备；如果要拆墙先只比较，不代表我同意。');
  // The source is outside both the recent-turn and old 60-original digest windows.
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const c=await one(tx,sql`update app.assistant_conversations set last_seq=last_seq+90,version=version+1
      where enterprise_id=${actor.enterpriseId} and id=${id} returning last_seq`);
    await tx.execute(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
      select ${actor.enterpriseId},${id},${String(c!.last_seq)}::bigint-90+n,'user',${users[0]},
        jsonb_build_object('version',1,'blocks',jsonb_build_array(jsonb_build_object('type','text','text',
          '厨房柜体清洁的第' || n || '条合成补充，只作日常保养讨论。'))),'synthetic.history'
      from generate_series(1,90) n`);
  });
  return { id, source };
}
async function ask(id: string, model: Parameters<typeof processAgentAnswer>[1]) {
  const sent = await chat().send(id,randomUUID(),{version:1,blocks:[{type:'text',text:'回到早先书房隔音的话题，我原先的限制是什么？'}]});
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId,sent.runId);
  await processAgentAnswer(lease,model);
  return { sent, lease, run: await chat().run(String(sent.runId)) };
}
test('AG01: >30-message consultation recalls full early conditions, persists refs and reenters without another model call', async () => {
  const { id, source } = await longChat(); let calls=0;
  const result = await ask(id,{model:async(messages,_tools,turn)=>{
    calls++;
    if (!turn) { assert.doesNotMatch(JSON.stringify(messages),/晚上十点/); return recall(); }
    assert.match(JSON.stringify(messages),/晚上十点以后不要/); assert.match(JSON.stringify(messages),/不代表我同意/);
    const tool=messages.find(m=>m.role==='tool');assert.ok(tool&&tool.role==='tool');const source=JSON.parse(tool.content).synthesisSources[0];
    return {...response(),text:JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'你早先限定书房隔音不拆墙，晚上十点以后不用会震动的设备；拆墙只作比较，不表示同意。',citations:[{sourceId:source.sourceId,quote:source.text}]}]})};
  }});
  assert.equal(result.run.status,'succeeded'); assert.equal(calls,2);
  const history = await chat().messages(id), answer=history.items.find(m=>m.authorKind==='assistant'&&safeText(m.content as Parameters<typeof safeText>[0]).includes('早先限定'));
  assert.ok(answer?.available); assert.equal(calls,2);
  const audit = await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select kind,source_refs,input_summary from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} order by step_seq`));
  const refs=audit.find(s=>s.kind==='agent_history_context')!.source_refs as {messageId:string;hash:string}[];
  assert.ok(audit.some(s=>s.kind==='agent_synthesis_context'),'history and synthesis keep separate durable steps');
  assert.equal(refs[0].messageId,String(source.id)); assert.equal(refs[0].hash,fingerprint(source.content));
  for(const step of audit.filter(s=>s.kind==='agent_model')) assert.ok((step.input_summary as {budget:{after:{estimatedTokens:number}}}).budget.after.estimatedTokens<=contextBudgetPolicy.inputBudget);
  assert.equal((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select count(*)::int n from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${id}`)))?.n,45);
});

test('AG01/05: empty original recall ends this run without claiming the customer never said it', async () => {
  const id = String((await chat().create(randomUUID())).id); let calls = 0;
  const result = await ask(id, { model: async (messages, tools, turn) => {
    calls++;
    if (!turn) return recall();
    assert.equal(tools.some(t => t.name === 'recall_history'), false);
    const packet = JSON.parse(messages.find(m => m.role === 'tool')!.content as string);
    assert.deepEqual(packet.sources, []);
    assert.match(packet.instructions, /查询已结束/);
    return response('本次可读取的原话不足以确认书房隔音限制，可以补充你想继续的具体内容。');
  } });
  assert.equal(result.run.status, 'succeeded'); assert.equal(calls, 2);
  const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,capability_name,private_checkpoint
    from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)}`));
  assert.equal(steps.filter(s => s.capability_name === 'recall_history').length, 1);
  assert.deepEqual((steps.find(s => s.kind === 'agent_checkpoint')!.private_checkpoint as { exhaustedTools: string[] }).exhaustedTools, ['recall_history']);
  const reentry = await chat().messages(id);
  assert.ok(reentry.items.some(m => m.available && safeText(m.content as Parameters<typeof safeText>[0]).includes('本次可读取的原话不足')));
  assert.equal(calls, 2);
});
test('AG01: two real Worker threshold crossings retain complete recent turns and all original rows', async () => {
  const id=String((await chat().create(randomUUID())).id);
  for(let i=0;i<16;i++){await seed(id,`问题${i}：`+'厨房柜体只作比较，不能当作购买决定。'.repeat(25));await seed(id,'比较防潮和清洁。'.repeat(15),'assistant');}
  for(let i=0;i<2;i++){
    const result=await ask(id,{model:async()=>response()});assert.equal(result.run.status,'succeeded');
    const step=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select input_summary from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and kind='agent_model'`));
    const diagnostic=(step!.input_summary as {budget:{omittedMessageIds:string[];after:{estimatedTokens:number}}}).budget;
    assert.ok(diagnostic.omittedMessageIds.length>0);assert.ok(diagnostic.after.estimatedTokens<=contextBudgetPolicy.inputBudget);
  }
  assert.equal((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select count(*)::int n from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${id}`)))?.n,36);
});
test('AG07: recall stays within the exact customer and consultation; wildcard characters grant no access',async()=>{
  const a=await longChat(),b=await longChat();await seed(b.id,'书房隔音 FOREIGN_CONSULTATION_SECRET');
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const conversation=await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.id}`);
    const result=await recallHistory(tx,actor,conversation!,'999999999','书房隔音');assert.doesNotMatch(JSON.stringify(result),/FOREIGN_CONSULTATION_SECRET/);
    const wildcard=await recallHistory(tx,actor,conversation!,'999999999','%%__书房');assert.doesNotMatch(JSON.stringify(wildcard),/FOREIGN_CONSULTATION_SECRET/);
  });
  await assert.rejects(new ConversationService(other).messages(a.id),/assistant_resource_not_found/);
});
test('AG07: source change before delivery prevents generated text and later source changes hide derived history',async()=>{
  const a=await longChat();
  const result=await ask(a.id,{model:async(_m,_t,turn)=>{if(!turn)return recall();await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"已按保留策略移除"}]}'::jsonb where enterprise_id=${actor.enterpriseId} and id=${String(a.source.id)}`));return response('不应投递的旧来源回答');}});
  assert.notEqual(result.run.status,'succeeded');assert.doesNotMatch(JSON.stringify(await chat().messages(a.id)),/不应投递的旧来源回答/);
  const b=await longChat();const ok=await ask(b.id,{model:async(_m,_t,turn)=>!turn?recall():response('书房的历史限制应保留。')});assert.equal(ok.run.status,'succeeded');
  const before=await chat().messages(b.id),answer=before.items.find(m=>safeText(m.content as Parameters<typeof safeText>[0])==='书房的历史限制应保留。')!;assert.equal(answer.available,true);
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"已按保留策略移除"}]}'::jsonb where enterprise_id=${actor.enterpriseId} and id=${String(b.source.id)}`));
  assert.equal((await chat().messages(b.id)).items.find(m=>m.id===answer.id)!.available,false);
});
test('AG02/07: a new current correction after recall saves once without inheriting obsolete history dependencies',async()=>{
  const a=await longChat();const first=await ask(a.id,{model:async(_m,_t,turn)=>!turn?recall():response('书房只作不拆墙的比较。')});assert.equal(first.run.status,'succeeded');
  const text='请记录：书房夜间使用电脑，但不用音箱。',sent=await chat().send(a.id,randomUUID(),{version:1,blocks:[{type:'text',text}]});
  const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,sent.runId);
  await processAgentAnswer(lease,{model:async(messages,_tools,turn)=>{
    if(!turn){assert.doesNotMatch(JSON.stringify(messages),/书房只作不拆墙的比较/);return {...response(),text:'',toolCalls:[{id:'save',name:'record_need',arguments:JSON.stringify({room:'书房',field:'devices',value:'书房夜间使用电脑，但不用音箱',quote:'书房夜间使用电脑，但不用音箱'})}]};}
    return response('记下了书房的设备使用需求。');
  }});
  assert.equal((await chat().run(String(sent.runId))).status,'succeeded');
  const c=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.id}`));
  const memory=(c!.entry_snapshot as {agentMemory:{version:number;facts:Array<{status:string;value:string}>}}).agentMemory;
  assert.equal(memory.version,1);assert.equal(memory.facts.filter(f=>f.status==='current').length,1);assert.match(memory.facts[0].value,/不用音箱/);
});
test('AG05: wrong final format after a real source read repairs once without repeating the source tool',async()=>{
  const id=String((await chat().create(randomUUID())).id);let calls=0,key='';
  const result=await ask(id,{model:async(messages,tools,turn)=>{
    calls++;
    if(turn===0)return {...response(),text:'',toolCalls:[{id:'followups',name:'query_followups',arguments:'{}'}]};
    const packet=messages.find(m=>m.role==='tool');assert.ok(packet&&packet.role==='tool');key=JSON.parse(packet.content).resultKey;
    if(turn===1)return response('这里只能按真实事项说明。');
    assert.equal(tools.length,0,'format repair cannot repeat business tools');
    assert.match(JSON.stringify(messages),/只修复最终回复/);
    return {...response(),text:JSON.stringify({kind:'business',resultKey:key})};
  }});
  assert.equal(result.run.status,'succeeded');assert.equal(calls,3);
  const steps=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select kind from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and capability_name='query_followups'`));
  assert.equal(steps.length,1);
});

test('AG01: semantic digest preserves complete early constraints, persists provenance and reenters without a model call', async () => {
  const { id, source } = await longChat(); let summaries=0,answers=0;
  const result=await ask(id,{summary:async(...args)=>{summaries++;return selectSummary(...args);},model:async messages=>{
    answers++;assert.match(JSON.stringify(messages),/historical_original_digest/);assert.match(JSON.stringify(messages),/晚上十点以后不要/);
    assert.match(JSON.stringify(messages),/不代表我同意/);return response('书房只作不拆墙的比较，夜间不用震动设备，不等于同意改造。');
  }});
  assert.equal(result.run.status,'succeeded');assert.equal(summaries,1);assert.equal(answers,1);
  assert.ok((await chat().messages(id)).items.some(m=>m.authorKind==='assistant'&&m.available));
  assert.equal(summaries,1);assert.equal(answers,1);
  const step=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select * from app.assistant_run_steps where enterprise_id=${actor.enterpriseId}
    and run_id=${String(result.sent.runId)} and kind='agent_summary_context'`));
  assert.equal(step?.status,'succeeded');assert.equal((step!.private_checkpoint as {sources:Array<{messageId:string}>}).sources[0].messageId,String(source.id));
  assert.ok((step!.source_refs as Array<{messageId:string}>).some(s=>s.messageId===String(source.id)));
  assert.ok((step!.input_summary as {scopeHash:string}).scopeHash);
});

test('AG01: current-question digest finds a complete original beyond 60 older customer messages', async () => {
  const { id, source } = await archivedChat(); let selections=0,answers=0;
  const result=await ask(id,{summary:async(messages,...args)=>{
    selections++;assert.match(JSON.stringify(messages),/晚上十点以后不要/);
    return selectSummary(messages,...args);
  },model:async messages=>{
    answers++;assert.match(JSON.stringify(messages),/historical_original_digest/);
    assert.match(JSON.stringify(messages),/晚上十点以后不要/);assert.match(JSON.stringify(messages),/不代表我同意/);
    return response('你当时要求书房不拆墙，晚上十点后不用震动设备；拆墙只比较，不表示同意。');
  }});
  assert.equal(result.run.status,'succeeded');assert.equal(selections,1);assert.equal(answers,1);
  const step=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select private_checkpoint,input_summary from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and kind='agent_summary_context'`));
  assert.ok((step!.private_checkpoint as {sources:Array<{messageId:string}>}).sources.some(s=>s.messageId===String(source.id)));
  assert.ok((step!.input_summary as {sourceCount:number}).sourceCount<=60);
  assert.ok((await chat().messages(id)).items.some(m=>m.authorKind==='assistant'&&m.available));
  assert.equal(selections,1);assert.equal(answers,1);
});

test('AG01: directed summary and recall share one identical catalog source without losing either dependency', async () => {
  const {id,source}=await archivedChat();
  const result=await ask(id,{summary:selectSummary,model:async(messages,_tools,turn)=>{
    if(!turn)return recall();
    const packet=messages.find(m=>m.role==='tool');assert.ok(packet?.role==='tool');
    const provided=JSON.parse(packet.content).synthesisSources.find((s:{sourceId:string})=>s.sourceId==='H'+source.id);
    assert.ok(provided?.citationOptions?.length,'choose a server-provided ID without guessing its protocol shape');
    return {...response(),text:JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',
      text:'书房仅比较不拆墙的做法，晚上十点后不用震动设备，比较不表示同意。',citations:[provided.citationOptions[0]]}]})};
  }});
  assert.equal(result.run.status,'succeeded',JSON.stringify(result.run));
  const step=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select source_refs from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and kind='agent_synthesis_context'`));
  const context=step!.source_refs as {sources:Array<{sourceId:string}>;history:Array<{sources:Array<{messageId:string}>}>};
  assert.equal(context.sources.filter(s=>s.sourceId==='H'+source.id).length,1);
  assert.equal(context.history.filter(s=>s.sources.some(h=>h.messageId===String(source.id))).length,2,'both consulted snapshots retain their original withdrawal dependencies');
});

test('AG07: directed digest cannot select another consultation, future message, generated speech or withdrawn need source', async () => {
  const a=await archivedChat(), b=await archivedChat();
  await seed(b.id,'书房隔音 FOREIGN_DIRECTED_SECRET');await seed(a.id,'书房隔音 GENERATED_DIRECTED_SECRET','assistant');
  const cutoff=await seed(a.id,'本轮之后才会出现的分界');
  await seed(a.id,'书房隔音 FUTURE_DIRECTED_SECRET');
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const conversation=await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.id}`);
    const input=await summaryInput(tx,actor,conversation!,String(cutoff.id),String(cutoff.seq),'书房隔音 %%__');
    assert.ok(input);assert.ok(input.sources.some(s=>s.messageId===String(a.source.id)));
    assert.doesNotMatch(JSON.stringify(input),/FOREIGN_DIRECTED_SECRET|GENERATED_DIRECTED_SECRET|FUTURE_DIRECTED_SECRET/);
    assert.ok(input.sources.length<=60);assert.ok(Buffer.byteLength(JSON.stringify(input.sources))<26000);
    assert.equal(input.hasMore,true);
    // A derived need source blocked by a withdrawn current correction must not revive.
    const changed=await seed(a.id,'书房隔音不再作原安排');
    const facts=[{id:'old',room:'书房',field:'devices',value:'旧安排',quote:safeText(a.source.content as Parameters<typeof safeText>[0]),sourceMessageId:String(a.source.id),
      provenance:'customer_statement',status:'superseded',supersedes:null,createdAt:new Date().toISOString()},
    {id:'current',room:'书房',field:'devices',value:'不再作原安排',quote:'书房隔音不再作原安排',sourceMessageId:String(changed.id),
      provenance:'customer_statement',status:'current',supersedes:'old',createdAt:new Date().toISOString()}];
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify({version:2,facts})}::jsonb)
      where enterprise_id=${actor.enterpriseId} and id=${a.id}`);
    await tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回"}]}'::jsonb
      where enterprise_id=${actor.enterpriseId} and id=${String(changed.id)}`);
  });
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const conversation=await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.id}`);
    const input=await summaryInput(tx,actor,conversation!,String(cutoff.id),String(cutoff.seq),'书房隔音');
    assert.ok(input);assert.ok(!input.sources.some(s=>s.messageId===String(a.source.id)));
  });
});

test('AG01: directed recall retains a matching current original crowded out by repeated questions', async () => {
  const {id}=await archivedChat();
  const source=await seed(id,'请记录：书房晚上也会使用电脑，但仍然不使用音箱。');
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const fact={id:'current-source',room:'书房',field:'devices',value:'晚上也会使用电脑，但仍然不使用音箱',
      quote:'书房晚上也会使用电脑，但仍然不使用音箱。',sourceMessageId:String(source.id),provenance:'customer_statement',
      status:'current',supersedes:null,createdAt:new Date().toISOString()};
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify({version:1,facts:[fact]})}::jsonb),last_seq=last_seq+30
      where enterprise_id=${actor.enterpriseId} and id=${id}`);
    await tx.execute(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
      select ${actor.enterpriseId},${id},${String(source.seq)}::bigint+n,'user',${users[0]},
        jsonb_build_object('version',1,'blocks',jsonb_build_array(jsonb_build_object('type','text','text',
          '回顾书房，不拆墙、换位置只作比较是否表示同意改造？第' || n || '次合成追问。'))),'synthetic.history'
      from generate_series(1,30) n`);
    const c=await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${id}`);
    const result=await recallHistory(tx,actor,c!,'999999999','书房 不拆墙 换位置 比较 同意改造');
    assert.ok(result.sources.some(s=>s.messageId===String(source.id)));
    assert.ok(result.sources.length<=4);assert.equal(result.hasMore,true);
    assert.equal(result.sources.find(s=>s.messageId===String(source.id))!.text,safeText(source.content as Parameters<typeof safeText>[0]));
    // A cutoff preceding the correction still excludes it, even when current.
    const before=await recallHistory(tx,actor,c!,String(source.seq),'书房 不拆墙 换位置 比较 同意改造');
    assert.ok(!before.sources.some(s=>s.messageId===String(source.id)));
  });
});

test('AG05: directed current-need recall repairs historical save wording once without inventing a new receipt', async () => {
  const {id}=await archivedChat();
  const source=await seed(id,'请记录：书房晚上使用电脑，但不用音箱。');
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',
    ${JSON.stringify({version:1,facts:[{id:'historical:0',room:'书房',field:'devices',value:'晚上使用电脑，但不用音箱',quote:'书房晚上使用电脑，但不用音箱。',
      sourceMessageId:String(source.id),provenance:'customer_statement',status:'current',supersedes:null,createdAt:new Date().toISOString()}]})}::jsonb)
    where enterprise_id=${actor.enterpriseId} and id=${id}`));
  let calls=0;
  const result=await ask(id,{model:async(messages,tools,turn)=>{
    calls++;
    if(!turn)return recall();
    const cited={sourceId:'H'+source.id,quote:safeText(source.content as Parameters<typeof safeText>[0])};
    if(turn===2){assert.equal(tools.length,0);assert.match(JSON.stringify(messages),/本轮没有新的需求保存回执/);}
    return {...response(),text:JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',
      text:turn===1?'书房夜间用电脑、不用音箱，属于已保存的客户表达。':'当前工作记录中的表达是：书房夜间用电脑，不用音箱。',citations:[cited]}]})};
  }});
  assert.equal(result.run.status,'succeeded');assert.equal(calls,3);
  const steps=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select kind,capability_name,input_summary from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)}`));
  assert.equal(steps.filter(s=>s.capability_name==='recall_history').length,1);
  assert.ok(steps.some(s=>s.kind==='agent_validation'&&(s.input_summary as {scope?:string}).scope==='current_need_receipt_wording'));
  assert.ok(!steps.some(s=>s.kind==='agent_need_write'));
  const c=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${id}`));
  assert.equal((c!.entry_snapshot as {agentMemory:{version:number}}).agentMemory.version,1);
  let failedCalls=0;
  const refused=await ask(id,{model:async(_messages,_tools,turn)=>{
    failedCalls++;if(!turn)return recall();
    return {...response(),text:JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'已保存你的书房设备需求。',
      citations:[{sourceId:'H'+source.id,quote:safeText(source.content as Parameters<typeof safeText>[0])}]}]})};
  }});
  assert.equal(refused.run.status,'failed');assert.equal(refused.run.errorCode,'unsupported_model_commitment');assert.equal(failedCalls,3);
  assert.equal(refused.run.outputMessageId,null,'a repeated false receipt is never delivered');
});

test('AG01: two actual threshold compressions reconstruct from originals without summarizing a prior digest', async () => {
  const id=String((await chat().create(randomUUID())).id);
  const original=await seed(id,'书房隔音不拆墙，晚上不用音箱；换位置只比较，不是同意改造。');
  for(let i=0;i<16;i++){await seed(id,`厨房第${i}问：`+'只作清洁防潮比较，不能当购买决定。'.repeat(25));await seed(id,'合成回复：比较防潮和清洁。'.repeat(15),'assistant');}
  for(let i=0;i<2;i++){
    const result=await ask(id,{summary:async messages=>{assert.doesNotMatch(JSON.stringify(messages),/historical_original_digest/);return selectSummary(messages,[], -2);},
      model:async messages=>{assert.match(JSON.stringify(messages),/书房隔音不拆墙/);return response('保留书房原来的限制。');}});
    assert.equal(result.run.status,'succeeded');
    const steps=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select kind,input_summary,private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)}`));
    const summary=steps.find(s=>s.kind==='agent_summary_context')!;
    assert.ok((summary.input_summary as {omittedRecentMessageIds:string[]}).omittedRecentMessageIds.length>0);
    assert.equal((summary.private_checkpoint as {sources:Array<{messageId:string}>}).sources[0].messageId,String(original.id));
    for(const s of steps.filter(s=>s.kind==='agent_model'))assert.ok((s.input_summary as {budget:{after:{estimatedTokens:number}}}).budget.after.estimatedTokens<=16000);
  }
  assert.equal((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select count(*)::int n from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${id}`)))?.n,37);
});

test('AG01: malformed summary falls back once to original complete turns and recall', async () => {
  const {id}=await longChat();let calls=0;
  const result=await ask(id,{summary:async()=>{calls++;return response('不能当作合法摘要');},model:async messages=>{
    assert.doesNotMatch(JSON.stringify(messages),/historical_original_digest|不能当作合法摘要/);return response('可以回查具体原话。');
  }});
  assert.equal(result.run.status,'succeeded');assert.equal(calls,1);
  const step=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select status,input_summary from app.assistant_run_steps where enterprise_id=${actor.enterpriseId}
    and run_id=${String(result.sent.runId)} and kind='agent_summary_context'`));
  assert.equal(step?.status,'failed');assert.equal((step!.input_summary as {fallback:string}).fallback,'complete_turns_and_recall');
});

test('AG06: a persisted digest is replayed before the graph checkpoint without another summary dispatch', async () => {
  const {id,source}=await longChat();
  const sent=await chat().send(id,randomUUID(),{version:1,blocks:[{type:'text',text:'原先书房隔音的限制是什么？'}]});
  const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,sent.runId);
  const cached={...response(),toolCalls:[{id:'cached-summary',name:'select_history',arguments:JSON.stringify({messageIds:[String(source.id)]})}]};
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const c=await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${id}`);
    const trigger=await one(tx,sql`select seq,content from app.assistant_messages where enterprise_id=${actor.enterpriseId} and id=${String(sent.messageId)}`);
    const first=await one(tx,sql`select id from (select id,seq,author_kind from app.assistant_messages where enterprise_id=${actor.enterpriseId}
      and conversation_id=${id} order by seq desc limit 30) recent where author_kind='user' order by seq limit 1`);
    const input=await summaryInput(tx,actor,c!,String(first!.id),String(trigger!.seq));assert.ok(input);
    const snapshot=selectedSummary(input,cached);
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,source_refs,private_checkpoint,input_summary)
      values(${actor.enterpriseId},${String(sent.runId)},1008,'agent_summary_context',${historySummaryCapability},1,'succeeded',
        ${JSON.stringify(input.sources.map(({messageId,hash,memoryVersion})=>({messageId,hash,memoryVersion})))}::jsonb,
        ${JSON.stringify(snapshot)}::jsonb,${JSON.stringify({scopeHash:input.scopeHash,policy:historySummaryPolicy.version})}::jsonb)`);
  });
  await processAgentAnswer(lease,{summary:async()=>{throw Error('must not redispatch');},model:async messages=>{
    assert.match(JSON.stringify(messages),/historical_original_digest/);return response('沿用原来的比较边界。');}});
  const run=await chat().run(String(sent.runId));assert.equal(run.status,'succeeded',JSON.stringify(run));
});

test('AG07: source change during summary blocks delivery; later withdrawal also hides dependent answers', async () => {
  const a=await longChat();let answered=false;
  const failed=await ask(a.id,{summary:async(...args)=>{
    const result=await selectSummary(...args);await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_messages
      set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回"}]}'::jsonb where enterprise_id=${actor.enterpriseId} and id=${String(a.source.id)}`));return result;
  },model:async()=>{answered=true;return response('不得发送');}});
  assert.notEqual(failed.run.status,'succeeded');assert.equal(answered,false);
  const b=await longChat();const ok=await ask(b.id,{summary:selectSummary,model:async()=>response('摘要相关回答。')});assert.equal(ok.run.status,'succeeded');
  const before=await chat().messages(b.id),answer=before.items.find(m=>safeText(m.content as Parameters<typeof safeText>[0])==='摘要相关回答。')!;assert.equal(answer.available,true);
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回"}]}'::jsonb
    where enterprise_id=${actor.enterpriseId} and id=${String(b.source.id)}`));
  assert.equal((await chat().messages(b.id)).items.find(m=>m.id===answer.id)!.available,false);
  const rebuilt=await ask(b.id,{summary:async(...args)=>{assert.doesNotMatch(JSON.stringify(args[0]),/晚上十点/);return selectSummary(...args);},
    model:async messages=>{assert.doesNotMatch(JSON.stringify(messages),/摘要相关回答|晚上十点/);return response('按当前获权原话重新讨论。');}});
  assert.equal(rebuilt.run.status,'succeeded');
});

test('AG07: summary candidates cannot use a different consultation cutoff or a different tenant', async () => {
  const a=await longChat(),b=await longChat();
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const conversation=await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.id}`);
    await assert.rejects(summaryInput(tx,actor,conversation!,String(b.source.id),'999999999'),/context_changed/);
    const input=await summaryInput(tx,actor,conversation!,String(a.source.id),'999999999');assert.equal(input,null);
  });
  await assert.rejects(new ConversationService(other).messages(a.id),/assistant_resource_not_found/);
});

test('AG02: explicit current correction skips optional summary and persists exactly one source-linked need', async () => {
  const a=await longChat();let summaries=0;
  const sent=await chat().send(a.id,randomUUID(),{version:1,blocks:[{type:'text',text:'请记录：书房夜间使用电脑，但不用音箱。'}]});
  const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,sent.runId);
  await processAgentAnswer(lease,{summary:async()=>{summaries++;return response();},model:async(_m,_t,turn)=>!turn
    ? {...response(),text:'',toolCalls:[{id:'save',name:'record_need',arguments:JSON.stringify({room:'书房',field:'devices',value:'书房夜间使用电脑，但不用音箱',quote:'书房夜间使用电脑，但不用音箱'})}]}
    :response('记下了书房的设备使用需求。')});
  assert.equal((await chat().run(String(sent.runId))).status,'succeeded');assert.equal(summaries,0);
  const c=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.id}`));
  assert.equal((c!.entry_snapshot as {agentMemory:{version:number}}).agentMemory.version,1);
});

test('AG09: tools-disabled consultations do not invoke the optional selector or change their normal reply path', async () => {
  await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings set agent_config=jsonb_set(agent_config,'{tools}','false'::jsonb)
    where enterprise_id=${actor.enterpriseId}`));
  try{
    const {id}=await longChat();let summaries=0;
    const result=await ask(id,{summary:async()=>{summaries++;return response();},model:async messages=>{
      assert.doesNotMatch(JSON.stringify(messages),/historical_original_digest/);return response('沿用普通对话。');}});
    assert.equal(result.run.status,'succeeded');assert.equal(summaries,0);
  }finally{
    await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings set agent_config=jsonb_set(agent_config,'{tools}','true'::jsonb)
      where enterprise_id=${actor.enterpriseId}`));
  }
});

test('ordinary dialogue recalls original history on demand without spending an optional summary call', async () => {
  const before=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`));
  try {
    await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings
      set agent_config=${JSON.stringify({...before!.agent_config as object,providerKey:'dashscope',model:'qwen3.7-flash',probeVersion:minimalDialogueProtocol,enterpriseKnowledgeEnabled:false})}::jsonb,
        policy_version=policy_version+1 where enterprise_id=${actor.enterpriseId}`));
    const {id}=await longChat();let summaries=0,calls=0;
    const result=await ask(id,{summary:async()=>{summaries++;throw Error('Ordinary dialogue must use lazy history recall');},model:async(messages,_tools,turn)=>{
      calls++;
      if(!turn)return recall();
      assert.match(JSON.stringify(messages),/晚上十点以后不要使用会震动的设备/);
      const receipt=messages.findLast(message=>message.role==='tool');assert.ok(receipt&&receipt.role==='tool');
      const source=JSON.parse(receipt.content).synthesisSources[0];
      return {...response(),text:JSON.stringify({kind:'synthesis',segments:[{basis:'evidence',text:'你早先限定书房隔音不拆墙，夜间不使用会震动的设备；拆墙只作比较，不表示同意。',citations:[{sourceId:source.sourceId,quote:source.text}]}]})};
    }});
    assert.equal(result.run.status,'succeeded');assert.equal(summaries,0);assert.equal(calls,2);
    const steps=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select kind from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)}`));
    assert.equal(steps.filter(step=>step.kind==='agent_summary_context').length,0);
  } finally {
    await withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(before!.agent_config)}::jsonb,
      policy_version=policy_version+1 where enterprise_id=${actor.enterpriseId}`));
  }
});
