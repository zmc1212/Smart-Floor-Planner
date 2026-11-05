/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated acceptance inspects dynamic imports and private SQL snapshots; no product input is typed here. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(process.cwd() + '/package.json');
require('@next/env').loadEnvConfig(process.cwd(), true);
const providerSourceDatabase = process.env.DATABASE_URL;
const { sql } = require('drizzle-orm');
process.env.DATABASE_URL = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8')).DATABASE_URL;
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const { withTenantTransaction, withPlatformTransaction } = await imp('src/db/transaction.ts');
const { one, rows } = await imp('src/db/repositories/assistant-repository.ts');
const { AdminUserRepository } = await imp('src/db/repositories/admin-user-repository.ts');
const { MiniProgramIdentityRepository } = await imp('src/db/repositories/miniprogram-identity-repository.ts');
const { UserRepository } = await imp('src/db/repositories/user-repository.ts');
const { closePostgresPool, resolvePostgresRuntimeConfig } = await imp('src/lib/postgresql.ts');
const { ConstructionService } = await imp('src/lib/construction/service.ts');
const { processSiteRecord } = await imp('src/lib/construction/site-worker.ts');
const { SiteChatService, recordVersion } = await imp('src/lib/construction/site-chat.ts');
const { appendMessage } = await imp('src/lib/assistant/core/conversation.ts');
const { ensureFollowupBinding, enqueueReport } = await imp('src/lib/construction/report-store.ts');
const { FollowupService } = await imp('src/lib/construction/followup-service.ts');
const { processConstructionReport, deliverConstructionReports } = await imp('src/lib/construction/report-worker.ts');
const { processReportComposition } = await imp('src/lib/construction/report-body-worker.ts');
const { claimJob } = await imp('src/lib/assistant/infrastructure/job-queue.ts');
const { lockAssistantAcceptance } = await imp('scripts/assistant-acceptance-safety.mjs');

const root = path.resolve('..');
const base = path.join(root, 'tmp/v1-knowledge-switch-20261106');
const out = path.resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6) || '../tmp/v1-report-photos-20261106/service01');
const live = process.argv.includes('--live');
const engineering=process.argv.includes('--engineering');
const replay = process.argv.find(a => a.startsWith('--replay='))?.slice(9);
assert.equal([live,!!replay,engineering].filter(Boolean).length,1,'Choose --live, --replay=<prior report.json>, or --engineering; no automatic retry');
fs.mkdirSync(out, { recursive: true });
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Never overwrite an earlier attempt');
const report: any = {
  target: 'isolated55432/xiaok_embedding_eval', enterpriseId: '1454', passed: false,
  plan: 'Manager kitchen photo and worker window photo: two fixed first drafts through the existing S04 Worker, human publication, then four-role daily/weekly originals and revocation. Report advice reused; no new report model calls.',
  live, engineeringFixture:engineering, trials: [], model: 'qwen3.8-flash', repairRounds: 0,
  modelOutputIsEngineeringFixture: true, sourceRun: '10581', results: [],
};
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const eid = '1454', prefix = 'synthetic-photo-report-' + randomUUID();
report.fixturePrefix = prefix;
const read = (work: any) => withTenantTransaction(eid, work);
const platform = (work: any) => withPlatformTransaction(work);
const ts = require('typescript');
const cfg = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(cfg.config, ts.sys, process.cwd()).options;
const files = new Set<string>();
function visit(f: string) {
  if (files.has(f) || f.includes('node_modules') || !fs.existsSync(f)) return;
  files.add(f);
  for (const i of ts.preProcessFile(fs.readFileSync(f, 'utf8'), true, true).importedFiles) {
    const r = ts.resolveModuleName(i.fileName, f, options, ts.sys).resolvedModule?.resolvedFileName;
    if (r) visit(path.resolve(r));
  }
}
for (const f of ['src/lib/construction/service.ts', 'src/lib/construction/site-chat.ts', 'src/lib/construction/report-worker.ts',
  'src/lib/construction/report-body-worker.ts', 'src/lib/construction/followup-service.ts', 'src/lib/construction/site-worker.ts']) visit(path.resolve(f));
