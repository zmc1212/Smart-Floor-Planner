/* eslint-disable @typescript-eslint/no-require-imports -- Same Stable CommonJS native driver. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {liveTargetSelectors,revealNativeLiveTarget}=require('./public-live-native-target.cjs');

module.exports=async function diagnose({cli,project,fixture:f,output,controlVideoUrl,page,ownerReady,wait,capture}) {
  assert.match(controlVideoUrl,/^http:\/\/127\.0\.0\.1:3019\/construction-camera\/__qa-public-live-[a-f0-9-]+\.mp4$/);
  const route='packages/assistant/chat/chat',result={scope:'One actual owner HLS attempt, one same-origin synthetic H264 MP4 control, direct current manifest/segment decode; no approval/publication or business pass'};
  const save=()=>fs.writeFileSync(path.join(output,'media-diagnostic.json'),JSON.stringify(result,null,2)+'\n');
  let hooked=false;
  try {
    await cli.reLaunch('/'+route+'?conversationId='+f.cid);const p=await page(route);let r=await ownerReady(p);
    assert.equal(r.card.status,'pending_owner');
    hooked=true;
    await cli.evaluate(()=>{
      const p=getCurrentPages().at(-1),s=getApp().__qaPublicLive;
      s.mediaEvents=[];s.mediaPhase='hls';s.mediaHooks={page:p,error:p.livePlaybackError,progress:p.livePlaybackProgress};
      p.livePlaybackError=function(e){s.mediaEvents.push({phase:s.mediaPhase,kind:'error',detail:e.detail,attempt:e.currentTarget.dataset.attempt,src:this.data.livePreviewUrl});return s.mediaHooks.error.call(this,e);};
      p.livePlaybackProgress=function(e){if(e.detail.currentTime>0&&!s.mediaEvents.some(v=>v.phase===s.mediaPhase&&v.kind==='progress'))s.mediaEvents.push({phase:s.mediaPhase,kind:'progress',detail:e.detail,attempt:e.currentTarget.dataset.attempt,src:this.data.livePreviewUrl});return s.mediaHooks.progress.call(this,e);};
      return {installed:true};
    });
    result.actionTarget=await revealNativeLiveTarget(cli,project,f.liveId,r.card.messageId,'action',wait);
    await (await p.$(liveTargetSelectors(r.card.messageId,'action')[0])).tap();
    await wait(async()=>{const d=await p.data();return d.liveExpanded===f.liveId&&!d.liveBusy;},'actual owner preview session');
    r=await ownerReady(p);result.scopeTarget=await revealNativeLiveTarget(cli,project,f.liveId,r.card.messageId,'scope',wait);
    const terminal=phase=>wait(async()=>{
      const state=await cli.evaluate(()=>{const s=getApp().__qaPublicLive,p=getCurrentPages().at(-1);return {events:s.mediaEvents,sessionUrl:s.lastOwnerSessionUrl||'',ready:p.data.livePreviewReady,url:p.data.livePreviewUrl,error:p.data.liveError};});
      return state.events.some(e=>e.phase===phase&&(e.kind==='error'||e.kind==='progress'))?state:null;
    },'actual '+phase+' native media event',30);
    result.hls=await terminal('hls');save();await capture('owner-hls-diagnostic',route);
    assert.ok(result.hls.sessionUrl,'Actual owner session URL was not observed');
    result.approvalAttribute=await cli.call('automation_element_action',{project,selector:liveTargetSelectors(r.card.messageId,'action')[0],action:'attribute',name:'disabled'});
    const control=()=>{const p=getCurrentPages().at(-1),s=getApp().__qaPublicLive;s.mediaPhase='mp4';p.liveConsent.resetPreview({liveError:''});p.setData({livePreviewUrl:'__CONTROL_VIDEO__',livePreviewAttempt:p.data.livePreviewAttempt+1000,livePreviewReady:false});return {control:true,consentEligible:false};};
    await cli.evaluateSource(control.toString().replace("'__CONTROL_VIDEO__'",JSON.stringify(controlVideoUrl)));
    result.mp4=await terminal('mp4');save();await capture('owner-mp4-control',route);
    assert.equal(result.mp4.ready,false,'A diagnostic control must not enable consent');
    const playlist=await fetch(result.hls.sessionUrl);assert.equal(playlist.status,200);const body=await playlist.text();fs.writeFileSync(path.join(output,'manifest.txt'),body);
    const line=body.split(/\r?\n/).find(l=>l.trim()&&!l.startsWith('#'));assert.ok(line,'No actual HLS segment');
    const segmentUrl=new URL(line,result.hls.sessionUrl);assert.equal(segmentUrl.origin,'http://127.0.0.1:3019');
    const segment=await fetch(segmentUrl);assert.equal(segment.status,200);const bytes=Buffer.from(await segment.arrayBuffer());assert.ok(bytes.length>1000&&bytes.length<2e6);
    const file=path.join(output,'first-segment.ts');fs.writeFileSync(file,bytes);
    const probe=cp.spawnSync('G:/ffmpeg-8.0-essentials_build/bin/ffprobe.exe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:15000});
    fs.writeFileSync(path.join(output,'segment-probe.json'),probe.stdout||'');assert.equal(probe.status,0,probe.stderr);
    const streams=JSON.parse(probe.stdout).streams;assert.ok(streams.some(s=>s.codec_type==='video'));assert.ok(!streams.some(s=>s.codec_type==='audio'));
    const decode=cp.spawnSync('G:/ffmpeg-8.0-essentials_build/bin/ffmpeg.exe',['-v','error','-i',file,'-frames:v','1','-f','null','-'],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(decode.status,0,decode.stderr);
    result.transport={manifestStatus:playlist.status,segmentStatus:segment.status,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),streams:streams.map(s=>({codec:s.codec_name,type:s.codec_type,profile:s.profile,pixFmt:s.pix_fmt,width:s.width,height:s.height,level:s.level})),decodedFirstFrame:true};
    result.completed=true;return result;
  }finally{
    if(hooked)result.hooksRestored=await cli.evaluate(()=>{const s=getApp().__qaPublicLive,h=s.mediaHooks;if(h){h.page.livePlaybackError=h.error;h.page.livePlaybackProgress=h.progress;h.page.liveConsent.clear();delete s.mediaHooks;}return {restored:true};});
    save();
  }
};
