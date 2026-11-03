import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { WechatideCliError, wechatideNativeClient } from './wechatide-native-client';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { bindPublicLive,comparePublicLive } from './public-live-bindings.mjs';
import { closePostgresPool } from '@/lib/postgresql';
import { PublicLiveService } from '@/lib/construction/public-live/service';
import { stopLiveProxies } from '@/lib/construction/public-live/media';
import { PublicSiteCatalog } from '@/lib/construction/public-read';
import type { createLiveFixture } from './public-live-fixture';
loadEnvConfig(process.cwd(),true);
const root=path.resolve('..'),output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'../tmp/public-live-package/native01');
const diagnoseOwnerMedia=process.argv.includes('--diagnose-owner-media'),controlVideoUrl=process.argv.find(a=>a.startsWith('--control-video-url='))?.slice('--control-video-url='.length);
if(diagnoseOwnerMedia)assert.match(controlVideoUrl||'',/^http:\/\/127\.0\.0\.1:3019\/construction-camera\/__qa-public-live-[a-f0-9-]+\.mp4$/);
assert.ok(!fs.existsSync(path.join(output,'native.json')));fs.mkdirSync(output,{recursive:true});
const f=JSON.parse(fs.readFileSync('../tmp/public-live-package/native-fixture.json','utf8')) as Awaited<ReturnType<typeof createLiveFixture>> & {photoId:string;photoVersionId:string;liveId:string;versionId:string;revision:number;key:string};
const require=createRequire(path.resolve('package.json'));
type NativeBinding={files:Record<string,string>;config:Record<string,string>;scope:string};
async function main(){
  const connection=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8').replace(/^\uFEFF/,''));
  let release:Awaited<ReturnType<typeof lockAssistantAcceptance>>|undefined;
  const report:{passed?:boolean;error?:string;cliFailure?:unknown;cleanup?:unknown;before?:NativeBinding;drift?:unknown;native?:unknown;compileReuse?:unknown}={};
  const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  const manager=new PublicLiveService({enterpriseId:f.eid,adminId:f.adminIds.enterprise_admin});
  try{
    release=await lockAssistantAcceptance(connection.DATABASE_URL,{waitForLock:true});
    const token=await new SignJWT({sub:f.users.owner,id:f.users.owner,mode:'customer',role:'user',contextVersion:1,source:'wechat'}).setSubject(f.users.owner).setAudience('miniprogram').setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const cli=wechatideNativeClient(path.join(root,'miniprogram'),output);
    const seeds=['admin/scripts/public-live-native.ts','admin/scripts/public-live-native.cjs','admin/scripts/wechatide-native-client.ts','admin/scripts/assistant-acceptance-safety.mjs',
      'tmp/public-live-package/native-fixture.json','miniprogram/app.json','miniprogram/project.config.json','miniprogram/project.private.config.json','miniprogram/packages/assistant/chat/chat-definition.js',
      'miniprogram/packages/assistant/chat/chat.wxml','miniprogram/packages/assistant/chat/chat.less','miniprogram/packages/assistant/chat/public-live.wxml','miniprogram/packages/assistant/chat/public-live.less',
      'miniprogram/packages/construction/public-site/public-site.js','miniprogram/packages/construction/public-site/public-site.wxml','miniprogram/packages/construction/public-site/public-site.less',
      ...['js','json','wxml','less'].map(ext=>'miniprogram/packages/construction/public-live/public-live.'+ext),
      'miniprogram/styles/assistant-chat-serif.less','miniprogram/packages/assistant/assets/xiaok-chat-avatar.png',
      'tmp/wechat-devtools-version-test/window.ps1','tmp/v1-02-conversation-list-visual/inspect-window.ps1','admin/src/proxy.ts',
      'admin/src/app/api/public/construction-live/[enterpriseId]/[[...path]]/route.ts','admin/src/app/api/miniprogram/assistant/public-live/[conversationId]/[[...path]]/route.ts',
      'admin/.env.local','tmp/public-live-package/serve.ps1','tmp/public-live-package/compose.yml','tmp/public-live-package/media.ini',
      'D:/微信开发工具/微信web开发者工具/resources/app.asar','D:/微信开发工具/微信web开发者工具/resources/app.asar.unpacked/js/common/cli/skill-index.js',
      'D:/微信开发工具/微信web开发者工具/resources/app.asar.unpacked/wechatide-skill/wechatide-tools/references/tools.yaml',
      ...cp.execFileSync('git',['ls-files','-co','--exclude-standard','-z','miniprogram'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}).split('\0').filter(Boolean)];
    const reuseArg=process.argv.find(a=>a.startsWith('--reuse-compiled-mini='))?.slice('--reuse-compiled-mini='.length);
    if(diagnoseOwnerMedia)seeds.push('admin/public'+new URL(controlVideoUrl!).pathname);
    let reuseEvidence: {before:Record<string,string>;drift:string[];lockReleased:boolean;calls:Array<{name:string;ok:boolean;dataKeys?:number;elements?:number}>}|undefined;
    if(reuseArg){
      const file=path.resolve(reuseArg),bytes=fs.readFileSync(file);reuseEvidence=JSON.parse(bytes.toString('utf8'));
      assert.equal(reuseEvidence!.lockReleased,true);assert.deepEqual(reuseEvidence!.drift,[]);
      const legacyReady=reuseEvidence!.calls.some(c=>c.name==='visible-same-read'&&c.ok);
      const pageReady=reuseEvidence!.calls.some(c=>c.name==='sdk-data'&&c.ok)&&reuseEvidence!.calls.some(c=>c.name==='app-data'&&c.ok&&(c.dataKeys||0)>0)&&reuseEvidence!.calls.some(c=>c.name==='elements'&&c.ok&&(c.elements||0)>0);
      assert.ok(legacyReady||pageReady,'A nonempty actual page and positive SDK elements are required');
      seeds.push(file);
      if(legacyReady)seeds.push('tmp/public-live-package/native08/report.json','tmp/public-live-package/native08/native.json','tmp/public-live-package/native08/visibility-window-trace.json');
      report.compileReuse={evidence:path.relative(root,file),sha256:createHash('sha256').update(bytes).digest('hex'),reason:'Same compiled Mini/runtime sources; reuse the completed compile plus settled successful Page.getData evidence, not the failed immediate-read/business batch.'};
    }
    report.before=bindPublicLive(seeds);
    if(reuseEvidence){
      const unchanged=Object.entries(reuseEvidence.before).filter(([p])=>p.startsWith('miniprogram/')||p.startsWith('D:/'));
      assert.ok(unchanged.length>1100);for(const [p,want]of unchanged)assert.equal(report.before.files[p],want,'Compiled dependency changed: '+p);
      report.compileReuse={...report.compileReuse as object,unchangedDependencies:unchanged.length};
    }
    save();
    const admitted=await manager.read(f.pid);assert.equal(admitted.material?.versionId,f.versionId);assert.equal(admitted.material?.key,f.key);assert.equal(admitted.material?.status,'pending_owner');
    report.native=await require(path.join(root,'admin/scripts/public-live-native.cjs'))({root,output,fixture:f,token,client:cli,diagnoseOwnerMedia,controlVideoUrl,compileReuse:report.compileReuse,assertHeld:async()=>{await release!.assertHeld();assert.deepEqual(comparePublicLive(report.before),[]);},
      publish:async()=>{const v=await manager.read(f.pid);assert.equal(v.material?.status,'owner_approved');await manager.mutate(f.pid,'publish',{versionId:v.material!.versionId,expectedRevision:v.revision},randomUUID());},
      assertPhoto:async()=>{assert.equal((await new PublicSiteCatalog(f.eid).detail(f.photoId)).versionId,f.photoVersionId);}});
    report.drift=comparePublicLive(report.before);assert.deepEqual(report.drift,[]);report.passed=true;
  }catch(e){report.passed=false;report.error=e instanceof Error?e.stack:String(e);if(e instanceof WechatideCliError)report.cliFailure=e.toJSON();throw e;}
  finally{
    try{const v=await manager.read(f.pid);if(v.material&&v.material.status!=='withdrawn')await manager.mutate(f.pid,'withdraw',{versionId:v.material.versionId,expectedRevision:v.revision},randomUUID());report.cleanup=await stopLiveProxies(f.eid,f.liveId);}
    catch(e){report.cleanup={stopped:false,error:e instanceof Error?e.message:String(e)};}
    try{if(report.before)report.drift=comparePublicLive(report.before);save();}
    finally{await release?.();await closePostgresPool();}
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
