/** Labelled synthetic histories; real C01 API, existing Worker and configured model. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import { readMemory, type NeedFact } from '@/lib/assistant/agent/memory';
import { historySummaryPolicy } from '@/lib/assistant/agent/summary';

loadEnvConfig(process.cwd(),true);
const directedMode=process.argv.includes('--directed');
const summaryMode=process.argv.includes('--summary')||directedMode;
const boundedRecoveryMode=process.argv.includes('--bounded-recovery');
const mixedMode=process.argv.includes('--mixed')||boundedRecoveryMode;
const capacityMode=process.argv.includes('--memory-capacity')||mixedMode;
const root=path.resolve('..'), output=path.join(root,boundedRecoveryMode?'tmp/xiaok-bounded-recovery':mixedMode?'tmp/xiaok-mixed-correction':directedMode?'tmp/xiaok-history-directed':capacityMode?'tmp/xiaok-memory-capacity':summaryMode?'tmp/xiaok-summary-v69':'tmp/xiaok-history-v68'), prefix='synthetic-history-live-'+randomUUID();
const native=process.argv.includes('--native');
const original='我先说书房隔音的限制：不拆墙，夜间不使用音箱；如果换位置只作比较，不代表我同意改造。';
const question=summaryMode?'回到前面书房隔音的话题，我早先的限制有哪些？换位置作比较是否表示同意改造？只回顾聊天原话，不查图纸或项目进度。'
  :'回到前面书房隔音的话题，请回顾聊天原话里的限制，再给一个符合限制的思路。这次只谈之前聊天，不查图纸或项目进度。';
const correction='请记录：书房晚上也会使用电脑，但仍然不使用音箱。';
const correctedQuestion='书房夜间使用我现在表达的需求是什么？早先说的不拆墙和只比较位置是否等于同意改造？请结合前面聊天和当前工作记录解释，不查图纸或进度。';
let enterpriseId='',userId='',conversationId='',token='';
const report:Row={prefix,promptVersion:agentPromptVersion,summaryPolicy:historySummaryPolicy.version,started:new Date().toISOString(),mode:native?'native':'service',summaryMode,capacityMode,directedMode,mixedMode,boundedRecoveryMode,checks:[],answers:[],costMicros:null,
  preregistered:mixedMode?['two leading explicit multi-field corrections before separate comma-delimited hypothetical questions each produce one atomic real receipt for exactly two fields',
    'unrelated kitchen refrigerator survives; hypothetical dishwasher is not saved; general plumbing advice cannot imply actual site conditions or formal approval',
    'HTTP persisted reentry retains both current fields and real replies; withdrawing the latest original hides dependent prose and does not revive prior values',
    'two read-only withdrawal replies remain unknown without writes/handoff, fixed prompt/source hashes and real usage']
    :capacityMode?['300 source-linked assertions: two actual corrections and two independent additions preserve the complete chain and kitchen need',
    'two scoped history/current comparisons preserve the latest desk position and kitchen need without another write or handoff',
    'withdraw the current correction: both comparison answers become unavailable on persisted reentry; two new answers keep the position unknown',
    'all eight answers use one prompt/source version, remain within the recorded budget, and leave memory at version 304']
    :[directedMode?'early original outside 60 older customer messages: directed original search and one semantic selection retain no demolition/no speaker/hypothesis is not consent':'early original after >40 messages: retain no demolition, no speaker at night, hypothetical comparison is not consent',
    'correction: actual saved computer-at-night need overrides old context; no speaker/demolition/conditional boundary preserved',
    'same consultation reentry, original history intact, no work assignment or formal approval; every dispatch within recorded budget',
    'withdrawn original hides dependent prose on reentry, cross-customer/tenant HTTP remains denied',
    ...(summaryMode?['two source-linked extractive digests rebuild from complete originals; selected early conditions/negation are not paraphrased or new consent',
      'explicit current correction skips the optional digest; summary/provider/answer requests retain actual usage and source hashes']:[])],
  reality:'synthetic history/enterprise/customer; real localhost3006 API, development5432, existing Worker and configured DeepSeek; no production'};
fs.mkdirSync(output,{recursive:true});
const save=()=>fs.writeFileSync(path.join(output,native?'native-driver.json':'live.json'),JSON.stringify(report,null,2));
const actor=():ActorContext=>({enterpriseId,principal:{kind:'user',userId},contextVersion:1,capabilities:['assistant.chat.self']});
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function wait<T>(read:()=>Promise<T|false|null>,label:string):Promise<T>{for(let i=0;i<360;i++){const result=await read();if(result)return result;await pause(500);}throw Error('Timed out: '+label);}
async function http(suffix:string,method='GET',text?:string){
  const key=randomUUID(),response=await fetch('http://localhost:3006/api/miniprogram/assistant/'+suffix,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key},
    ...(text?{body:JSON.stringify({clientMessageId:key,content:{version:1,blocks:[{type:'text',text}]}})}:{}),signal:AbortSignal.timeout(60000)});
  const body=await response.json();assert.equal(response.status,method==='POST'?202:200,JSON.stringify(body));assert.match(response.headers.get('cache-control')||'',/no-store/);return body.data;
}
const messages=()=>http('conversations/'+conversationId+'/messages');
async function audit(runId:string,label:string,started:number){
  const run=await wait(async()=>{const r=await http('runs/'+runId);return !['queued','running'].includes(r.status)?r:false;},'real Worker result');
  const steps=await withTenantTransaction(enterpriseId,tx=>rows(tx,sql`select kind,status,capability_name,input_summary,private_checkpoint,source_refs from app.assistant_run_steps where enterprise_id=${enterpriseId} and run_id=${runId} order by step_seq`));
  const history=await messages(),answer=history.items.find((m:Row)=>m.id===String(run.outputMessageId||run.output_message_id));
  const stored=await withTenantTransaction(enterpriseId,tx=>one(tx,sql`select output_message_id::text from app.assistant_runs where enterprise_id=${enterpriseId} and id=${runId}`));
  const actual=answer||history.items.find((m:Row)=>m.id===stored?.output_message_id);
  const usage=await withTenantTransaction(enterpriseId,tx=>rows(tx,sql`select category,measurement_kind,quantity::text,input_tokens::text,output_tokens::text,cost_micros::text from app.assistant_usage_records where enterprise_id=${enterpriseId} and run_id=${runId}`));
  const result={label,runId,run,text:actual?safeText(actual.content):'',outputMessageId:stored?.output_message_id,elapsedMs:Date.now()-started,steps,usage,semanticReviewRequired:true};
  (report.answers as Row[]).push(result);save();assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(actual?.available,true);
  if(capacityMode)assert.ok(steps.some(s=>s.kind==='agent_need_context'&&(s.input_summary as Row)?.policy==='need-memory-sources-v1'),
    'the existing Worker must execute the current durable need-source guard, not an older cached bundle');
  for(const s of steps.filter(s=>s.kind==='agent_model')){const summary=s.input_summary as Row;assert.equal(summary.promptVersion,agentPromptVersion);assert.ok(((summary.budget as Row).after as Row).estimatedTokens as number<=16000);}
  return result;
}
async function ask(text:string,label:string){const started=Date.now(),sent=await http('conversations/'+conversationId+'/messages','POST',text);return audit(String(sent.runId),label,started);}
async function main(){
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.ok(process.argv.includes('--development'));assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5432');assert.equal(url.pathname,'/smart_floor_planner');
  const { signMiniProgramToken }=await import('@/lib/miniprogram-jwt');
  const sourceFiles=fs.readdirSync(path.join(root,'admin/src/lib/assistant/agent')).filter(f=>f.endsWith('.ts')).sort().map(f=>'admin/src/lib/assistant/agent/'+f);
  sourceFiles.push('admin/scripts/assistant-history-development.ts','admin/scripts/assistant-history-development.mjs');
  sourceFiles.push('admin/src/lib/ai/providers/agent-chat.ts','admin/src/lib/assistant/contracts/model.ts');
  report.sources=sourceFiles.map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));save();
  try{
    if(native&&(summaryMode||capacityMode)){
      try{await fetch('http://127.0.0.1:9431/json/list',{signal:AbortSignal.timeout(3000)});}
      catch{report.nativePreflight={available:false,cdpPort:9431,automatorPort:9420,desktopFallback:false};throw Error('Stable SDK/CDP is unavailable; no synthetic fixture or desktop window is created.');}
    }
    await withPlatformTransaction(async tx=>{
      const template=await one(tx,sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`);assert.ok(template&&String(template.code).startsWith('p4b-development-'));
      const config=template.agent_config as Row;assert.equal(config.providerKey,'deepseek');assert.equal(config.model,'deepseek-flash');
      enterpriseId=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · 长对话原话召回',${prefix},'active') returning id`))!.id);
      userId=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix})`);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${enterpriseId},true,100,12000000,1000000000,30,${JSON.stringify({...config,imageInput:false})}::jsonb)`);
    });
    token=await signMiniProgramToken({sub:userId,id:userId,mode:'customer',role:'user',contextVersion:1,source:'wechat'});
    conversationId=String((await new ConversationService(actor()).create(randomUUID())).id);report.fixture={enterpriseId,userId,conversationId};save();
    let sourceId='';
    await withTenantTransaction(enterpriseId,async tx=>{
      if(capacityMode){
        const c=await one(tx,sql`update app.assistant_conversations set last_seq=last_seq+300,version=version+1
          where enterprise_id=${enterpriseId} and id=${conversationId} returning last_seq`);
        const originals=await rows(tx,sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
          select ${enterpriseId},${conversationId},${String(c!.last_seq)}::bigint-300+n,'user',${userId},
            jsonb_build_object('version',1,'blocks',jsonb_build_array(jsonb_build_object('type','text','text',
              case when n=1 then '厨房保留冰箱。' else '书房书桌靠窗，历史版本' || n || '。' end))),'synthetic.memory'
          from generate_series(1,300) n returning id::text,seq::text,content`);
        originals.sort((a,b)=>BigInt(String(a.seq))<BigInt(String(b.seq))?-1:1);
        const facts:NeedFact[]=originals.map((m,i)=>({id:'synthetic:'+m.id,room:i?'书房':'厨房',field:i?'desk':'devices',value:i?'靠窗':'冰箱',
          quote:safeText(m.content as Parameters<typeof safeText>[0]),sourceMessageId:String(m.id),provenance:'customer_statement',status:i===0||i===299?'current':'superseded',
          supersedes:i>1?'synthetic:'+originals[i-1].id:null,createdAt:new Date().toISOString()}));
        await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify({version:300,facts})}::jsonb)
          where enterprise_id=${enterpriseId} and id=${conversationId}`);
        report.seedMemory={version:300,current:facts.filter(f=>f.status==='current'),factsHash:createHash('sha256').update(JSON.stringify(facts)).digest('hex')};
        sourceId=facts[299].sourceMessageId;return;
      }
      sourceId=String((await appendMessage(tx,actor(),conversationId,{author:'user',content:{version:1,blocks:[{type:'text',text:original}]}})).id);
      for(let i=0;i<22;i++){
        await appendMessage(tx,actor(),conversationId,{author:'user',purpose:'synthetic.history',content:{version:1,blocks:[{type:'text',text:`厨房柜体保养补充问题${i}：`+'只讨论清洁和防潮，不表示购买。'.repeat(12)}]}});
        const row=await one(tx,sql`update app.assistant_conversations set last_seq=last_seq+1,version=version+1 where enterprise_id=${enterpriseId} and id=${conversationId} returning last_seq`);
        await tx.execute(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,content,purpose) values(${enterpriseId},${conversationId},${String(row!.last_seq)},'assistant',
          ${JSON.stringify({version:1,blocks:[{type:'text',text:'合成历史答复：厨房柜体可分别比较清洁、防潮和维护。'.repeat(6)}]})}::jsonb,'synthetic.history')`);
      }
      if(directedMode){
        const row=await one(tx,sql`update app.assistant_conversations set last_seq=last_seq+90,version=version+1
          where enterprise_id=${enterpriseId} and id=${conversationId} returning last_seq`);
        await tx.execute(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
          select ${enterpriseId},${conversationId},${String(row!.last_seq)}::bigint-90+n,'user',${userId},
            jsonb_build_object('version',1,'blocks',jsonb_build_array(jsonb_build_object('type','text','text',
              '厨房日常保养的第' || n || '条合成补充，只谈柜门清洁和防潮。'))),'synthetic.history'
          from generate_series(1,90) n`);
      }
    });report.fixture={...(report.fixture as Row),sourceId,seededMessages:capacityMode?300:directedMode?135:45};save();
    const capacityFlow=async(send=ask,reenter=messages)=>{
      const corrections=['请记录：书房的书桌位置从靠窗改为靠门。','请记录：书房的书桌位置改为靠内墙。',
        '请记录：书房设备是电脑和台灯。','请记录：书房采光好。'];
      for(const [i,request]of corrections.entries()){
        const r=await send(request,'capacity-save-'+i);
        assert.ok(r.steps.some(s=>s.kind==='agent_need_write'),'a successful answer requires a real persisted receipt');
      }
      const memory=await withTenantTransaction(enterpriseId,async tx=>readMemory((await one(tx,sql`select entry_snapshot from app.assistant_conversations
        where enterprise_id=${enterpriseId} and id=${conversationId}`))!.entry_snapshot));
      assert.equal(memory.version,304);assert.equal(memory.facts.filter(f=>f.status==='current').length,4);
      assert.ok(memory.facts.some(f=>f.status==='current'&&f.room==='厨房'&&f.value==='冰箱'));
      const desk=memory.facts.find(f=>f.status==='current'&&f.room==='书房'&&f.field==='desk');assert.ok(desk&&/靠内墙/.test(desk.value));
      const archives=await withTenantTransaction(enterpriseId,tx=>rows(tx,sql`select s.private_checkpoint,s.input_summary from app.assistant_run_steps s
        join app.assistant_runs r on r.enterprise_id=s.enterprise_id and r.id=s.run_id where r.enterprise_id=${enterpriseId}
          and r.conversation_id=${conversationId} and s.kind='agent_need_write' order by s.id`));
      const archivedFacts=archives.flatMap(s=>(s.private_checkpoint as {archivedFacts:NeedFact[]}).archivedFacts);
      assert.equal(archivedFacts.length+memory.facts.length,304);assert.equal(archivedFacts.length,299);
      assert.equal(new Set([...archivedFacts,...memory.facts].map(f=>f.id)).size,304);
      report.memory=memory;report.archives={steps:archives.length,facts:archivedFacts.length,hash:createHash('sha256').update(JSON.stringify(archivedFacts)).digest('hex')};save();
      const comparison='请只回顾聊天原话，不查图纸、项目进度或其他业务资料：早先书房书桌靠窗，和现在记录的位置有什么差别？厨房的冰箱需求还在吗？不修改需求。';
      const assertReadOnly=(r:Awaited<ReturnType<typeof audit>>)=>assert.ok(!r.steps.some(s=>s.kind==='agent_need_write'
        || ['record_need','request_designer','record_reference_preference'].includes(String(s.capability_name))),'a history-only answer must not write needs or initiate handoff');
      for(let i=0;i<2;i++){
        const r=await send(comparison,'capacity-comparison-'+i);assert.match(r.text,/靠内墙/);assert.match(r.text,/冰箱/);
        assert.ok(r.steps.some(s=>s.capability_name==='recall_history'),'archived original is re-read through the existing scoped history tool');
        assertReadOnly(r);
      }
      await withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回：当前书桌位置原话已移除"}]}'::jsonb
        where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and id=${desk!.sourceMessageId}`));
      const withdrawnHistory=await reenter();report.reentry={withdrawnSource:desk!.sourceMessageId,comparisonVisibility:(report.answers as Row[])
        .filter(r=>String(r.label).startsWith('capacity-comparison')).map(r=>({id:r.outputMessageId,available:withdrawnHistory.items.find((m:Row)=>m.id===r.outputMessageId)?.available})),
        needReplyVisibility:(report.answers as Row[]).filter(r=>/^capacity-save-[123]$/.test(String(r.label)))
          .map(r=>({id:r.outputMessageId,available:withdrawnHistory.items.find((m:Row)=>m.id===r.outputMessageId)?.available}))};save();
      for(const result of (report.reentry as {comparisonVisibility:Array<{available:boolean}>}).comparisonVisibility)
        assert.equal(result.available,false,'withdrawn current source must hide the dependent comparison on persisted reentry');
      for(const result of (report.reentry as {needReplyVisibility:Array<{available:boolean}>}).needReplyVisibility)
        assert.equal(result.available,false,'withdrawn memory sources also hide copied values in ordinary save acknowledgements');
      for(let i=0;i<2;i++){
        const r=await send('请只回顾聊天原话，不查图纸、项目进度或其他业务资料：书房书桌现在的位置还能确认吗？不给布置建议，不重新记录。','capacity-withdrawal-'+i);
        assertReadOnly(r);
        const checkpoint=r.steps.find(s=>s.kind==='agent_checkpoint')?.private_checkpoint as {messages?:Array<{role:string;content:unknown}>}|undefined;
        for(const message of checkpoint?.messages||[])if(message.role==='assistant')assert.doesNotMatch(JSON.stringify(message.content),/靠内墙/,
          'withdrawn current values cannot reenter through older ordinary assistant prose');
        assert.match(r.text,/无法确认|不能确认|不能确定|无法确定|未知|没有.{0,12}(?:位置|记录)|未记录/,'withdrawal must remain unknown rather than restoring a current value');
        assert.doesNotMatch(r.text,/(?:当前|现在|目前)[^。！？\n]{0,30}(?:位置|书桌)[^。！？\n]{0,12}(?:是|为|仍在|仍然|沿用|记录为)[“”「」"\s]*(?:靠窗|靠门|靠内墙)/,
          'a fresh question quoting an old position is not a confirmed current need');
      }
      assert.equal(await withTenantTransaction(enterpriseId,async tx=>readMemory((await one(tx,sql`select entry_snapshot from app.assistant_conversations
        where enterprise_id=${enterpriseId} and id=${conversationId}`))!.entry_snapshot).version),304,'history and withdrawal reads cannot create memory revisions');
    };
    const mixedFlow=async(send=ask,reenter=messages)=>{
      const requests=[
        '更正一下，书房改为单人办公，书房书桌改为靠内墙，另外如果厨房加洗碗机，进排水一般要考虑什么？',
        '纠正一下，书房改为双人办公，书房书桌改为靠门，顺便如果厨房加洗碗机，进排水一般要怎么考虑？',
      ];
      for(const [i,request]of requests.entries()){
        const result=await send(request,'mixed-correction-'+i);
        const writes=result.steps.filter(s=>s.kind==='agent_need_write');assert.equal(writes.length,1,'one atomic save per explicit multi-field correction');
        const receipt=(writes[0].private_checkpoint as Row).receipt as {savedFacts:NeedFact[]};
        assert.equal(receipt.savedFacts.length,2);assert.deepEqual(receipt.savedFacts.map(f=>f.field).sort(),['desk','use']);
        const memory=await withTenantTransaction(enterpriseId,async tx=>readMemory((await one(tx,sql`select entry_snapshot from app.assistant_conversations
          where enterprise_id=${enterpriseId} and id=${conversationId}`))!.entry_snapshot));
        assert.equal(memory.version,302+i*2);
        const current=memory.facts.filter(f=>f.status==='current');assert.equal(current.length,3);
        assert.ok(current.some(f=>f.room==='厨房'&&f.field==='devices'&&f.value==='冰箱'));
        assert.match(current.find(f=>f.room==='书房'&&f.field==='use')?.value||'',i?/双人办公/:/单人办公/);
        assert.match(current.find(f=>f.room==='书房'&&f.field==='desk')?.value||'',i?/靠门/:/靠内墙/);
        assert.doesNotMatch(JSON.stringify(receipt),/洗碗机/);assert.match(result.text,/进水|排水|给水|水路/);
        report.memory=memory;save();
      }
      const history=await reenter();
      const currentReply=(report.answers as Row[]).at(-1)!;
      assert.equal(history.items.find((m:Row)=>m.id===currentReply.outputMessageId)?.available,true);
      const memory=report.memory as {facts:NeedFact[]},source=memory.facts.find(f=>f.status==='current'&&f.field==='desk')!.sourceMessageId;
      await withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回：本次更正原话已移除"}]}'::jsonb
        where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and id=${source}`));
      const withdrawn=await reenter(),latest=(report.answers as Row[]).at(-1)!;
      assert.equal(withdrawn.items.find((m:Row)=>m.id===latest.outputMessageId)?.available,false);
      report.reentry={withdrawnSource:source,invalidated:latest.outputMessageId};save();
      for(let i=0;i<2;i++){
        const result=await send('请只回顾聊天原话，不查图纸或项目进度：书房当前的办公人数和书桌位置还能确认吗？不给布置建议，不重新记录。','mixed-withdrawal-'+i);
        if(boundedRecoveryMode){
          const recalls=result.steps.filter(s=>s.capability_name==='recall_history');
          const firstEmpty=recalls.findIndex(recall=>((recall.private_checkpoint as Row).sources as Row[]).length===0);
          assert.ok(firstEmpty<0||firstEmpty===recalls.length-1,'after an empty history read this run cannot query again, even with changed words');
          assert.ok(result.steps.filter(s=>s.kind==='agent_model').length<=4,'the original model-call budget is unchanged');
          if(firstEmpty>=0)assert.ok(((result.steps.find(s=>s.kind==='agent_checkpoint')!.private_checkpoint as Row).exhaustedTools as string[]).includes('recall_history'));
        }
        assert.ok(!result.steps.some(s=>s.kind==='agent_need_write'||s.capability_name==='request_designer'));
        assert.match(result.text,/无法|不能|未知|不确定|缺少|没有|不可用|未能/);
        assert.doesNotMatch(result.text,/(?:现在|当前|目前)[^。！？\n]{0,20}(?:仍|是|为|沿用)[^。！？\n]{0,10}(?:单人办公|双人办公|靠内墙|靠门)/);
      }
      assert.equal(await withTenantTransaction(enterpriseId,async tx=>readMemory((await one(tx,sql`select entry_snapshot from app.assistant_conversations
        where enterprise_id=${enterpriseId} and id=${conversationId}`))!.entry_snapshot).version),304);
    };
    if(mixedMode&&native){
      const {run}=await import('./assistant-history-native.mjs');
      await run({root,output,enterpriseId,conversationId,token,audit,exercise:async(driver:{
        say:(request:string,label:string)=>Promise<{result:Awaited<ReturnType<typeof audit>>}>;
        open:()=>Promise<{data:(key:string)=>Promise<Row[]>}>;
      })=>mixedFlow(async(request,label)=>(await driver.say(request,label)).result,async()=>({items:await(await driver.open()).data('messages')}))});
    }else if(mixedMode){await mixedFlow();}else if(capacityMode&&native){
      const {run}=await import('./assistant-history-native.mjs');
      await run({root,output,enterpriseId,conversationId,token,audit,exercise:async(driver:{
        say:(request:string,label:string)=>Promise<{result:Awaited<ReturnType<typeof audit>>}>;
        open:()=>Promise<{data:(key:string)=>Promise<Row[]>}>;
      })=>capacityFlow(async(request,label)=>(await driver.say(request,label)).result,async()=>({items:await(await driver.open()).data('messages')}))});
    }else if(capacityMode){await capacityFlow();}else if(native){
      const {run}=await import('./assistant-history-native.mjs');await run({root,output,enterpriseId,conversationId,token,question,correctedQuestion,correction,audit,
        withdrawOriginal:()=>withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回：原话正文已移除"}]}'::jsonb where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and id=${sourceId}`)),
        verifyMemory:()=>withTenantTransaction(enterpriseId,async tx=>readMemory((await one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`))?.entry_snapshot))});
    }else{
      for(let i=0;i<2;i++){
        const r=await ask(question,'early-original-'+i);
        if(summaryMode){
          const digest=r.steps.find(s=>s.kind==='agent_summary_context');assert.equal(digest?.status,'succeeded');
          assert.ok(((digest!.private_checkpoint as Row).sources as Row[]).some(s=>s.messageId===sourceId));
          if(directedMode){
            assert.equal((digest!.input_summary as Row).policy,historySummaryPolicy.version);
            assert.ok(((digest!.input_summary as Row).retrieval as Row).outsideRecentCount as number>0,'the existing Worker must use a source outside the older 60-message window');
          }
        }else assert.ok(r.steps.some(s=>s.capability_name==='recall_history'));
        assert.match(r.text,/不拆|拆墙/);assert.match(r.text,/音箱/);
      }
      const saved=await ask(correction,'actual-correction');assert.ok(saved.steps.some(s=>s.kind==='agent_model'&&((s.private_checkpoint as Row)?.toolCalls as Row[]|undefined)?.some(c=>c.name==='record_need')));
      const memory=await withTenantTransaction(enterpriseId,async tx=>readMemory((await one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`))?.entry_snapshot));
      assert.ok(memory.facts.some(f=>f.status==='current'&&/电脑/.test(f.value)&&f.sourceMessageId),'real receipt is verified against current source-linked memory');report.memory=memory;save();
      for(let i=0;i<2;i++)await ask(correctedQuestion,'current-correction-'+i);
      const before=await messages();await withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回：原话正文已移除"}]}'::jsonb where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and id=${sourceId}`));
      const after=await messages();const dependent=(report.answers as Row[]).filter(r=>(r.steps as Row[]).some(s=>s.kind==='agent_history_context'||s.kind==='agent_summary_context'&&s.status==='succeeded')).map(r=>r.outputMessageId);
      assert.ok(dependent.length>=2);for(const id of dependent)assert.equal(after.items.find((m:Row)=>m.id===id)?.available,false);
      report.reentry={before:before.items.length,after:after.items.length,invalidated:dependent};
    }
    report.changedDuringRun=(report.sources as Row[]).filter(s=>createHash('sha256').update(fs.readFileSync(path.join(root,String(s.file)))).digest('hex')!==s.sha256).map(s=>s.file);
    assert.deepEqual(report.changedDuringRun,[],'configured-model evidence must use unchanged final source files');report.passed=true;
  }finally{
    report.changedDuringRun=(report.sources as Row[]|undefined)?.filter(s=>createHash('sha256').update(fs.readFileSync(path.join(root,String(s.file)))).digest('hex')!==s.sha256).map(s=>s.file)||[];
    if(enterpriseId){report.cleanup=await withTenantTransaction(enterpriseId,async tx=>{
      const fixture=await one(tx,sql`select code from app.enterprises where id=${enterpriseId}`);assert.equal(fixture?.code,prefix);
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${enterpriseId}`);
      return {aiEnabled:false,active:(await one(tx,sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${enterpriseId} and status in ('queued','running')`))?.n};
    });}
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(e=>{report.error=String(e.stack||e);save();console.error(e);process.exitCode=1;});
