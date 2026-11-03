import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PublicLiveService } from '@/lib/construction/public-live/service';
import { stopLiveProxies } from '@/lib/construction/public-live/media';
import { closePostgresPool,resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import assert from 'node:assert/strict';
async function main(){
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(target.port,'55434');assert.equal(target.pathname,'/sfp_public_live_eval');
  const p='../tmp/public-live-package/native-fixture.json',f=JSON.parse(fs.readFileSync(p,'utf8'));
  const service=new PublicLiveService({enterpriseId:f.eid,adminId:f.adminIds.enterprise_admin});let view=await service.read(f.pid);
  if(view.material&&view.material.status!=='withdrawn')await service.mutate(f.pid,'withdraw',{versionId:view.material.versionId,expectedRevision:view.revision},randomUUID());
  assert.equal((await stopLiveProxies(f.eid,f.liveId)).stopped,true);view=await service.read(f.pid);
  let s=await service.save(f.pid,{expectedRevision:view.revision,bindingId:f.bindingId,alias:'客厅机位',name:'合成公开工地 · 水电阶段'},randomUUID());
  s=await service.mutate(f.pid,'submit',{versionId:s.versionId,expectedRevision:s.revision},randomUUID());
  fs.writeFileSync(p,JSON.stringify({...f,liveId:s.id,key:s.key,versionId:s.versionId,revision:s.revision},null,2)+'\n');console.log(JSON.stringify({liveId:s.id,versionId:s.versionId,status:s.status}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}).finally(()=>closePostgresPool());