for (const f of [fileURLToPath(import.meta.url), path.join(base, 'service-live04-remaining-trial/run-10581.json'),
  path.resolve('package.json'), path.resolve('package-lock.json'), path.resolve('tsconfig.json'), path.resolve('.env.local'),
  path.resolve('../tmp/xiaok-vector/connection.private.json'), path.resolve('scripts/xiaok-v1-report-photos-native.cjs'),
  path.resolve('../miniprogram/utils/assistant-followups.js'), path.resolve('../miniprogram/test/assistant-followups.test.js'),
  ...['demolition.jpg','window.jpg','workshop.jpg','manifest.json'].map(f => path.resolve('../tmp/xiaok-vector/renovation-photos',f))]) files.add(f);
const binding = () => Object.fromEntries([...files].sort().map(f => [path.relative(root, f).replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const counts = () => platform(async (tx: any) => ({
  provider: Number((await one(tx, sql`select count(*)::int n from app.ai_provider_attempts`)).n),
  queue: Number((await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)).n),
  pending: Number((await one(tx, sql`select count(*)::int n from app.construction_report_deliveries where state in ('pending','held')`)).n),
}));
const saved = JSON.parse(fs.readFileSync(path.join(base, 'service-live04-remaining-trial/run-10581.json'), 'utf8'));
const output = saved.steps.find((s: any) => s.kind === 'agent_model').private_checkpoint;
const advice = JSON.parse(output.toolCalls[0].arguments).P1;
const fixtureModel = async (_messages: any, tools: any) => ({ text: '', toolCalls: [{ id: 'saved-advice-fixture', name: 'final_response',
  arguments: JSON.stringify(Object.fromEntries(Object.keys(tools[0].parameters.properties).map(k => [k, advice]))) }],
  finishReason: 'tool_calls', usage: { inputTokens: 0, outputTokens: 0 } });
let release: any, assistantBefore: any, settingsBefore: any, platformBefore: any, owner: any, pid = '', secondPid = '', ownerId = '', managerId = '', workerId = '', designerId = '';
const allRecords: any[] = [];
const staffUsers: string[] = [];
const users: string[] = [], bindings: any[] = [];
const priorFetch = globalThis.fetch;
try {
  const u = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(u.hostname) && u.port === '55432' && u.pathname === '/xiaok_embedding_eval');
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  if (!live) globalThis.fetch = async () => { throw Error('Replay permits no external fetch or paid model'); };
  report.before = await counts(); assert.equal(report.before.queue, 0); assert.equal(report.before.pending, 0);
  assistantBefore = await read((tx: any) => one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=1454`));
  settingsBefore = await read((tx: any) => one(tx, sql`select * from app.construction_report_settings where enterprise_id=1454`));
  assert.equal(assistantBefore.enabled, false); assert.equal(settingsBefore.enabled, false);
  await read((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,
    agent_config=${JSON.stringify({...assistantBefore.agent_config,model:'qwen3.8-flash',enterpriseKnowledgeEnabled:false})}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  if (live) {
    const sourceUrl = new URL(providerSourceDatabase!);
    assert.ok(['localhost','127.0.0.1'].includes(sourceUrl.hostname) && sourceUrl.port==='5432' && sourceUrl.pathname==='/smart_floor_planner');
    const client = new (require('pg').Client)({connectionString:providerSourceDatabase}); let source: any;
    try { await client.connect(); await client.query('begin read only'); source=(await client.query("select llm_config from app.platform_configs where key='default'")).rows[0]?.llm_config; await client.query('rollback'); } finally { await client.end(); }
    assert.equal(source?.providerKey,'dashscope');
    platformBefore=await platform((tx:any)=>one(tx,sql`select llm_config from app.platform_configs where key='default' for update`));
    await platform((tx:any)=>tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify({...source,model:'qwen3.8-flash'})}::jsonb where key='default'`));
  }
  report.bindingBefore = binding(); save();
  await platform(async (tx: any) => {
    for (let i = 0; i < 2; i++) {
      const id = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + ':customer:' + i},1) returning id`)).id);
      users.push(id); await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${id},${prefix + ':' + i})`);
    }
    for (const a of [{ tag: 'owner', role: 'enterprise_admin' }, { tag: 'manager', role: 'construction_staff' },
      { tag: 'worker', role: 'construction_staff' }, { tag: 'designer', role: 'designer' }]) {
      const id = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password)
        values(1454,${prefix + ':' + a.tag},${'合成测试·无知识报告·' + a.tag},'unusable-local-fixture',${a.role},'active',false) returning id`)).id);
      if (a.tag === 'owner') ownerId = id; else if (a.tag === 'manager') managerId = id;
      else if (a.tag === 'worker') workerId = id; else designerId = id;
    }
  });
  owner = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
  const lead = await read((tx: any) => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(1454,${users[0]},${prefix + ':lead'},${'138' + String(Date.now()).slice(-8)},'natural') returning id`));
  pid = String((await owner.execute('create', { leadId: String(lead.id), name: '合成测试·施工照片日报周报', managerId, rooms: ['厨房','客厅'] }, randomUUID())).id);
  let detail = await owner.execute('detail', { projectId: pid });
  await owner.execute('update', { projectId: pid, expectedVersion: Number(detail.project.version), name: detail.project.name, status: 'active', customerAccess: true }, randomUUID());
  for (const member of [{ adminId: workerId, role: 'worker' }, { adminId: designerId, role: 'designer' }]) {
    detail = await owner.execute('detail', { projectId: pid });
    await owner.execute('member', { projectId: pid, expectedVersion: Number(detail.project.version), ...member, active: true, workLabel: '' }, randomUUID());
  }
  detail = await owner.execute('detail', { projectId: pid });
  await owner.execute('progress', { projectId: pid, expectedVersion: Number(detail.project.version), stageKey: 'utilities', note: '合成测试·水电阶段', sendReminder: false }, randomUUID());
  const fixed = [
    { role: 'manager', authorId: managerId, file: 'demolition.jpg', text: '厨房旧吊顶拆除这一项今天做完了，水电还没验收，照片是刚拍的。', completed: '拆', pending: '验收' },
    { role: 'worker', authorId: workerId, file: 'window.jpg', text: '客厅窗框今天装好了，边上收口还没做，等经理来核对。', completed: '窗', pending: '收口' },
  ];
  const previous = replay ? JSON.parse(fs.readFileSync(path.resolve(replay),'utf8')) : null;
  const photos = path.join(root,'tmp/xiaok-vector/renovation-photos');
  async function publish(test: any, audience = 'customer', infer = true) {
    const staff = new SiteChatService({enterpriseId:eid,adminId:test.authorId});
    const bytes = fs.readFileSync(path.join(photos,test.file)), uploadKey=randomUUID();
    const media=await staff.upload(pid,uploadKey,bytes); assert.deepEqual(await staff.upload(pid,uploadKey,bytes),media);
    let record: any;
    if (infer) {
      const sent=await staff.send(pid,{text:test.text,mediaIds:[media.id]},randomUUID());
      assert.ok(sent.runId); const lease=await claimJob(); assert.equal(lease.runId,sent.runId);
      const reused=previous?.trials.find((t:any)=>t.role===test.role);
      if (replay) assert.ok(reused?.output,'Only an already saved original result may be replayed');
      const room=await read((tx:any)=>one(tx,sql`select id::text from app.construction_rooms where enterprise_id=1454 and project_id=${pid} and name=${test.role==='manager'?'厨房':'客厅'}`));
      const synthetic={title:'合成测试·人工确认的施工记录',roomId:room.id,completed:test.role==='manager'?'厨房旧吊顶拆除已记录':'客厅窗框安装已记录',pending:test.role==='manager'?'水电尚未验收':'窗边收口还没做',coordination:test.role==='manager'?'':'待经理现场核对',note:'仅用于工程链路的人工事实夹具，不作模型理解通过'};
      await processSiteRecord(lease, engineering ? async()=>({text:JSON.stringify(synthetic),toolCalls:[],finishReason:'stop',providerRequestId:null,usage:{inputTokens:0,outputTokens:0}}) : replay ? async()=>reused.output : undefined);
      const run=await read((tx:any)=>one(tx,sql`select status,error_code,policy_snapshot from app.assistant_runs where enterprise_id=1454 and id=${sent.runId}`));
      const steps=await read((tx:any)=>rows(tx,sql`select * from app.assistant_run_steps where enterprise_id=1454 and run_id=${sent.runId} order by step_seq`));
      record=await read((tx:any)=>one(tx,sql`select * from app.construction_site_records where enterprise_id=1454 and id=${sent.recordId}`));
      const output=steps.find((s:any)=>s.step_seq===1100)?.private_checkpoint;
      report.trials.push({role:test.role,input:test.text,file:test.file,imageHash:createHash('sha256').update(bytes).digest('hex'),runId:sent.runId,mediaId:media.id,recordId:sent.recordId,status:run.status,error:run.error_code,output,data:record.data,engineeringFixture:engineering,reusedFrom:reused?.runId||null});save();
      fs.writeFileSync(path.join(out,'run-'+sent.runId+'.json'),JSON.stringify({run,steps},null,2));
      assert.equal(run.status,'succeeded',run.error_code); assert.equal(record.status,'draft');
      assert.ok(record.data.completed.includes(test.completed)); assert.ok(record.data.pending.includes(test.pending));
      assert.ok(!/验收通过|验收合格/.test(JSON.stringify(record.data)), 'An unaccepted site was not accepted by the model');
      if (test.role==='worker') await assert.rejects(()=>staff.mutate(pid,String(record.id),'publish',{expectedVersion:Number(record.version),audience:'customer'},randomUUID()),/forbidden/);
    } else {
      record=await staff.withWriteScope(pid,async(tx:any,c:any)=>{
        const m=await appendMessage(tx,staff.actor,String(c.id),{author:'admin',clientMessageId:randomUUID(),purpose:'site.source',content:{version:1,blocks:[{type:'text',text:test.text}]}});
        const r=await one(tx,sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
          values(1454,${pid},${String(c.id)},${String(m.id)},${test.authorId},'draft',${JSON.stringify({title:'合成测试·内部材料',roomId:null,completed:test.text,pending:'',coordination:'',note:''})}::jsonb) returning *`);
        await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(1454,${pid},${String(r.id)},${media.id},0)`);
        await recordVersion(tx,eid,r,test.authorId,'organized'); return r;
      });
    }
    await new SiteChatService(owner.actor).mutate(pid,String(record.id),'publish',{expectedVersion:Number(record.version),audience},randomUUID());
    const original=await staff.media(pid,media.id);
    const value=await read((tx:any)=>one(tx,sql`select id::text,version,published_at from app.construction_site_records where enterprise_id=1454 and id=${String(record.id)}`));
    const valueWithMedia={...value,mediaId:media.id,authorId:test.authorId,normalizedHash:createHash('sha256').update(original.data).digest('hex')};
    allRecords.push(valueWithMedia); return valueWithMedia;
  }
  const older=await publish(fixed[0]);
  const dailyStart=new Date(new Date(older.published_at).getTime()+1);
  const internal=await publish({authorId:workerId,file:'workshop.jpg',text:'内部材料清点仍需交接'},'internal',false);
  const current=await publish(fixed[1]);
  const databaseClock = await read((tx: any) => one(tx, sql`select clock_timestamp() as at`));
  const end = new Date(databaseClock.at), weeklyStart = new Date(new Date(older.published_at).getTime() - 1000);
  report.fixtureRecords = { projectId: pid, older, internal, current, dailyStart, weeklyStart, end }; save();
  assert.ok(new Date(current.published_at) >= dailyStart && new Date(current.published_at) < end);
  const secondLead=await read((tx:any)=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(1454,${users[1]},${prefix+':other-lead'},${'137'+String(Date.now()).slice(-8)},'natural') returning id`));
  secondPid=String((await owner.execute('create',{leadId:String(secondLead.id),name:'合成测试·仍获权的第二工地',managerId,rooms:[]},randomUUID())).id);
  const settings = await read((tx: any) => one(tx, sql`update app.construction_report_settings set enabled=true,
    project_ids=${JSON.stringify([pid,secondPid])}::jsonb,stage_keys='[]'::jsonb,audiences='["customer","worker","designer","boss"]'::jsonb,version=version+1 where enterprise_id=1454 returning *`));
  for (const recipient of [{ kind: 'user', id: users[0], audience: 'customer', projectId: pid },
    { kind: 'admin', id: workerId, audience: 'worker' }, { kind: 'admin', id: designerId, audience: 'designer' }, { kind: 'admin', id: ownerId, audience: 'boss' }]) {
    const b = await read((tx: any) => ensureFollowupBinding(tx, eid, recipient)); bindings.push(b);
  }
  report.fixture = { users, ownerId, managerId, workerId, designerId, projectId: pid, records: { older, internal, current }, bindingIds: bindings.map(b => String(b.id)) };
  for (const b of bindings) for (const kind of ['daily', 'weekly']) {
    const actor = { enterpriseId: eid, principal: b.user_id ? { kind: 'user', userId: String(b.user_id) } : { kind: 'admin', adminId: String(b.admin_id) },
      contextVersion: b.user_id ? 1 : 0, capabilities: ['assistant.followup.self', 'assistant.chat.self'] };
    const q = await read((tx: any) => enqueueReport(tx, eid, b, settings, { kind, start: kind === 'daily' ? dailyStart : weeklyStart, end, cutoff: end, scheduledAt: end }));
    assert.ok(q, b.audience + ':' + kind + ' must enqueue');
    const factLease = await claimJob(); assert.equal(factLease.runId, q.runId); await processConstructionReport(factLease);
    const v = await read((tx: any) => one(tx, sql`select * from app.construction_report_versions where enterprise_id=1454 and report_id=${q.reportId} and revision=1`));
    assert.equal(v.status, 'facts_ready');
    const bodyLease = await claimJob(); assert.equal(bodyLease.runId, String(v.body_run_id));
    await processReportComposition(bodyLease, { model: fixtureModel, retriever: { retrieve: async () => { throw Error('No enterprise retrieval allowed'); } } });
    const run = await read((tx: any) => one(tx, sql`select status,error_code,policy_snapshot from app.assistant_runs where enterprise_id=1454 and id=${String(v.body_run_id)}`));
    assert.equal(run.status, 'succeeded', run.error_code);
    assert.equal(run.policy_snapshot.knowledgePolicy.enabled, false);
    assert.equal(await deliverConstructionReports(eid), 1); assert.equal(await deliverConstructionReports(eid), 0);
    const svc = new FollowupService(actor), opened = await svc.detail(String(b.id), q.reportId, 1), again = await svc.detail(String(b.id), q.reportId, 1);
    assert.equal(opened.available, true); assert.equal(opened.contentStatus, 'composed'); assert.deepEqual(opened.body, again.body);
    const ids = opened.facts.projects[0].records.map((r: any) => r.id);
    assert.ok(ids.includes(current.id)); assert.equal(ids.includes(older.id), kind === 'weekly');
    assert.equal(ids.includes(internal.id), b.audience !== 'customer');
    assert.ok(JSON.stringify(opened.body).includes('通用建议（模型知识）')); assert.equal(opened.body[0].knowledgeSources.length, 0);
    await assert.rejects(() => new FollowupService({ ...actor, principal: { kind: 'user', userId: users[1] }, contextVersion: 1 }).detail(String(b.id), q.reportId, 1), /not_found|forbidden/);
    fs.writeFileSync(path.join(out, b.audience + '-' + kind + '.json'), JSON.stringify(opened, null, 2));
    for(const r of allRecords.filter(r=>ids.includes(r.id))) {
      const source=await svc.record(String(b.id),q.reportId,1,pid,r.id);assert.equal(source.version,Number(r.version));assert.ok(source.media.some((m:any)=>m.id===r.mediaId));
      const photo=await svc.recordMedia(String(b.id),q.reportId,1,pid,r.id,r.mediaId);assert.equal(createHash('sha256').update(photo.data).digest('hex'),r.normalizedHash);
    }
    if(b.audience==='customer') await assert.rejects(()=>svc.record(String(b.id),q.reportId,1,pid,internal.id),/not_found|forbidden/);
    report.results.push({ audience: b.audience, kind, reportId: q.reportId, runId: String(v.body_run_id), recordIds: ids, originalsVerified:true, passed: true }); save();
  }
  let withdrawn=false;
  async function withdraw(){if(withdrawn)return;await new SiteChatService({enterpriseId:eid,adminId:managerId}).mutate(pid,current.id,'withdraw',{expectedVersion:Number(current.version),reason:'合成测试撤回本条已核对照片记录'},randomUUID());withdrawn=true;}
  if (process.argv.includes('--native')) {
    const {SignJWT}=require('jose');const actors:any[]=[];
    for(const b of bindings){
      let uid=b.user_id?String(b.user_id):'';const aid=b.admin_id?String(b.admin_id):'';
      const role=b.audience==='boss'?'enterprise_admin':b.audience==='worker'?'construction_staff':b.audience==='designer'?'designer':'user';
      let contextVersion=1;
      if(!uid){
        const user=await platform(async(tx:any)=>{const account=await new AdminUserRepository(tx).findById(BigInt(aid));assert.ok(account&&!account.userId);
          const mini=new MiniProgramIdentityRepository(tx),u=await mini.ensureStaffUser(account);staffUsers.push(String(u.id));
          await new UserRepository(tx).update(u.id,{phone:'199'+String(u.id).padStart(8,'0')});
          assert.ok(await mini.selectContext(u.id,{mode:'staff',staffId:BigInt(aid),enterpriseId:BigInt(eid)}));return u;});
        uid=String(user.id);contextVersion=Number(user.contextVersion);
      }
      const token=await new SignJWT({id:uid,mode:aid?'staff':'customer',role,...(aid?{staffId:aid,staffRole:role}:{}),enterpriseId:eid,contextVersion,source:'password'})
        .setProtectedHeader({alg:'HS256'}).setSubject(uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET||'fallback_secret_random_123'));
      actors.push({name:b.audience,uid,aid,role,token,bid:String(b.id),cid:String(b.conversation_id),leadId:String(lead.id),projectId:pid,record:current,reports:report.results.filter((r:any)=>r.audience===b.audience)});
    }
    const {assistantHttp}=await imp('src/lib/assistant/application/http.ts');
    report.native=await require(path.resolve('scripts/xiaok-v1-report-photos-native.cjs'))({root,output:out,actors,assistantHttp,withdraw});save();assert.equal(report.native.passed,true);
  }
  // The recipient relationship is revalidated on saved reads, not just generation.
  detail = await owner.execute('detail', { projectId: pid });
  await owner.execute('member', { projectId: pid, expectedVersion: Number(detail.project.version), adminId: designerId, role: 'designer', active: false, workLabel: '' }, randomUUID());
  const designerBinding = bindings.find(b => b.audience === 'designer');
  const designerReport = report.results.find((r: any) => r.audience === 'designer');
  const revoked = await new FollowupService({ enterpriseId: eid, principal: { kind: 'admin', adminId: designerId }, contextVersion: 0, capabilities: ['assistant.followup.self'] })
    .detail(String(designerBinding.id), designerReport.reportId, 1).catch((e: any) => ({ available: false, error: String(e) }));
  assert.equal(revoked.available, false); report.membershipRevocation = true;
  const worker=new SiteChatService({enterpriseId:eid,adminId:workerId});
  await assert.rejects(()=>worker.mutate(pid,older.id,'withdraw',{expectedVersion:Number(older.version),reason:'合成撤回权限检查'},randomUUID()),/forbidden/);
  await withdraw();
  for(const b of bindings.filter(b=>b.audience!=='designer')) for(const r of report.results.filter((r:any)=>r.audience===b.audience)){
    const actor={enterpriseId:eid,principal:b.user_id?{kind:'user',userId:String(b.user_id)}:{kind:'admin',adminId:String(b.admin_id)},contextVersion:b.user_id?1:0,capabilities:['assistant.followup.self']};
    const svc=new FollowupService(actor); const gone=await svc.detail(String(b.id),r.reportId,1);assert.equal(gone.available,b.audience==='boss');assert.ok(!gone.facts?.projects.some((p:any)=>p.id===pid));
    await assert.rejects(()=>svc.recordMedia(String(b.id),r.reportId,1,pid,current.id,current.mediaId),/not_found|forbidden/);
  }
  report.withdrawal={managerCanWithdrawWorker:true,workerCannotWithdrawManager:true,savedReportsAndOriginalsRevoked:true};
  report.after = await counts(); assert.equal(report.after.provider-report.before.provider,live?2:0); assert.equal(report.after.queue, 0); assert.equal(report.after.pending, 0);
  report.passed = true;
} catch (e) { report.error = (e as Error).stack || String(e); process.exitCode = 1; }
finally {
  try {
    for (const b of bindings) await read((tx: any) => tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=1454 and id=${String(b.id)}`));
    for (const b of bindings) await read((tx: any) => tx.execute(sql`update app.construction_report_deliveries set state='revoked' where enterprise_id=1454 and binding_id=${String(b.id)} and state in ('pending','held')`));
    for(const projectId of [pid,secondPid].filter(Boolean)) if(owner){const d=await owner.execute('detail',{projectId});await owner.execute('update',{projectId,expectedVersion:Number(d.project.version),name:d.project.name,status:'archived',customerAccess:false},randomUUID());}
    await platform((tx: any) => tx.execute(sql`update app.admin_users set status='disabled' where username like ${prefix + '%'}`));
    for (const id of [...users,...staffUsers]) await platform((tx: any) => tx.execute(sql`update app.users set context_version=context_version+1 where id=${id}`));
    if (settingsBefore) await read((tx: any) => tx.execute(sql`update app.construction_report_settings set enabled=${settingsBefore.enabled},project_ids=${JSON.stringify(settingsBefore.project_ids)}::jsonb,
      stage_keys=${JSON.stringify(settingsBefore.stage_keys)}::jsonb,audiences=${JSON.stringify(settingsBefore.audiences)}::jsonb,version=version+1 where enterprise_id=1454`));
    if (platformBefore) await platform((tx:any)=>tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`));
    if (assistantBefore) await read((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${assistantBefore.enabled},agent_config=${JSON.stringify(assistantBefore.agent_config)}::jsonb,
      policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
    if(pid) await read((tx:any)=>tx.execute(sql`update app.construction_site_media set data=null,deleted_at=coalesce(deleted_at,now()) where enterprise_id=1454 and project_id=${pid}`));
    report.cleanup = { restored: true, bindingsStopped: bindings.length, projectArchived: !!pid, testAccountsDisabled: true };
    report.usage=await read((tx:any)=>rows(tx,sql`select u.run_id::text,u.provider_attempt_id::text,u.input_tokens,u.output_tokens,u.quantity from app.assistant_usage_records u where u.enterprise_id=1454 and u.run_id in (select id from app.assistant_runs where enterprise_id=1454 and conversation_id in(select conversation_id from app.construction_chats where enterprise_id=1454 and project_id=${pid||'0'})) order by u.id`)).catch((e:any)=>({error:String(e)}));
    report.finalCounts = await counts(); assert.equal(report.finalCounts.queue, 0); assert.equal(report.finalCounts.pending, 0);
  } catch (e) { report.cleanupError = String(e); report.passed = false; process.exitCode = 1; }
  globalThis.fetch = priorFetch;
  if (release) await release();
  if (report.bindingBefore) { report.bindingAfter = binding(); report.drift = Object.keys(report.bindingBefore).filter(f => report.bindingBefore[f] !== report.bindingAfter[f]); if (report.drift.length) { report.passed = false; process.exitCode = 1; } }
  save(); await closePostgresPool();
  console.log(JSON.stringify({ passed: report.passed, reports: report.results.length, error: report.error, cleanupError: report.cleanupError, cleanup: report.cleanup, counts: report.finalCounts, drift: report.drift }));
}
