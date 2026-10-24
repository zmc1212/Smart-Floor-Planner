import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { searchWeb, type WebQuery } from '@/lib/assistant/agent/web';
import { reserveConsultationDispatch, settleConsultationDispatch } from '@/lib/assistant/agent/consultation-usage';
import { searchPublicResearch, publicReaderParser } from '@/lib/assistant/agent/public-research';
import { consultationAcceptanceProfile as profile, consultationLongProfile, consultationCashAuthorization,
  consultationTariffVersion } from '@/lib/assistant/contracts/consultation';
import type { ConsultationBinding, MeteredConsultationBinding } from '@/lib/assistant/agent/consultation-profile';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const prefix = 'synthetic-consultation-' + randomUUID();
const fixtures: Array<{ enterpriseId: string; userId: string; conversationId: string }> = [];
const binding: ConsultationBinding = { profile: profile.id, stage: 'R1', budgetGroup: prefix,
  quota: { model: profile.model, quotaOnly: true, remainingTokens: 400000, observedTokensAtVerification: 0, verifiedAt: new Date().toISOString() } };
const config = { runtime: 'langgraph-v1', providerKey: 'bailian', model: profile.model, tools: true, imageInput: false, probeVersion: 'synthetic-no-provider', consultation: binding };
const actor = (fixture = fixtures[0]): ActorContext => ({ enterpriseId: fixture.enterpriseId, principal: { kind: 'user', userId: fixture.userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
const chat = (fixture = fixtures[0]) => new ConversationService(actor(fixture));
const content = (text: string) => ({ version: 1 as const, blocks: [{ type: 'text' as const, text }] });
const turn = (name: string, input: unknown, usage: ModelTurnOutput['usage'] = { inputTokens: 200, outputTokens: 50 }): ModelTurnOutput => ({ text: '', toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(input) }], usage, providerRequestId: null, finishReason: 'tool_calls' });
const sources = (messages: ModelMessage[]) => messages.flatMap(message => message.role === 'tool' ? JSON.parse(message.content).synthesisSources || [] : []) as Array<{ sourceId: string; kind: string; citationOptions: Array<{ citationId: string }> }>;
const final = (citationId: string) => ({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '厂家说明要求核对型号与实际基层，型号支持并不证明本人现场已经满足安装条件。', citations: [{ citationId }] }] });
const expectCode = (code: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
let firstRun: string, followupRun: string, citationId: string;

test('paid long trials share original cash holds across stages/groups, retain null actual billing and enforce enterprise limits',async()=>{
  const fixture=fixtures[2];
  const paid: MeteredConsultationBinding={profile:consultationLongProfile.id,stage:'R4',budgetGroup:prefix+'-paid',
    metered:{authorization:consultationCashAuthorization,cashLimitMicros:5000000,tariff:consultationTariffVersion}};
  const settings={...config,model:consultationLongProfile.model,consultation:paid};
  await withTenantTransaction(fixture.enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings
    set agent_config=${JSON.stringify(settings)}::jsonb where enterprise_id=${fixture.enterpriseId}`));
  const sent=await chat(fixture).send(fixture.conversationId,randomUUID(),content('查一下厂家公开地暖说明，解释条件，不保存、不安排。'));
  const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,String(sent.runId));let calls=0;
  await processAgentAnswer(lease,{model:async messages=>calls++===0?turn('search_web',{query:'地板 地暖 安装条件',domains:[]})
    :turn('final_response',final(sources(messages).find(source=>source.kind==='web')!.citationOptions[0].citationId)),
    webSearch:async(query:WebQuery)=>searchWeb(query,{name:'labelled-synthetic',search:async()=>[{url:'https://maker.example/installation',title:'Synthetic'}]},
      async url=>({url,type:'text/html',body:'<main>所选型号应支持地暖，仍须核对实际基层与安装条件。型号支持不证明这个客户家的现场已符合条件；网页不是企业承诺或施工验收。</main>'}))});
  assert.equal((await chat(fixture).run(String(sent.runId))).status,'succeeded');assert.equal(calls,2);
  await withTenantTransaction(fixture.enterpriseId,async tx=>{
    const q=await one(tx,sql`select reserved_tokens,reserved_cost_micros,settled_cost_micros from app.assistant_quota_reservations
      where enterprise_id=${fixture.enterpriseId} and run_id=${String(sent.runId)}`);
    assert.equal(Number(q!.reserved_tokens),500);assert.equal(Number(q!.reserved_cost_micros),960);assert.equal(q!.settled_cost_micros,null);
    await tx.execute(sql`update app.assistant_quota_reservations set reserved_cost_micros=4999999
      where enterprise_id=${fixture.enterpriseId} and run_id=${String(sent.runId)}`);
    await tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify({...settings,consultation:{...paid,stage:'R3',budgetGroup:prefix+'-another'}})}::jsonb
      where enterprise_id=${fixture.enterpriseId}`);
  });
  const next=await chat(fixture).send(fixture.conversationId,randomUUID(),content('沿刚才的依据继续解释，不保存、不安排。'));
  await withTenantTransaction(fixture.enterpriseId,async tx=>{
    const run=await one(tx,sql`select created_at,policy_snapshot from app.assistant_runs where enterprise_id=${fixture.enterpriseId} and id=${String(next.runId)}`);
    const input={enterpriseId:fixture.enterpriseId,runId:String(next.runId),createdAt:String(run!.created_at),
      binding:(run!.policy_snapshot as {agent:{consultation:ConsultationBinding}}).agent.consultation,purpose:'answer' as const,estimatedRequestTokens:1000};
    await assert.rejects(reserveConsultationDispatch(tx,input),expectCode('assistant_quota_exceeded'));
    await tx.execute(sql`update app.assistant_quota_reservations set reserved_cost_micros=960
      where enterprise_id=${fixture.enterpriseId} and run_id=${String(sent.runId)}`);
    await tx.execute(sql`update app.assistant_enterprise_settings set daily_cost_micros=1000 where enterprise_id=${fixture.enterpriseId}`);
    await assert.rejects(reserveConsultationDispatch(tx,input),expectCode('assistant_quota_exceeded'));
    const q=await one(tx,sql`select reserved_tokens,reserved_cost_micros from app.assistant_quota_reservations
      where enterprise_id=${fixture.enterpriseId} and run_id=${String(next.runId)}`);
    assert.equal(Number(q!.reserved_tokens),0);assert.equal(Number(q!.reserved_cost_micros),0);
    await tx.execute(sql`update app.assistant_jobs set status='cancelled' where enterprise_id=${fixture.enterpriseId} and run_id=${String(next.runId)}`);
    await tx.execute(sql`update app.assistant_runs set status='cancelled' where enterprise_id=${fixture.enterpriseId} and id=${String(next.runId)}`);
    await tx.execute(sql`update app.assistant_quota_reservations set status='released' where enterprise_id=${fixture.enterpriseId} and run_id=${String(next.runId)}`);
  });
});

