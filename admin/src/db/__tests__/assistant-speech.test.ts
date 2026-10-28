import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';
import { SpeechService } from '@/lib/assistant/speech/service';
import { processSpeech } from '@/lib/assistant/speech/worker';
import { claimJob, markProviderStarted, failRun } from '@/lib/assistant/infrastructure/job-queue';
import { speechConfigurationHash } from '@/lib/assistant/speech/local';
import { siteActor } from '@/lib/construction/site-chat';
import { processSiteAction } from '@/lib/construction/site-action-worker';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { speechWav } from '../../../scripts/assistant-speech-fixture';

const names = ['ASSISTANT_ASR_PROVIDER','ASSISTANT_ASR_PYTHON','ASSISTANT_ASR_MODEL_PATH','ASSISTANT_ASR_MODEL_SHA256'] as const;
const before = names.map(name => process.env[name]), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sfp-synthetic-asr-'));
for (const file of ['python','model.bin','config.json','tokenizer.json']) fs.writeFileSync(path.join(folder, file), 'synthetic; never executed');
Object.assign(process.env, { ASSISTANT_ASR_PROVIDER: 'local-faster-whisper', ASSISTANT_ASR_PYTHON: path.join(folder,'python'), ASSISTANT_ASR_MODEL_PATH: folder, ASSISTANT_ASR_MODEL_SHA256: 'a'.repeat(64) });
after(async () => { for (const [i, name] of names.entries()) { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; } fs.rmSync(folder, { recursive:true, force:true }); await closePostgresPool(); });
const voice = (f: D4SharingFixture) => new SpeechService(f.actor, { kind:'consultation', id:f.conversationId });
const mock = async () => ({ text:'新房八十九平米，两个人住，希望书房留两个办公位置。', durationMs:1000, modelHash:'a'.repeat(64), configurationHash:speechConfigurationHash()! });
const state = (f: D4SharingFixture, id: string) => withTenantTransaction(f.eid, tx => one(tx, sql`select * from app.assistant_speech_assets where enterprise_id=${f.eid} and id=${id}`));

