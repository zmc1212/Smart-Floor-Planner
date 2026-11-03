/** Fresh labelled local 微云1454 fixtures; no retained/customer database access. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { resolvePostgresRuntimeConfig, closePostgresPool } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { CameraService } from '@/lib/construction/camera/service';
import { ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
export async function createLiveFixture(){
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&target.port==='55434'&&target.pathname==='/sfp_public_live_eval');
  const prefix='synthetic-public-live-'+randomUUID(),eid='1454',control='1455';
  const fixture=await withPlatformTransaction(async tx=>{
    for(const id of [eid,control]){
      await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value values(${id},${id===eid?'微云 · 合成公开直播测试':'合成跨企业对照'},${'public-live-isolated-'+id},'active') on conflict(id) do nothing`);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${id},true,100,1000000,100000000,30) on conflict do nothing`);
    }
    await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys) values('construction_staff','合成施工员工',ARRAY['construction-projects']) on conflict(role_key) do nothing`);
    const adminIds:Record<string,string>={};
    for(const role of ['enterprise_admin','admin','super_admin','construction_staff']){
      const r=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${['admin','super_admin'].includes(role)?null:eid},${prefix+'-'+role},'synthetic-no-login',${role},'active',false,${'合成直播-'+role}) returning id`))!;adminIds[role]=String(r.id);
    }
    const users:Record<string,string>={};
    for(const label of ['owner','visitor']){
      const u=(await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+'-'+label},1) returning id`))!;users[label]=String(u.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(u.id)},${prefix+'-'+label})`);
    }
    const lead=(await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${users.owner},'合成直播业主','13900000001','natural') returning id`))!;
    return {prefix,eid,control,adminIds,users,leadId:String(lead.id)};
  });
  const staff={enterpriseId:eid,adminId:fixture.adminIds.enterprise_admin};
  const construction=new ConstructionService(staff);
  const project=await construction.execute('create',{leadId:fixture.leadId,name:'合成测试 · 公开直播',managerId:staff.adminId,rooms:[]},randomUUID());
  const pid=String(project.id);
  await construction.execute('member',{projectId:pid,expectedVersion:1,adminId:fixture.adminIds.construction_staff,role:'manager',active:true,workLabel:'合成直播管理员'},randomUUID());
  const actor:ActorContext={enterpriseId:eid,principal:{kind:'user',userId:fixture.users.owner},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'lead',id:fixture.leadId}};
  const cid=String((await new ConversationService(actor).create(randomUUID())).id);
  const visitor:ActorContext={...actor,principal:{kind:'user',userId:fixture.users.visitor},entry:{kind:'identity'}};
  const visitorCid=String((await new ConversationService(visitor).create(randomUUID())).id);
  const camera=new CameraService(staff),deviceId='99999999999999999991',channelId='99999999999999999992';
  const platformCamera=new CameraService({enterpriseId:eid,adminId:fixture.adminIds.super_admin});
  const c=await platformCamera.register({deviceId,channelId,name:'合成带音轨机位'});
  const binding=await camera.bind(pid,{cameraId:String(c.id),expectedVersion:Number(c.version),bind:true});
  const result={...fixture,pid,cid,visitorCid,actor,visitor,cameraId:String(c.id),bindingId:String(binding.bindingId),deviceId,channelId};
  fs.mkdirSync(path.resolve('../tmp/public-live-package'),{recursive:true});fs.writeFileSync(path.resolve('../tmp/public-live-package/fixture.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv.includes('--create'))createLiveFixture().then(f=>console.log(JSON.stringify({eid:f.eid,pid:f.pid,cid:f.cid,bindingId:f.bindingId}))).finally(()=>closePostgresPool()).catch(e=>{console.error(e);process.exitCode=1;});
