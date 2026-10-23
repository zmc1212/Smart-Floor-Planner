import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '../src/db/transaction';
import { one } from '../src/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '../src/lib/postgresql';
import { CameraService } from '../src/lib/construction/camera/service';
import { signMiniProgramToken } from '../src/lib/miniprogram-jwt';

async function main() {
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
if (!['localhost','127.0.0.1'].includes(target.hostname) || target.port !== '55432' || target.pathname !== '/cloud_camera_eval') throw Error('Isolated camera database required');
const output = path.resolve('../tmp/cloud-camera'); fs.mkdirSync(output,{recursive:true});
const fixtureFile = path.join(output,'fixture.private.json');
try {
  if (fs.existsSync(fixtureFile)) { console.log('Existing isolated camera fixture retained'); }
  else {
    const prefix = 'camera-ui-' + randomUUID(), password = randomUUID()+'aA1!', username = prefix, passwordHash = await bcrypt.hash(password,10);
    const fixture = await withPlatformTransaction(async tx => {
      const enterpriseId = String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · 云工地摄像头',${prefix},'active') returning id`))!.id);
      const userId = String((await one(tx,sql`insert into app.users(nickname,phone,context_version) values('测试专用摄像头负责人','13900001022',1) returning id`))!.id);
      const adminId = String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${enterpriseId},${username},${passwordHash},'admin','active',false,'摄像头验收管理员') returning id`))!.id);
      const ownerId = String((await one(tx,sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,status,must_change_password,display_name)
        values(${enterpriseId},${userId},${prefix+'-owner'},${passwordHash},'enterprise_admin','active',false,'摄像头验收负责人') returning id`))!.id);
      const leadId = String((await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${enterpriseId},${userId},'测试专用摄像头客户','13800001022','natural') returning id`))!.id);
      const projectId = String((await one(tx,sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${enterpriseId},${leadId},'云工地视频 · 隔离验收现场') returning id`))!.id);
      await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${enterpriseId},${projectId},${ownerId},'manager')`);
      return {enterpriseId,userId,adminId,ownerId,leadId,projectId};
    });
    const service = new CameraService({enterpriseId:fixture.enterpriseId,adminId:fixture.adminId});
    const camera = await service.register({deviceId:'34020000001320000003',channelId:'34020000001320000004',name:'现场摄像头 80'});
    const bound = await service.bind(fixture.projectId,{cameraId:String(camera.id),expectedVersion:Number(camera.version),bind:true});
    const miniToken = await signMiniProgramToken({sub:fixture.userId,id:fixture.userId,mode:'staff',role:'enterprise_admin',staffRole:'enterprise_admin',staffId:fixture.ownerId,enterpriseId:fixture.enterpriseId,contextVersion:1,source:'phone'});
    fs.writeFileSync(fixtureFile,JSON.stringify({...fixture,username,password,miniToken,cameraId:String(camera.id),bindingId:String(bound.bindingId)},null,2));
    console.log(JSON.stringify({created:true,enterpriseId:fixture.enterpriseId,projectId:fixture.projectId,cameraId:String(camera.id)}));
  }
} finally { await closePostgresPool(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Camera fixture failed'); process.exitCode=1; });
