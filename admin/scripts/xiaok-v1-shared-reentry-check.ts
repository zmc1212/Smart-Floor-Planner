/** Zero-provider regression from the saved, originally failed S04 readback.
 * Only the owned synthetic source is reactivated inside a rolled-back savepoint.
 * Original model output, Evidence, participants and billing records are untouched. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadEnvConfig} from '@next/env';
import {sql} from 'drizzle-orm';
import {withTenantTransaction} from '@/db/transaction';
import {one,type Row} from '@/db/repositories/assistant-repository';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '@/lib/postgresql';
import {SiteChatService} from '@/lib/construction/site-chat';
import {safeText} from '@/lib/assistant/contracts';
import {lockAssistantAcceptance} from './assistant-acceptance-safety.mjs';
loadEnvConfig(process.cwd(),true);
const root=path.resolve('..'),eid='1454',pid='237',output=path.resolve(process.argv.find(v=>v.startsWith('--output='))!.slice(9));
const batch=process.argv.find(v=>v.startsWith('--batch='))?.slice(8)||'wire-http-01';assert.match(batch,/^[a-z0-9-]+$/);
const saved=JSON.parse(fs.readFileSync(path.join(root,'tmp/v1-01-weiyun-jingyi',batch,'report.json'),'utf8'));
const turn=saved.trials.find((trial:{kind:string})=>trial.kind==='shared').turns[0],documentId=String(saved.temporaryKnowledge.cloneId);
const report:Row&{checks:Row[]}={modelCalls:0,sourceBatch:batch,sourceRun:turn.runId,originalBatchPassed:false,semanticAcceptance:false,checks:[],passed:false};
const files=cp.execFileSync('rg',['--files','admin/src/lib/assistant','admin/src/lib/construction','admin/src/db'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/)
  .filter(file=>/\.tsx?$/.test(file)).concat(['admin/scripts/xiaok-v1-shared-reentry-check.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/.env.local','admin/package-lock.json']);
const binding=()=>Object.fromEntries(files.sort().map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const beforeBinding=binding();report.bindingBefore=beforeBinding;
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
let release:(()=>Promise<void>)|undefined;
async function main(){const database=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development')&&database.hostname==='localhost'&&database.port==='5432'&&database.pathname==='/smart_floor_planner');
  fs.mkdirSync(output,{recursive:true});assert.ok(!fs.existsSync(path.join(output,'report.json')));
  release=await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL,{waitForLock:true});
  await withTenantTransaction(eid,async tx=>{const before=await one(tx,sql`select id,title,status,version,published_version_id from app.assistant_knowledge_documents where enterprise_id=${eid} and id=${documentId} for update`);
    assert.ok(before);assert.match(String(before.title),/^合成测试/);assert.equal(before.status,'retired');report.originalSource=before;
    await tx.execute(sql`savepoint synthetic_shared_readback`);
    try{await tx.execute(sql`update app.assistant_knowledge_documents set status='active' where enterprise_id=${eid} and id=${documentId}`);
      const actual=await one(tx,sql`select m.content from app.assistant_runs r join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.output_message_id where r.enterprise_id=${eid} and r.id=${String(turn.runId)} and r.purpose='site.question'`);assert.ok(actual);
      const originalText=safeText(actual.content as Parameters<typeof safeText>[0]);assert.equal(originalText,turn.text);
      for(const [role,adminId] of [['worker','5371'],['designer','5368'],['owner','2853'],['admin','5374'],['super_admin','16']]){
        const data=await new SiteChatService({enterpriseId:eid,adminId},tx).read(pid) as Row;
        const item=(data.items as Row[]).find(i=>String((i.response as Row)?.runId)===String(turn.runId));
        const response=item?.response as Row|undefined;const visible=response?.text===originalText;
        report.checks.push({role,visible,actual:response?.text,expectedOriginal:originalText});save();assert.equal(visible,true,'Saved S04 answer must reenter for '+role);
      }
      await tx.execute(sql`savepoint synthetic_member_revocation`);
      try{await tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eid} and project_id=${pid} and admin_id=5371`);
        await assert.rejects(()=>new SiteChatService({enterpriseId:eid,adminId:'5371'},tx).read(pid),/construction_not_found|assistant_resource_not_found|construction_forbidden/);
        report.checks.push({removedMemberDenied:true});}finally{await tx.execute(sql`rollback to savepoint synthetic_member_revocation`);}
      await tx.execute(sql`savepoint synthetic_stage_revision`);
      try{await tx.execute(sql`update app.construction_projects set progress_revision=progress_revision+1 where enterprise_id=${eid} and id=${pid}`);
        const state=await new SiteChatService({enterpriseId:eid,adminId:'5371'},tx).read(pid) as Row;
        const item=(state.items as Row[]).find(i=>String((i.response as Row)?.runId)===String(turn.runId));assert.match(String((item!.response as Row).text),/项目阶段已变化/);
        report.checks.push({stageRevisionInvalidatesAnswer:true});}finally{await tx.execute(sql`rollback to savepoint synthetic_stage_revision`);}
      await tx.execute(sql`update app.assistant_knowledge_documents set status='retired' where enterprise_id=${eid} and id=${documentId}`);
      const withdrawn=await new SiteChatService({enterpriseId:eid,adminId:'5371'},tx).read(pid) as Row;
      const item=(withdrawn.items as Row[]).find(i=>String((i.response as Row)?.runId)===String(turn.runId));assert.match(String((item!.response as Row).text),/原回答不再沿用/);
      assert.deepEqual((item!.response as Row).citations,[]);report.checks.push({withdrawnUnavailable:true});
    }finally{await tx.execute(sql`rollback to savepoint synthetic_shared_readback`);
      assert.deepEqual(await one(tx,sql`select id,title,status,version,published_version_id from app.assistant_knowledge_documents where enterprise_id=${eid} and id=${documentId}`),before);report.sourceRestored=true;save();}
  });report.passed=true;
}
main().catch(error=>{report.error=(error as Error).message;process.exitCode=1;}).finally(async()=>{report.bindingAfter=binding();report.drift=files.filter(file=>beforeBinding[file]!== (report.bindingAfter as Record<string,string>)[file]);
  if((report.drift as string[]).length){report.passed=false;process.exitCode=1;}
  if(release)await release();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,sourceRestored:report.sourceRestored,modelCalls:0,bindings:files.length,drift:report.drift}));await closePostgresPool();});