before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  for (let index = 0; index < 3; index++) {
    const fixture = { enterpriseId: '', userId: '', conversationId: '' }; fixtures.push(fixture);
    await withPlatformTransaction(async tx => {
      fixture.enterpriseId = index === 1 ? fixtures[0].enterpriseId : String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+index},${prefix+index},'active') returning id`))!.id);
      fixture.userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+index},1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${fixture.userId},${prefix+index})`);
      if (index !== 1) await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${fixture.enterpriseId},true,100,1000000,1000000000,30,${JSON.stringify(config)}::jsonb)`);
    });
    fixture.conversationId = String((await chat(fixture).create(randomUUID())).id);
  }
  console.log('SYNTHETIC_CONSULTATION_FIXTURES ' + JSON.stringify(fixtures));
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const enterpriseId of new Set(fixtures.map(f => f.enterpriseId).filter(Boolean))) {
        // Only this labelled fixture's resources are cancelled on a failed test.
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now() where enterprise_id=${enterpriseId} and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_runs set status='cancelled',completed_at=now(),updated_at=now() where enterprise_id=${enterpriseId} and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${enterpriseId}`);
        assert.equal((await one(tx, sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${enterpriseId}`))?.n, 0);
      }
      for (const fixture of fixtures) if (fixture.userId) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${fixture.userId}`);
    });
  } finally { await closePostgresPool(); }
});

