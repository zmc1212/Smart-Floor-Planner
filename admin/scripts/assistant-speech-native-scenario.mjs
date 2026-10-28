import assert from 'node:assert/strict';
export async function speechHttpDenial(mp,url) {
  const token=await mp.evaluate(()=>getApp().globalData.token);
  // The supported SDK installs its own callbacks. Serializing a callback-rich
  // function from tsx can capture esbuild's unavailable __name helper.
  const response=await mp.callWxMethod('request',{url,method:'GET',header:{Authorization:'Bearer '+token}});
  return response.statusCode;
}
/** Recorder authorization/input is synthetic; native page/HTTP/ASR/Worker/database are real. */
export async function runSpeechScenario(ctx) {
  const { mp, step, identity, current, check, takeRoute: captureRoute, customerOpen, trial, save, index, fixtures } = ctx;
  const takeRoute=async(name,route)=>{await mp.callWxMethod('hideKeyboard');return captureRoute(name,route);};
  const chat='packages/assistant/chat/chat',site='packages/construction/chat/chat';
  let page;
  const voiceState=()=>mp.evaluate(()=>{const p=getCurrentPages().at(-1),v=p.speechController;return v?{asset:v.asset,pending:!!v.client?.pending.get('speech-upload:'+v.base),visible:v.visible}:null;});
  const action=async name=>mp.evaluate(value=>{getApp().__qaSpeech.nextAction=value;},name);
  const record=async(bytes,drop=false)=>{
    await mp.evaluate((value,lost)=>{const s=getApp().__qaSpeech;s.audioPath=wx.env.USER_DATA_PATH+'/d6-synthetic-voice.wav';
      wx.getFileSystemManager().writeFileSync(s.audioPath,value,'base64');s.paths.push(s.audioPath);if(lost)getApp().__qaShared.dropSpeechNext=true;},bytes.toString('base64'),drop);
    await page.callMethod(index===0?'voiceInput':'voice');
  };
  const waitAsset=expected=>check(async()=>{const v=await voiceState();return v?.asset?.status===expected?v.asset:false;},'actual persisted speech '+expected);
  const playback=async messageId=>{
    await action('回听原音');const selector=index===0?'.bubble[data-message="'+messageId+'"]':'.source-bubble[data-message="'+messageId+'"]';
    await (await page.$(selector)).trigger('longpress');
    await check(()=>mp.evaluate(()=>getApp().__qaSpeech.plays>0&&(getApp().__qaSpeech.started>0||getApp().__qaSpeech.audioErrors.length>0)),'authenticated original playback API');
    const state=await mp.evaluate(()=>({plays:getApp().__qaSpeech.plays,started:getApp().__qaSpeech.started,errors:getApp().__qaSpeech.audioErrors}));
    assert.ok(state.started>0);assert.deepEqual(state.errors,[]);
    return state;
  };
  try {
    await step('install owned PCM recorder fixture while retaining native page/HTTP paths',async()=>{
      await mp.evaluate(()=>{const app=getApp();if(app.__qaSpeech)throw Error('Speech controller already owned');
        const s=app.__qaSpeech={originals:{},paths:[],nextAction:'',plays:0,started:0,audioErrors:[],players:[]};
        for(const key of ['getRecorderManager','authorize','showModal','showActionSheet','createInnerAudioContext'])s.originals[key]=wx[key];
        let stopped=null,errored=null;
        const manager={start(options){s.recorderOptions=options;},stop(){const callback=stopped;if(callback)setTimeout(()=>callback({tempFilePath:s.audioPath}),20);},
          onStop(callback){stopped=callback;},offStop(callback){if(stopped===callback)stopped=null;},onError(callback){errored=callback;},offError(callback){if(errored===callback)errored=null;}};
        wx.getRecorderManager=()=>manager;
        wx.authorize=o=>o.scope==='scope.record'?o.success?.({}):s.originals.authorize.call(wx,o);
        wx.showModal=o=>['正在录音','删除这段录音？'].includes(o.title)?o.success?.({confirm:true,cancel:false}):s.originals.showModal.call(wx,o);
        wx.showActionSheet=o=>{const i=o.itemList.indexOf(s.nextAction);if(i<0)throw Error('Unexpected speech actions: '+JSON.stringify(o.itemList));o.success?.({tapIndex:i});};
        wx.createInnerAudioContext=()=>{const player=s.originals.createInnerAudioContext.call(wx);s.players.push(player);player.volume=0;const play=player.play;
          player.play=function(){s.plays++;return play.call(player);};player.onPlay(()=>{s.started++;});player.onError(error=>s.audioErrors.push(error.errCode));return player;};
        return {recorderSynthetic:true,originalAudioApiRetained:true,volume:0};
      });
      if(index===0)page=await customerOpen();else{await identity(2);page=await current();}
      return {route:page.path};
    });
    if(ctx.revokedReadback) {
      await step('removed member has an empty fatal state and no original audio access',async()=>{
        const data=await page.data();assert.equal(data.fatal,true);assert.equal(data.write,false);assert.deepEqual(data.items,[]);
        assert.equal(data.speechBusy,false);assert.ok(!data.speechAvailable);
        await ctx.denyOriginal(ctx.savedSpeech.id);await takeRoute('speech-member-revoked',site);
        return {memberRevoked:true,emptyHistory:true,originalDenied:true};
      });
      return;
    }
    if(ctx.readback) {
      if(ctx.deletedReadback) {
        await step('deleted original remains erased on reentry and its actual HTTP audio request is denied',async()=>{
          const row=await ctx.readAsset(ctx.savedSpeech.id);assert.ok(row.deleted_at);assert.equal(row.data,null);
          assert.equal(row.transcript,'');assert.equal(row.corrected_text,'');
          assert.ok(ctx.reusedPlayback.started>0);assert.deepEqual(ctx.reusedPlayback.errors,[]);
          await check(async()=>(await page.data()).messages.some(m=>m.id===String(row.message_id)&&m.available===false),'persisted deleted placeholder');
          await ctx.denyOriginal(ctx.savedSpeech.id);
          // Long histories put the existing run footer below the initial view;
          // exercise the real scroll control instead of injecting page data.
          await (await page.$('.conversation-scroll')).scrollTo(0,100000);
          const state=await check(()=>page.$('.run-state'),'existing failed-answer footer');
          assert.match(await state.text(),/这次回答没有完成/);
          await takeRoute('speech-customer-deleted',chat);
          trial.reusedPlayback=ctx.reusedPlayback;save();return {erased:true,httpDenied:true,newInference:false};
        });
        return;
      }
      await step('original customer correction and truthful failed-answer feedback survive reentry',async()=>{
        const row=await ctx.readAsset(ctx.savedSpeech.id);assert.ok(row.message_id);
        assert.equal(row.transcript,ctx.savedSpeech.transcript);assert.equal(row.corrected_text,fixtures[0].correction);
        const data=await page.data();assert.equal(data.run.status,'failed');assert.equal(data.runLabel,'这次回答没有完成');
        assert.ok(data.messages.some(m=>m.id===String(row.message_id)&&m.available!==false));
        const original=await ctx.readOriginal(ctx.savedSpeech.id);assert.equal(original.hash,fixtures[0].sha256);
        trial.speechTranscription={...ctx.savedSpeech,messageId:String(row.message_id)};save();
        await takeRoute('speech-customer-answer-failed',chat);return {messageId:String(row.message_id),normalAnswerPassed:false};
      });
      await step('authenticated original replay and deletion work after the failed answer without any new inference',async()=>{
        const id=trial.speechTranscription.messageId;trial.audioPlayback=await playback(id);save();
        await action('删除录音及转写');await (await page.$('.bubble[data-message="'+id+'"]')).trigger('longpress');
        await check(async()=>(await page.data()).messages.some(m=>m.id===id&&m.available===false),'deleted original unavailable');
        const row=await ctx.readAsset(ctx.savedSpeech.id);assert.equal(row.data,null);assert.equal(row.transcript,'');assert.equal(row.corrected_text,'');
        await ctx.denyOriginal(ctx.savedSpeech.id);page=await customerOpen();await takeRoute('speech-customer-deleted',chat);
        return {originalUnavailable:true,normalAnswerPassed:false};
      });
      return;
    }
    if(index===0&&!ctx.resume) {
      await step('actual silent-audio service failure survives reentry and explicit retry without changing the original',async()=>{
        trial.phase='silent-speech';trial.expectedSpeechFailure=true;save();await record(ctx.silence());const original=await waitAsset('failed');await ctx.idle();
        assert.equal((await page.data()).speechBusy,false);assert.match((await page.data()).speechError,/原音已保留/);
        await takeRoute('speech-failed',chat);page=await customerOpen();assert.equal((await waitAsset('failed')).id,original.id);
        await action('重新转写');await page.callMethod('voiceInput');const retried=await check(async()=>{const a=(await voiceState())?.asset;return a?.status==='failed'&&a.runId!==original.runId?a:false;},'new durable local retry');await ctx.idle();
        assert.equal(retried.sourceHash,original.sourceHash);trial.silentAttempts=[original,retried];save();
        await action('删除录音及转写');await page.callMethod('voiceInput');await check(async()=>!(await voiceState())?.asset,'failed recording deleted');
        trial.expectedSpeechFailure=false;save();return {first:original.runId,retry:retried.runId,sameOriginal:true};
      });
    }
    if(ctx.resume) await step('queued speech visibly explains processing and original text remains editable',async()=>{
      const probe=await ctx.createProcessingProbe();
      try {
        await mp.evaluate(()=>getCurrentPages().at(-1).speechController.refresh());
        assert.equal((await page.data()).speechBusy,true);
        const notice=await check(()=>page.$(index===0?'.notice':'.feedback'),'processing notice rendered after data update');
        await check(async()=>/录音处理中/.test(await notice.text()),'visible original U01 processing text');
        await takeRoute('speech-processing',index===0?chat:site);
      } finally { await ctx.removeProcessingProbe(probe.id); await mp.evaluate(()=>getCurrentPages().at(-1).speechController.refresh()); }
      return {id:probe.id,runId:probe.runId,executed:false,cancelled:true};
    });
    const input=fixtures[index];let asset,messageId;
    await step('real local ASR returns an editable original with no business send',async()=>{
      trial.phase='speech-transcription';save();
      if(!ctx.resume){
        await record(ctx.audio(index),index===0);
        if(index===0){await check(async()=>!!(await voiceState())?.pending,'lost upload preserves original operation');await action('核对同一次录音上传');await page.callMethod('voiceInput');}
      }
      asset=await waitAsset('succeeded');await ctx.idle();if(ctx.resume)assert.equal(asset.runId,ctx.resumeRunId,'Reuse the exact persisted ASR run');assert.ok(asset.transcript.trim());assert.match(asset.transcript,/书房|書房/);
      assert.equal((await ctx.readAsset(asset.id)).message_id,null);trial.speechTranscription=asset;save();
      assert.equal((await page.data()).draft,asset.transcript);await takeRoute('speech-editable',index===0?chat:site);
      const original=await ctx.readOriginal(asset.id,index);assert.equal(original.hash,input.sha256);return {id:asset.id,raw:asset.transcript,durationMs:asset.durationMs,sourceHash:original.hash};
    });
    if(index===0){
      await step('customer corrects a word and explicitly sends into the original configured Agent consultation',async()=>{
        await (await page.$('.composer-input')).input(input.correction);await (await page.$('.send-button')).tap();
        const row=await check(async()=>{const a=await ctx.readAsset(asset.id);return a.message_id?a:false;},'atomic original/correction/message link');messageId=String(row.message_id);
        assert.equal(row.transcript,asset.transcript);assert.equal(row.corrected_text,input.correction);
        await check(async()=>{const d=await page.data();return !d.generating&&!d.busy&&d.messages.some(m=>m.authorKind==='assistant'&&BigInt(m.id)>BigInt(messageId)&&m.available!==false);},'configured Agent continuation');
        await ctx.idle();await takeRoute('speech-customer-answer',chat);return {messageId,correctedText:row.corrected_text};
      });
      await step('customer reentry replays the authenticated original; deleting it invalidates the original and derived answer',async()=>{
        page=await customerOpen();trial.audioPlayback=await playback(messageId);save();
        await action('删除录音及转写');await (await page.$('.bubble[data-message="'+messageId+'"]')).trigger('longpress');
        await check(async()=>{const d=await page.data();return d.messages.some(m=>m.id===messageId&&m.available===false)&&d.messages.some(m=>m.authorKind==='assistant'&&BigInt(m.id)>BigInt(messageId)&&m.available===false);},'original and downstream prose revoked');
        const row=await ctx.readAsset(asset.id);assert.equal(row.data,null);assert.equal(row.transcript,'');assert.equal(row.corrected_text,'');await ctx.denyOriginal(asset.id,index);
        page=await customerOpen();await takeRoute('speech-customer-deleted',chat);return {originalAndDerivedUnavailable:true};
      });
    }else{
      await step('staff reviews the transcript, adds one owned photo and sends the original site draft chain',async()=>{
        await (await page.$('.composer-input')).input(input.text);const image=await ctx.picture();
        await mp.evaluate(value=>{const s=getApp().__qaShared;s.photoPath=wx.env.USER_DATA_PATH+'/d6-site-photo.png';wx.getFileSystemManager().writeFileSync(s.photoPath,value,'base64');s.photoSize=Math.floor(value.replace(/=+$/,'').length*3/4);},image);
        await (await page.$('.add-photo')).tap();await check(async()=>{const d=await page.data();return d.attachments.length===1&&!d.busy;},'owned site photo upload');
        await (await page.$('.send')).tap();const row=await check(async()=>{const a=await ctx.readAsset(asset.id);return a.message_id?a:false;},'staff audio source linked');messageId=String(row.message_id);
        const record=await check(async()=>{const d=await page.data();return d.items.find(i=>i.message.id===messageId&&i.record?.status==='draft');},'real configured record extraction');
        assert.equal(record.record.room_id,ctx.roomId);assert.match(record.record.data.pending,/底盒|固定|位置/);assert.equal(record.record.media.length,1);
        trial.recordId=record.record.id;save();await takeRoute('speech-site-draft',site);return {messageId,recordId:trial.recordId};
      });
      await step('original site review publishes internally, persists reentry and retains protected replay',async()=>{
        await (await page.$('.record-actions .primary[data-id="'+trial.recordId+'"]')).tap();await check(async()=>(await page.data()).sheet==='publish','original publication sheet');
        await (await page.$('.sheet .primary')).tap();await check(async()=>{const d=await page.data();return !d.sheet&&d.items.some(i=>i.record?.id===trial.recordId&&i.record.status==='published');},'actual publication');
        await ctx.open();page=await current();trial.audioPlayback=await playback(messageId);save();await takeRoute('speech-site-published',site);return {published:true};
      });
      await step('actual staff removal clears site history/audio actions and denies the unchanged original',async()=>{
        await ctx.removeWorker();await ctx.open();page=await current();await check(async()=>{const d=await page.data();return d.fatal&&!d.items.length&&!d.write;},'revoked staff clearance');
        await ctx.denyOriginal(asset.id,index);await takeRoute('speech-member-revoked',site);return {cleared:true};
      });
    }
  } finally {
    await mp.evaluate(()=>{const app=getApp(),s=app.__qaSpeech;if(!s)return;try{getCurrentPages().at(-1)?.speechController?.hide();}catch{}for(const p of s.players){try{p.stop();p.destroy();}catch{}}
      for(const [key,value]of Object.entries(s.originals))wx[key]=value;for(const file of s.paths){try{wx.getFileSystemManager().unlinkSync(file);}catch{}}delete app.__qaSpeech;});
  }
}
