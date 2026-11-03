import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { wechatideNativeClient } from './wechatide-native-client';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { bindPublicLive,comparePublicLive } from './public-live-bindings.mjs';
import { closePostgresPool } from '@/lib/postgresql';
import { PublicLiveService } from '@/lib/construction/public-live/service';
import { stopLiveProxies } from '@/lib/construction/public-live/media';
import { PublicSiteCatalog } from '@/lib/construction/public-read';
import type { createLiveFixture } from './public-live-fixture';
loadEnvConfig(process.cwd(),true);
const root=path.resolve('..'),output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'../tmp/public-live-package/native01');
assert.ok(!fs.existsSync(path.join(output,'native.json')));fs.mkdirSync(output,{recursive:true});
const f=JSON.parse(fs.readFileSync('../tmp/public-live-package/native-fixture.json','utf8')) as Awaited<ReturnType<typeof createLiveFixture>> & {photoId:string;photoVersionId:string;liveId:string;versionId:string;revision:number;key:string};
const require=createRequire(path.resolve('package.json'));
async function main(){
  const connection=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8').replace(/^\uFEFF/,''));
  let release:Awaited<ReturnType<typeof lockAssistantAcceptance>>|undefined;
  const report:{passed?:boolean;error?:string;cleanup?:unknown;before?:unknown;drift?:unknown;native?:unknown}={};
  const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  const manager=new PublicLiveService({enterpriseId:f.eid,adminId:f.adminIds.enterprise_admin});
  try{
    release=await lockAssistantAcceptance(connection.DATABASE_URL,{waitForLock:false});
    const token=await new SignJWT({sub:f.users.owner,id:f.users.owner,mode:'customer',role:'user',contextVersion:1,source:'wechat'}).setSubject(f.users.owner).setAudience('miniprogram').setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const cli=wechatideNativeClient(path.join(root,'miniprogram'),output);
    const seeds=['admin/scripts/public-live-native.ts','admin/scripts/public-live-native.cjs','admin/scripts/wechatide-native-client.ts','admin/scripts/assistant-acceptance-safety.mjs',
      'tmp/public-live-package/native-fixture.json','miniprogram/app.json','miniprogram/project.config.json','miniprogram/project.private.config.json','miniprogram/packages/assistant/chat/chat-definition.js',
      'miniprogram/packages/assistant/chat/chat.wxml','miniprogram/packages/assistant/chat/chat.less','miniprogram/packages/assistant/chat/public-live.wxml','miniprogram/packages/assistant/chat/public-live.less',
      'miniprogram/packages/construction/public-site/public-site.js','miniprogram/packages/construction/public-site/public-site.wxml','miniprogram/packages/construction/public-site/public-site.less',
      ...['js','json','wxml','less'].map(ext=>'miniprogram/packages/construction/public-live/public-live.'+ext),
      'miniprogram/styles/assistant-chat-serif.less','miniprogram/packages/assistant/assets/xiaok-chat-avatar.png',
      'tmp/wechat-devtools-version-test/window.ps1','tmp/v1-02-conversation-list-visual/inspect-window.ps1','admin/src/proxy.ts',
      'admin/src/app/api/public/construction-live/[enterpriseId]/[[...path]]/route.ts','admin/src/app/api/miniprogram/assistant/public-live/[conversationId]/[[...path]]/route.ts'];
    report.before=bindPublicLive(seeds);save();
    const admitted=await manager.read(f.pid);assert.equal(admitted.material?.versionId,f.versionId);assert.equal(admitted.material?.key,f.key);assert.equal(admitted.material?.status,'pending_owner');
    report.native=await require(path.join(root,'admin/scripts/public-live-native.cjs'))({root,output,fixture:f,token,client:cli,assertHeld:async()=>{await release!.assertHeld();assert.deepEqual(comparePublicLive(report.before),[]);},
      publish:async()=>{const v=await manager.read(f.pid);assert.equal(v.material?.status,'owner_approved');await manager.mutate(f.pid,'publish',{versionId:v.material!.versionId,expectedRevision:v.revision},randomUUID());},
      assertPhoto:async()=>{assert.equal((await new PublicSiteCatalog(f.eid).detail(f.photoId)).versionId,f.photoVersionId);}});
    report.drift=comparePublicLive(report.before);assert.deepEqual(report.drift,[]);report.passed=true;
  }catch(e){report.passed=false;report.error=e instanceof Error?e.stack:String(e);throw e;}
  finally{
    try{const v=await manager.read(f.pid);if(v.material&&v.material.status!=='withdrawn')await manager.mutate(f.pid,'withdraw',{versionId:v.material.versionId,expectedRevision:v.revision},randomUUID());report.cleanup=await stopLiveProxies(f.eid,f.liveId);}
    catch(e){report.cleanup={stopped:false,error:e instanceof Error?e.message:String(e)};}
    if(report.before)report.drift=comparePublicLive(report.before);save();await release?.();await closePostgresPool();
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