test('actual request uses the bound profile and the original usage/reservation rows', async () => {
  const sent = await chat().send(fixtures[0].conversationId, randomUUID(), content('查一下厂家公开地暖说明，解释条件，不保存、不安排。'));
  firstRun = String(sent.runId); const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, firstRun);
  let calls = 0;
  await processAgentAnswer(lease, { model: async messages => calls++ === 0 ? turn('search_web', { query: '地板 地暖 安装条件', domains: [] }) : turn('final_response', final(sources(messages).find(source => source.kind === 'web')!.citationOptions[0].citationId)),
    webSearch: async (query: WebQuery) => searchWeb(query, {name:'labelled-synthetic',search:async()=>[{url:'https://maker.example/installation',title:'Synthetic'}]}, async url => ({url,type:'text/html',body:'<main>所选型号应支持地暖，仍须核对实际基层与安装条件。型号支持不证明这个客户家的现场已符合条件；网页不是企业承诺或施工验收。</main>'})) });
  assert.equal((await chat().run(firstRun)).status, 'succeeded'); assert.equal(calls, 2);
  await withTenantTransaction(fixtures[0].enterpriseId, async tx => {
    const run = await one(tx, sql`select policy_snapshot from app.assistant_runs where enterprise_id=${fixtures[0].enterpriseId} and id=${firstRun}`);
    assert.equal((run!.policy_snapshot as {maxTokens:number}).maxTokens, 8192);
    const quota = await one(tx, sql`select reserved_tokens,settled_tokens,status from app.assistant_quota_reservations where enterprise_id=${fixtures[0].enterpriseId} and run_id=${firstRun}`);
    assert.equal(Number(quota!.reserved_tokens), 500); assert.equal(Number(quota!.settled_tokens), 500); assert.equal(quota!.status, 'reconciling');
  });
});

test('follow-up revalidates original Evidence, opens its source and survives persisted reentry without another web read', async () => {
  const key = randomUUID(), question = content('沿刚才的依据，为什么还不能认定我家已经符合安装条件？不保存、不安排。');
  const sent = await chat().send(fixtures[0].conversationId,key,question); followupRun = String(sent.runId);
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, followupRun); let calls = 0;
  await processAgentAnswer(lease,{model:async messages=>{ calls++; const source=sources(messages).find(source=>source.kind==='web');assert.ok(source);assert.match(source.sourceId,new RegExp('^W'+firstRun+':'));return turn('final_response',final(source.citationOptions[0].citationId)); },webSearch:async()=>{throw Error('No repeat web read needed');}});
  assert.equal((await chat().run(followupRun)).status,'succeeded'); assert.equal(calls,1);
  const history=await chat().messages(fixtures[0].conversationId), answer=history.items.find(message=>message.authorKind==='assistant')!;
  assert.equal(answer.available,true);assert.equal(answer.citations.length,1);citationId=answer.citations[0].id;
  assert.match(citationId,new RegExp('^w:'+followupRun+':'));assert.equal((await chat().citation(citationId)).available,true);
  assert.equal((await chat().send(fixtures[0].conversationId,key,question)).runId,followupRun);
  assert.equal((await chat().messages(fixtures[0].conversationId)).items.find(message=>message.id===answer.id)?.available,true);
});

test('another customer and another tenant cannot read the continued conversation or source',async()=>{
  for(const fixture of fixtures.slice(1)) {
    await assert.rejects(chat(fixture).messages(fixtures[0].conversationId),/assistant_resource_not_found/);
    await assert.rejects(chat(fixture).citation(citationId),/assistant_resource_not_found/);
  }
});

