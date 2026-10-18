import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { GET,POST } from '@/app/api/assistant/usage/[[...path]]/route';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction,withTenantTransaction } from '@/db/transaction';
import { one,rows,type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool,resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { UsageService,usageWindow,exactAmount } from '@/lib/assistant/core/usage';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob,markProviderStarted,failRun } from '@/lib/assistant/infrastructure/job-queue';
import type { ActorContext } from '@/lib/assistant/contracts';

const prefix='usage-test-'+randomUUID(),tenants:string[]=[],admins:string[]=[],users:string[]=[];
let actor:ActorContext,reviewer:ActorContext,service:UsageService;
before(async()=>{
  loadEnvConfig(process.cwd());const url=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++) {
      const e=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!;tenants.push(String(e.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${String(e.id)},true,1000,12000000,1000000000,90)`);
      const a=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${String(e.id)},${prefix+i},'test-only','enterprise_admin','active',ARRAY['assistant-usage','assistant-usage-reconcile'],false) returning id`))!;admins.push(String(a.id));
      const u=(await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!;users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(u.id)},${prefix+i})`);
    }
  });
  actor={enterpriseId:tenants[0],principal:{kind:'user',userId:users[0]},contextVersion:1,capabilities:['assistant.chat.self']};
  reviewer={...actor,principal:{kind:'admin',adminId:admins[0]},capabilities:[]};service=new UsageService(reviewer);
});
after(async()=>{
  await withPlatformTransaction(async tx=>{for(const e of tenants){await deleteAssistantData(tx,BigInt(e));await tx.execute(sql`delete from app.admin_users where enterprise_id=${e}`);await tx.execute(sql`delete from app.enterprises where id=${e}`);}for(const u of users)await tx.execute(sql`delete from app.users where id=${u}`);});await closePostgresPool();
});
async function pending(age=true) {
  const chat=new ConversationService(actor),c=await chat.create(randomUUID());
  const run=await chat.send(String(c.id),randomUUID(),{version:1,blocks:[{type:'text',text:'PRIVATE BODY MUST NOT APPEAR'}]});
  const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,run.runId);
  await markProviderStarted(lease);await failRun(lease,'timeout');
  return withTenantTransaction(tenants[0],async tx=>{
    if(age)await tx.execute(sql`update app.assistant_jobs set provider_started_at=now()-interval '5 minutes' where id=${lease.jobId}`);
    return (await one(tx,sql`select id::text,run_id::text,version from app.assistant_quota_reservations where run_id=${lease.runId}`))!;
  });
}
const body=(q:Row)=>({expectedVersion:Number(q.version),tokens:'100',costMicros:'23000',currency:'CNY',evidenceReference:'provider-bill:verified-123',reason:'Provider bill and token usage verified manually'});
test('date windows and integer money reject malformed, fractional, overflow and excessive input',()=>{
  assert.deepEqual(usageWindow('2026-10-01','2026-10-15'),{from:'2026-10-01',to:'2026-10-15'});
  for(const end of ['bad','2026-02-30','2027-10-01'])assert.throws(()=>usageWindow('2026-10-01',end));
  for(const n of ['1.2','-1','01','9223372036854775808',1])assert.throws(()=>exactAmount(n));
  assert.equal(exactAmount('0'),'0');
});
test('summary preserves unknowns, contains no chat content and enforces database permission and tenant RLS',async()=>{
  const q=await pending();
  const summary=await service.summary();assert.ok(!JSON.stringify(summary).includes('PRIVATE BODY'));
  assert.ok(summary.costs.some(c=>c.status==='reconciling' && c.confirmed_cost_micros===null));
  const other=new UsageService({...reviewer,enterpriseId:tenants[1],principal:{kind:'admin',adminId:admins[1]}});
  assert.equal((await other.pending()).items.length,0);await assert.rejects(other.detail(String(q.id)),/not_found/);
  assert.equal((await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select id from app.assistant_quota_reservations where id=${String(q.id)}`))).length,0);
  await assert.rejects(new UsageService(actor).summary(),/forbidden/);
  await assert.rejects(new UsageService({...reviewer,enterpriseId:tenants[1]}).summary(),/forbidden/);
  const details=await service.detail(String(q.id));assert.equal(details.review,null);
});
test('in-flight safety interval blocks reconciliation after cancellation or timeout',async()=>{
  const q=await pending(false);assert.equal((await service.pending()).items.find(x=>x.id===q.id)!.reviewable,false);
  await assert.rejects(service.reconcile(String(q.id),body(q),randomUUID()),/in_flight/);
});
test('concurrent same-key reviews settle once, preserve audit, do not replay indeterminate run, and use actual budget',async()=>{
  const q=await pending(),key=randomUUID(),input=body(q),before=(await service.summary()).budget!;
  const [a,b]=await Promise.all([service.reconcile(String(q.id),input,key),service.reconcile(String(q.id),input,key)]);
  assert.deepEqual(a,b);const detail=await service.detail(String(q.id));assert.equal(detail.review!.cost_micros,'23000');
  const after=(await service.summary()).budget!;
  assert.equal(BigInt(String(before.cost_micros))-BigInt(String(after.cost_micros)),BigInt(1000000-23000));
  await assert.rejects(service.reconcile(String(q.id),{...input,costMicros:'0'},key),/idempotency_conflict/);
  await assert.rejects(service.reconcile(String(q.id),input,randomUUID()),/review_conflict/);
  const run=await withTenantTransaction(tenants[0],tx=>one(tx,sql`select status from app.assistant_runs where id=${String(q.run_id)}`));assert.equal(run!.status,'indeterminate');
});
test('review permission, currency, stale version and conflicting observed usage fail closed',async()=>{
  const q=await pending();
  await assert.rejects(service.reconcile(String(q.id),{...body(q),currency:'USD'},randomUUID()),/invalid_message/);
  await assert.rejects(service.reconcile(String(q.id),{...body(q),expectedVersion:999},randomUUID()),/review_conflict/);
  await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-usage'] where id=${admins[0]}`));
  await service.summary();await assert.rejects(service.reconcile(String(q.id),body(q),randomUUID()),/forbidden/);
  await withTenantTransaction(tenants[0],async tx=>{
    await tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-usage','assistant-usage-reconcile'] where id=${admins[0]}`);
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
      values(${tenants[0]},${String(q.run_id)},${'answer:'+q.run_id},'tokens',120,'observed',100,20)`);
  });
  await assert.rejects(service.reconcile(String(q.id),body(q),randomUUID()),/observed_tokens_conflict/);
  await service.reconcile(String(q.id),{...body(q),tokens:'120',costMicros:'0'},randomUUID());
});
test('previous-day unresolved holds remain in budget; settlement is attributed to original day',async()=>{
  const q=await pending();await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.assistant_quota_reservations set budget_date=(now() at time zone 'UTC')::date-1 where id=${String(q.id)}`));
  const before=(await service.summary()).budget!;await service.reconcile(String(q.id),body(q),randomUUID());const after=(await service.summary()).budget!;
  assert.equal(BigInt(String(before.cost_micros))-BigInt(String(after.cost_micros)),BigInt(1000000));
});
test('confirmed cost above reservation remains counted and blocks new spending',async()=>{
  const q=await pending();await service.reconcile(String(q.id),{...body(q),costMicros:'2000000000'},randomUUID());
  const chat=new ConversationService(actor),c=await chat.create(randomUUID());
  await assert.rejects(chat.send(String(c.id),randomUUID(),{version:1,blocks:[{type:'text',text:'budget guard'}]}),/quota_exceeded/);
  assert.ok(BigInt(String((await service.summary()).budget!.cost_micros))>BigInt(1000000000));
});
test('HTTP enforces roles, strict input, no-store and server permission checks',async()=>{
  const token=async(role:string)=>new SignJWT({id:admins[0],enterpriseId:tenants[0],role}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const req=(auth:string,query='',body?:unknown)=>new NextRequest('http://localhost:3006/api/assistant/usage'+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+auth,'Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined});
  const admin=await token('enterprise_admin');
  assert.equal((await GET(req(await token('super_admin')),{params:Promise.resolve({})})).status,403);
  const ok=await GET(req(admin),{params:Promise.resolve({})});assert.equal(ok.status,200);assert.equal(ok.headers.get('Cache-Control'),'no-store');
  assert.equal((await GET(req(admin,'?enterpriseId='+tenants[1]),{params:Promise.resolve({})})).status,422);
  assert.equal((await GET(req(admin,'?to=bad'),{params:Promise.resolve({})})).status,422);
  assert.equal((await POST(req(admin,'',{tokens:'0'}),{params:Promise.resolve({path:['reconciliations','1']})})).status,422);
});