test('speech draft has real durable queue/zero text reservation; correction only enters the original send after explicit review, with same-key recovery and deletion', async () => {
  const f=new D4SharingFixture();try { await f.create();const service=voice(f), key=randomUUID(), upload=await service.upload(key,speechWav());
    assert.equal(upload.status,'queued');assert.equal((await service.upload(key,speechWav())).id,upload.id);
    await assert.rejects(()=>service.upload(key,speechWav(1200)),/idempotency_conflict/);
    const reservation=await withTenantTransaction(f.eid,tx=>one(tx,sql`select reserved_tokens,reserved_cost_micros from app.assistant_quota_reservations where enterprise_id=${f.eid} and run_id=${upload.runId}`));
    assert.equal(Number(reservation!.reserved_tokens),0);assert.equal(Number(reservation!.reserved_cost_micros),0);
    const lease=await claimJob();assert.equal(lease!.runId,upload.runId);await processSpeech(lease!,mock);
    const a=(await service.list()).items[0];assert.equal(a.status,'succeeded');assert.equal((await state(f,a.id))!.message_id,null);
    const msg={version:1,blocks:[{type:'text',text:'新房八十九平米，两个人住，希望次卧留两个办公位置。'}]}, body={id:a.id,version:a.version}, sendKey=randomUUID();
    const sent=await f.chat.send(f.conversationId,sendKey,msg,undefined,body);assert.equal((await f.chat.send(f.conversationId,sendKey,msg,undefined,body)).messageId,sent.messageId);
    assert.equal((await state(f,a.id))!.corrected_text,msg.blocks[0].text);assert.match(String((await state(f,a.id))!.transcript),/书房/);
    assert.equal((await service.read(a.id)).data.length,speechWav().length);
    const removeKey=randomUUID();await service.remove(a.id,removeKey);assert.deepEqual(await service.remove(a.id,removeKey),{id:a.id,deleted:true});
    await assert.rejects(()=>service.read(a.id),/assistant_resource_not_found/);assert.equal((await state(f,a.id))!.transcript,'');assert.equal((await state(f,a.id))!.data,null);
    const message=await withTenantTransaction(f.eid,tx=>one(tx,sql`select content from app.assistant_messages where enterprise_id=${f.eid} and id=${sent.messageId}`));assert.doesNotMatch(JSON.stringify(message),/次卧|八十九/);
  }finally{await f.cleanup();}
});
test('unsubmitted staff audio is author-private; sent audio follows live project membership and deletion withdraws its derived site draft',async()=>{
  const f=new D4SharingFixture();try{await f.create();const worker=f.site(f.memberIds[1]),service=new SpeechService(worker.actor,{kind:'site',id:f.projectId}),uploaded=await service.upload(randomUUID(),speechWav());
    const manager=new SpeechService(f.site().actor,{kind:'site',id:f.projectId});await assert.rejects(()=>manager.read(uploaded.id),/assistant_resource_not_found/);
    await processSpeech((await claimJob())!,mock);const a=(await service.list()).items[0],page=await worker.read(f.projectId);
    const sent=await worker.send(f.projectId,{text:'帮我记下书房今天的进展，线管铺好了，底盒还没有固定。',mediaIds:[],versions:page.versions,speech:{id:a.id,version:a.version}},randomUUID());
    // Exercise the existing interpretation/record chain; a queued selection is
    // not yet a site record. These are explicit engineering doubles, not ASR/model acceptance.
    await processSiteAction((await claimJob())!,async()=>({text:'',toolCalls:[{id:'report',name:'final_response',arguments:JSON.stringify({action:'report',target:''})}],finishReason:'tool_calls',providerRequestId:null,usage:{inputTokens:0,outputTokens:0}}));
    await processSiteRecord((await claimJob())!,async()=>({text:JSON.stringify({title:'书房进展',roomId:f.roomId,completed:'线管铺好了',pending:'底盒还没有固定',coordination:'',note:''}),toolCalls:[],finishReason:'stop',providerRequestId:null,usage:{inputTokens:0,outputTokens:0}}));
    assert.equal((await manager.read(a.id)).data.length,speechWav().length);
    await f.member(f.memberIds[1],'worker',false);await assert.rejects(()=>service.read(a.id));await f.member(f.memberIds[1],'worker',true);
    await service.remove(a.id,randomUUID());const r=await withTenantTransaction(f.eid,tx=>one(tx,sql`select status,data from app.construction_site_records where enterprise_id=${f.eid} and source_message_id=${sent.messageId}`));assert.equal(r!.status,'withdrawn');assert.deepEqual(r!.data,{});
  }finally{await f.cleanup();}
});
test('real local-service failure preserves the recording and only an explicit same-key retry creates the next durable attempt',async()=>{
  const f=new D4SharingFixture();try{await f.create();const service=voice(f),u=await service.upload(randomUUID(),speechWav());let calls=0;
    await processSpeech((await claimJob())!,async()=>{calls++;throw Error('synthetic service unavailable');});assert.equal(calls,1);
    const a=(await service.list()).items[0];assert.equal(a.status,'failed');assert.equal((await service.read(a.id)).data.length,speechWav().length);
    await assert.rejects(()=>f.chat.run(String(u.runId),'retry',randomUUID()),/assistant_capability_forbidden/);
    const key=randomUUID(),r=await service.retry(a.id,a.version,key);assert.notEqual(r.runId,u.runId);assert.equal((await service.retry(a.id,a.version,key)).runId,r.runId);
    await processSpeech((await claimJob())!,mock);assert.equal((await service.list()).items[0].status,'succeeded');
  }finally{await f.cleanup();}
});
test('a revoked recording while transcription is in flight cannot publish a late transcript or a chat message',async()=>{
  const f=new D4SharingFixture();try{await f.create();const service=voice(f),u=await service.upload(randomUUID(),speechWav());await processSpeech((await claimJob())!,async()=>{await service.remove(u.id,randomUUID());return mock();});
    assert.deepEqual((await service.list()).items,[]);assert.equal((await state(f,u.id))!.transcript,'');
    const r=await withTenantTransaction(f.eid,tx=>one(tx,sql`select output_message_id,status from app.assistant_runs where enterprise_id=${f.eid} and id=${u.runId}`));assert.equal(r!.status,'cancelled');assert.equal(r!.output_message_id,null);
  }finally{await f.cleanup();}
});
test('cross-tenant/user/project requests, stale correction versions and changed local configuration cannot gain audio or send a transcript',async()=>{
  const f=new D4SharingFixture();try{await f.create();const service=voice(f),u=await service.upload(randomUUID(),speechWav());await processSpeech((await claimJob())!,mock);const a=(await service.list()).items[0];
    for(const other of [new SpeechService({...f.actor,principal:{kind:'user',userId:f.userIds[1]}},{kind:'consultation',id:f.conversationId}),new SpeechService({...f.actor,enterpriseId:f.enterpriseIds[1]},{kind:'consultation',id:f.conversationId}),new SpeechService(siteActor({enterpriseId:f.eid,adminId:f.memberIds[1]}),{kind:'site',id:f.otherProjectId})])await assert.rejects(()=>other.read(a.id));
    await assert.rejects(()=>f.chat.send(f.conversationId,randomUUID(),{version:1,blocks:[{type:'text',text:'改成次卧。'}]},undefined,{id:a.id,version:a.version-1}),/speech_review_required/);
    const next=await service.upload(randomUUID(),speechWav(1200));let calls=0;const sha=process.env.ASSISTANT_ASR_MODEL_SHA256;process.env.ASSISTANT_ASR_MODEL_SHA256='b'.repeat(64);
    try{await processSpeech((await claimJob())!,async()=>{calls++;return mock();});}finally{process.env.ASSISTANT_ASR_MODEL_SHA256=sha;}
    assert.equal(calls,0);assert.equal((await state(f,next.id))!.transcript,'');assert.equal((await state(f,u.id))!.message_id,null);
  }finally{await f.cleanup();}
});
test('enterprise owner, admin and super_admin may prepare their own site recording without employee or project membership',async()=>{
  const f=new D4SharingFixture();try{await f.create();const managers=[f.ownerIds[0],...f.platformIds];
  await withTenantTransaction(f.eid,tx=>tx.execute(sql`delete from app.construction_members where enterprise_id=${f.eid} and project_id=${f.projectId}
    and admin_id in (${sql.join(managers.map(id=>sql`${id}`),sql`,`)})`));
  for(const aid of managers){
    const service=new SpeechService(f.site(aid).actor,{kind:'site',id:f.projectId}),u=await service.upload(randomUUID(),speechWav());
    await processSpeech((await claimJob())!,mock);assert.equal((await service.list()).items.find(a=>a.id===u.id)!.status,'succeeded');
    assert.equal((await service.read(u.id)).data.length,speechWav().length);await service.remove(u.id,randomUUID());
  }}finally{await f.cleanup();}
});
test('a successful local transcription cannot replace an unresolved paid-answer boundary or attach a new business message',async()=>{
  const f=new D4SharingFixture();try{await f.create();const paid=await f.chat.send(f.conversationId,randomUUID(),{version:1,blocks:[{type:'text',text:'先聊一下卧室怎么安排收纳。'}]}),lease=(await claimJob())!;
    assert.equal(lease.runId,paid.runId);await markProviderStarted(lease);await failRun(lease,'synthetic unanswered model dispatch');
    const service=voice(f);await service.upload(randomUUID(),speechWav());await processSpeech((await claimJob())!,mock);const a=(await service.list()).items[0];assert.equal(a.status,'succeeded');
    assert.equal((await f.chat.detail(f.conversationId)).latestRun!.id,paid.runId);
    await assert.rejects(()=>f.chat.send(f.conversationId,randomUUID(),{version:1,blocks:[{type:'text',text:'希望次卧有两个办公位置。'}]},undefined,{id:a.id,version:a.version}),/provider_outcome_unknown/);
    assert.equal((await state(f,a.id))!.message_id,null);const prior=await f.chat.run(String(paid.runId));assert.equal(prior.errorCode,'provider_outcome_unknown');
  }finally{await f.cleanup();}
});