test('stage and enterprise caps deny the next reservation before a dispatch; missing holds cannot be recreated',async()=>{
  const sent=await chat().send(fixtures[0].conversationId,randomUUID(),content('这是独立问题，想听一般建议，不保存。'));
  await withTenantTransaction(fixtures[0].enterpriseId,async tx=>{
    const run=await one(tx,sql`select created_at from app.assistant_runs where enterprise_id=${fixtures[0].enterpriseId} and id=${String(sent.runId)}`);
    const input={enterpriseId:fixtures[0].enterpriseId,runId:String(sent.runId),binding,createdAt:String(run!.created_at),purpose:'answer' as const,estimatedRequestTokens:60001};
    await assert.rejects(reserveConsultationDispatch(tx,input),expectCode('assistant_quota_exceeded'));
    await tx.execute(sql`update app.assistant_enterprise_settings set daily_tokens=1000 where enterprise_id=${fixtures[0].enterpriseId}`);
    await assert.rejects(reserveConsultationDispatch(tx,{...input,estimatedRequestTokens:2000}),expectCode('assistant_quota_exceeded'));
    await tx.execute(sql`update app.assistant_enterprise_settings set daily_tokens=1000000 where enterprise_id=${fixtures[0].enterpriseId}`);
    await tx.execute(sql`update app.assistant_quota_reservations set status='released' where enterprise_id=${fixtures[0].enterpriseId} and run_id=${String(sent.runId)}`);
    await assert.rejects(reserveConsultationDispatch(tx,{...input,estimatedRequestTokens:2000}),expectCode('assistant_quota_exceeded'));
  });
  await chat().run(String(sent.runId),'cancel',randomUUID());
});

test('discovery/read have separate durable receipts; a foreign-run candidate cannot dispatch a read',async()=>{
  const sent=await chat().send(fixtures[0].conversationId,randomUUID(),content('考虑地暖时，木地板和瓷砖怎么选？请查厂家公开说明，结合实际条件解释，不保存、不安排。'));
  const runId=String(sent.runId),lease=await claimJob();assert.ok(lease);let reads=0,calls=0;
  const original=Buffer.from('<main>所选型号应支持地暖，仍须核对实际基层与安装条件。型号支持不证明这个客户家的现场已符合条件。</main>');
  await processAgentAnswer(lease,{model:async messages=>{
    const turnIndex=calls++;
    if(!turnIndex)return turn('search_web',{query:'厂家安装条件',domains:[]});
    if(turnIndex===1){const packet=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content)).find(packet=>packet.candidates?.length);assert.ok(packet);assert.deepEqual(packet.synthesisSources,[]);return turn('read_web',{candidateId:packet.candidates[0].id});}
    const response=final(sources(messages).find(source=>source.kind==='web')!.citationOptions[0].citationId);
    response.segments.push({basis:'advice',text:'可按需求比较：\n1. 先核对产品条件。\n2. 再核对现场资料。',citations:[]});
    return turn('final_response',response);
  },webSearch:query=>searchPublicResearch(query,{name:'labelled-synthetic',search:async()=>[{url:'https://maker.example/installation',title:'合成厂家说明'}]},undefined,undefined,Infinity,{runId,sequence:1200,discoverOnly:true}),
    webRead:async(query,selected,previous,sequence)=>{reads++;return searchPublicResearch(query,{name:'labelled-synthetic',search:async()=>{throw Error('No repeated search');}},async url=>({version:1,url,title:'合成厂家说明',parser:publicReaderParser,mediaType:'text/html',pages:[{page:1,text:'所选型号应支持地暖，仍须核对实际基层与安装条件。型号支持不证明这个客户家的现场已符合条件。'}],links:[],redirects:[],original:{sha256:createHash('sha256').update(original).digest('hex'),bytes:original.length,base64:original.toString('base64')},egress:'upstream-v0.9.2-resolve-and-pin-proxy',tlsVerification:true}),previous,Infinity,{runId,sequence,selected});}});
  assert.equal((await chat().run(runId)).status,'succeeded');assert.equal(calls,3);assert.equal(reads,1);
  assert.match(JSON.stringify(await chat().messages(fixtures[0].conversationId)),/先核对产品条件/);
  await withTenantTransaction(fixtures[0].enterpriseId,async tx=>{
    const read=await one(tx,sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and capability_name='web.read.v1'`);
    const snapshot=read!.private_checkpoint as {documents:Array<{original:{base64:string}}>;pages:Array<{hash:string}>};
    assert.equal(snapshot.documents[0].original.base64,original.toString('base64'));
    assert.ok(snapshot.pages[0].hash,'model metadata projection never replaces the authorized original');
    const model=await one(tx,sql`select input_summary from app.assistant_run_steps where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and kind='agent_model' order by step_seq desc limit 1`);
    const metadata=model!.input_summary as {contentProjection:string;numericProseProtocol:string};
    assert.equal(metadata.contentProjection,'tool-content-artifact-v2');
    assert.equal(metadata.numericProseProtocol,'structured-list-marker-v2');
  });
  const next=await chat().send(fixtures[0].conversationId,randomUUID(),content('再核对公开安装条件，不保存。'));
  const nextLease=await claimJob();assert.ok(nextLease);
  await processAgentAnswer(nextLease,{webSearch:async()=>{throw Error('No search');},webRead:async()=>{reads++;throw Error('Foreign candidate');},model:async()=>turn('read_web',{candidateId:`P${runId}:1200:0`})});
  assert.equal((await chat().run(String(next.runId))).status,'failed');assert.equal(reads,1);
  const error=await withTenantTransaction(fixtures[0].enterpriseId,tx=>one(tx,sql`select error_code from app.assistant_runs where enterprise_id=${fixtures[0].enterpriseId} and id=${String(next.runId)}`));
  assert.equal(error!.error_code,'assistant_capability_forbidden');
});

test('four primary calls leave one accounted final-only PDF citation repair, with the rejected original retained',async()=>{
  const sent=await chat().send(fixtures[0].conversationId,randomUUID(),content('考虑地暖时，木地板和瓷砖怎么选？请查厂家公开说明，结合实际条件解释，不保存、不安排。'));
  const runId=String(sent.runId),lease=await claimJob();assert.ok(lease);let calls=0,searches=0,numericId='';
  const original=Buffer.from('%PDF clearly labelled synthetic two-page original');
  let previous: Parameters<typeof searchPublicResearch>[3];
  await processAgentAnswer(lease,{model:async(messages,_available,_turn,tools)=>{
    const index=calls++;
    if(index===0)return turn('search_web',{query:'厂家说明',domains:[]});
    if(index===1)return turn('search_web',{query:'厂家安装条件',domains:[]});
    if(index===2){const packet=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content)).filter(packet=>packet.candidates?.length).at(-1);return turn('read_web',{candidateId:packet.candidates[0].id});}
    if(index===3){const web=sources(messages).filter(source=>source.kind==='web'&&source.sourceId.startsWith('W'+runId+':'));assert.equal(web.length,2);numericId=web[1].citationOptions[0].citationId;
      return turn('final_response',{kind:'synthesis',segments:[{basis:'evidence',text:'原文对含水率分别规定1.5%和0.3%，接触温度最高27°C，每天逐步改变5°C。',citations:[{citationId:web[0].citationOptions[0].citationId}]},
        {basis:'uncertainty',text:'仍需核实：1. 地板型号；2. 设备类型；3. 基层资料。',citations:[]}]});}
    assert.equal(index,4);assert.ok(tools);assert.deepEqual(tools.map(tool=>tool.name),['final_response']);assert.ok(JSON.stringify(tools).includes(numericId));
    const properties=tools[0].parameters.properties as {kind:{enum:string[]};baseHash:{enum:string[]}};
    assert.deepEqual(properties.kind.enum,['synthesis_repair']);
    return turn('final_response',{kind:'synthesis_repair',baseHash:properties.baseHash.enum[0],edits:[{segment:0,addCitationIds:[numericId]}]});
  },webSearch:async query=>{
    const result=await searchPublicResearch(query,{name:'labelled-synthetic',search:async()=>[{url:'https://maker.example/install.pdf',title:'合成厂家安装原件'}]},undefined,previous,Infinity,{runId,sequence:1200+searches++*10,discoverOnly:true});
    previous=result.research;return result;
  },webRead:async(query,selected,state,sequence)=>searchPublicResearch(query,null,async url=>({version:1,url,title:'合成厂家安装原件',parser:publicReaderParser,mediaType:'application/pdf',
    pages:[{page:1,text:'本页仅说明需要核对具体型号、适用条件和实际基层；厂家资料不证明客户家已满足安装条件。'},
      {page:2,text:'Moisture limits are 1.5% and 0.3%. Contact temperature maximum 27°C; gradual temperature change 5°C per day.'}],
    links:[],redirects:[],original:{sha256:createHash('sha256').update(original).digest('hex'),bytes:original.length,base64:original.toString('base64')},egress:'upstream-v0.9.2-resolve-and-pin-proxy',tlsVerification:true}),state,Infinity,{runId,sequence,selected})});
  const result=await chat().run(runId);assert.equal(result.status,'succeeded',JSON.stringify({runId,calls,status:result.status}));assert.equal(calls,5);
  const reentry=JSON.stringify(await chat().messages(fixtures[0].conversationId));assert.match(reentry,/1\.5%/);assert.match(reentry,/仍需核实/);
  await withTenantTransaction(fixtures[0].enterpriseId,async tx=>{
    const checkpoint=await one(tx,sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and kind='agent_checkpoint'`);
    const state=checkpoint!.private_checkpoint as {turn:number;validationRepairs:number;turnSchedule:string};
    assert.equal(state.turn,4);assert.equal(state.validationRepairs,1);assert.equal(state.turnSchedule,'shared-auxiliary-final-repair-v2');
    const validation=await one(tx,sql`select count(*) as n from app.assistant_run_steps where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and kind='agent_validation'`);assert.equal(Number(validation!.n),1);
    const rejected=await one(tx,sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId} and step_seq=1130`);
    assert.match(JSON.stringify(rejected!.private_checkpoint),/1\.5%/);
    const quota=await one(tx,sql`select reserved_tokens,settled_tokens,settled_cost_micros,status from app.assistant_quota_reservations where enterprise_id=${fixtures[0].enterpriseId} and run_id=${runId}`);
    assert.equal(quota!.status,'reconciling');assert.equal(Number(quota!.reserved_tokens),1250);assert.equal(Number(quota!.settled_tokens),1250);assert.equal(quota!.settled_cost_micros,null);
  });
});

test('non-adjacent PDF quotes persist separately, reopen after follow-up and revoke together without widening quote limits',async()=>{
  const cid=String((await chat().create(randomUUID())).id);
  const original=Buffer.from('%PDF labelled synthetic single-page source; no real manufacturer document');
  const text='测试专用：铺装前核对具体型号与适用条件。\n'+'中间资料保持完整，仅供原文定位。\n'.repeat(70)+'测试专用：本人现场基层仍须独立核验，厂家说明不等于施工安排或验收。';
  let originRun='',calls=0;
  const execute=async(question:string)=>{
    const sent=await chat().send(cid,randomUUID(),content(question)),runId=String(sent.runId),lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,runId);
    await processAgentAnswer(lease,{model:async messages=>{
      calls++;const source=sources(messages).find(source=>source.kind==='web');
      return source?turn('final_response',{kind:'synthesis',segments:[{basis:'evidence',text:'资料要求核对具体型号与本人现场基层，不能把厂家说明当作施工安排或验收。',
        citations:[source.citationOptions[0],source.citationOptions.at(-1)!].map(citation=>({citationId:citation.citationId}))}]}):turn('search_web',{query:'合成安装资料',domains:[]});
    },webSearch:async(query:WebQuery)=>searchPublicResearch(query,{name:'labelled-synthetic',search:async()=>[{url:'https://maker.example/spans.pdf',title:'合成安装原件'}]},async url=>({
      version:1,url,title:'合成安装原件',parser:publicReaderParser,mediaType:'application/pdf',pages:[{page:1,text}],links:[],redirects:[],
      original:{sha256:createHash('sha256').update(original).digest('hex'),bytes:original.length,base64:original.toString('base64')},egress:'upstream-v0.9.2-resolve-and-pin-proxy',tlsVerification:true}))});
    const run=await chat().run(runId);assert.equal(run.status,'succeeded');
    const answer=(await new ConversationService(actor()).messages(cid)).items.find(item=>item.id===run.outputMessageId)!;assert.ok(answer.available);assert.equal(answer.citations.length,2);
    for(const [index,citation]of answer.citations.entries()){
      assert.match(citation.id,new RegExp('^w:'+runId+':0:'+index+'$'));
      const opened=await chat().citation(citation.id);assert.ok(opened.available);assert.ok('quote' in opened && 'sourceLocation' in opened);assert.ok(String(opened.quote).length<=600);assert.ok(text.includes(String(opened.quote)));
      assert.match(String(opened.sourceLocation),/PDF 第1页/);
      await assert.rejects(chat(fixtures[1]).citation(citation.id),expectCode('assistant_resource_not_found'));
      await assert.rejects(chat(fixtures[2]).citation(citation.id),expectCode('assistant_resource_not_found'));
    }
    const forged=await chat().citation('w:'+runId+':0:23');assert.equal(forged.available,false);
    if(!originRun)originRun=runId;
    return answer;
  };
  const first=await execute('查一下公开安装资料，说明型号与现场条件，不保存不安排。');
  const followup=await execute('沿刚才保存的来源继续解释，为什么还不能证明本人现场符合条件？不保存不安排。');
  assert.equal(calls,3,'Follow-up restores the original without another search');
  await withTenantTransaction(fixtures[0].enterpriseId,tx=>tx.execute(sql`update app.assistant_run_steps set status='failed'
    where enterprise_id=${fixtures[0].enterpriseId} and run_id=${originRun} and capability_name='web.search.v1'`));
  const reentry=await chat().messages(cid);
  for(const previous of [first,followup]){
    assert.equal(reentry.items.find(item=>item.id===previous.id)!.available,false);
    for(const citation of previous.citations)assert.equal((await chat().citation(citation.id)).available,false);
  }
});

test('missing observed usage preserves the reservation and stops the next call in the same stage',async()=>{
  const sent=await chat().send(fixtures[0].conversationId,randomUUID(),content('这是独立问题，请给一般选材建议，不保存、不安排。'));
  const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,sent.runId);let calls=0;
  await processAgentAnswer(lease,{model:async()=>{calls++;return turn('final_response',{kind:'synthesis',segments:[{basis:'advice',text:'可先比较清洁习惯和脚感偏好，再核对具体产品的维护要求。',citations:[]}]},null);}});
  const failed=await chat().run(String(sent.runId));assert.equal(failed.status,'failed');assert.equal(calls,1);
  await withTenantTransaction(fixtures[0].enterpriseId,async tx=>{
    const run=await one(tx,sql`select error_code,output_message_id from app.assistant_runs where enterprise_id=${fixtures[0].enterpriseId} and id=${String(sent.runId)}`);
    assert.equal(run!.error_code,'provider_usage_unknown');assert.equal(run!.output_message_id,null);
    const quota=await one(tx,sql`select reserved_tokens,status from app.assistant_quota_reservations where enterprise_id=${fixtures[0].enterpriseId} and run_id=${String(sent.runId)}`);
    assert.ok(Number(quota!.reserved_tokens)>8192);assert.equal(quota!.status,'reconciling');
    assert.equal(await settleConsultationDispatch(tx,fixtures[0].enterpriseId,String(sent.runId)),false);
  });
  const next=await chat().send(fixtures[0].conversationId,randomUUID(),content('这是独立问题，请继续一般建议，不保存。'));
  const nextLease=await claimJob();assert.ok(nextLease);await processAgentAnswer(nextLease,{model:async()=>{calls++;throw Error('Must not dispatch after unknown usage');}});
  assert.equal(calls,1);assert.equal((await chat().run(String(next.runId))).status,'failed');
  const guard=await withTenantTransaction(fixtures[0].enterpriseId,tx=>one(tx,sql`select input_summary from app.assistant_run_steps
    where enterprise_id=${fixtures[0].enterpriseId} and run_id=${String(next.runId)} and kind='agent_budget_guard'`));
  assert.equal((guard!.input_summary as {dispatched:boolean}).dispatched,false);
  assert.ok((guard!.input_summary as {requestedTokens:number}).requestedTokens>8192);
});
