import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run as runSharedChat } from './construction-chat-native.mjs';

/** Reuse the verified Stable window, native compilation and synthetic-only transport. */
export async function run(ctx) {
  return runSharedChat({ ...ctx, skipCancel: true, afterReply: async tools => {
    const { mp, step, waitFor } = tools, route = 'packages/assistant/chat/chat', outputs = [];
    let diagramPath = '';
    // The shared S04 harness intentionally denies generic citation URLs. Admit
    // only IDs returned by this synthetic customer's real answer, retaining the
    // server's participant/tenant/source checks and the original restoration.
    await mp.evaluate(() => {
      const s=getApp().__qaShared,prior=wx.request;s.projectionCitationIds=new Set();
      wx.request=function(o){const raw=String(o.url),i=raw.indexOf('/api/'),p=i<0?'':raw.slice(i),match=/^\/api\/miniprogram\/assistant\/citations\/([1-9]\d*)$/.exec(p);
        if(!match||!s.projectionCitationIds.has(match[1]))return prior.call(wx,o);
        const row={path:p,verb:o.method||'GET',status:null};s.requests.push(row);const success=o.success;
        return s.request.call(wx,{...o,url:'http://localhost:3006'+p,success(r){row.status=r.statusCode;success?.(r);}});
      };
    });
    async function customer() {
      await mp.evaluate(s => { const app = getApp(); app.globalData.token=s.token;
        app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{enterpriseId:s.enterpriseId}}};app.__qaShared.memory.set('token',s.token);
      },ctx.customer);
      await mp.redirectTo('/'+route+'?conversationId='+ctx.customer.conversationId);
      return waitFor(async()=>{const p=await mp.currentPage();assert.equal(p.path,route);const d=await p.data();return !d.loading&&!d.fatal&&d.canSend?p:null;},'original C01 with live data');
    }
    async function say(text) {
      const p=await mp.currentPage();assert.equal(p.path,route);
      await(await p.$('.composer-input')).input(text);await waitFor(async()=>await p.data('draft')===text,'real composer input');
      await(await p.$('.send-button')).tap();
      await waitFor(async()=>{const d=await p.data();if(d.error&&!d.busy&&!d.pendingSend)throw Error(d.error);return !d.busy&&!d.pendingSend&&!d.draft;},'real persisted command');
      await mp.callWxMethod('hideKeyboard');
    }
    async function capture(name) {
      const p=await mp.currentPage(),stack=await mp.evaluate(()=>getCurrentPages().map(p=>p.route));assert.equal(p.path,route);assert.equal(stack.at(-1),route);
      await(await p.$('.conversation-scroll')).scrollTo(0,100000);await new Promise(r=>setTimeout(r,400));
      const geometry={};for(const selector of ['.brand-home','.composer-input','.send-button']){const element=await p.$(selector);assert.ok(element);const offset=await element.offset(),size=await element.size();geometry[selector]={...offset,...size,fontSize:await element.style('font-size')};assert.ok(size.width>0&&size.height>0&&offset.left>=0&&offset.left+size.width<=391);}
      const capsule=await mp.evaluate(()=>wx.getMenuButtonBoundingClientRect());assert.ok(geometry['.brand-home'].left+geometry['.brand-home'].width<capsule.left);
      assert.ok(Math.abs(geometry['.send-button'].width-84*390/750)<1.5);assert.ok(Math.abs(parseFloat(geometry['.composer-input'].fontSize)-30*390/750)<1);
      const target=path.join(ctx.output,name+'.png');await mp.screenshot({path:target});const bytes=fs.readFileSync(target);assert.equal(bytes.subarray(1,4).toString(),'PNG');
      return {route,stack,target,logical:[390,844],encoded:[bytes.readUInt32BE(16),bytes.readUInt32BE(20)],geometry,capsule};
    }
    try {
      const initial='靠窗双人办公，电脑和台灯，底盒位置待现场核对。';
      await step('C01 real composer explicitly shares the one room need without sharing the private conversation',async()=>{
        await customer();await say('共享书房需求：'+initial);const snapshot=await ctx.materials();assert.equal(snapshot.data.sources.find(s=>s.ref.type==='shared_need').text,initial);return {source:snapshot.data.sources.find(s=>s.ref.type==='shared_need')};
      });
      const drawing=await step('native photo control uploads the original and explicit opt-in binds its exact grant and media hashes',async()=>{
        diagramPath=await mp.evaluate(base64=>{const s=getApp().__qaShared,target=wx.env.USER_DATA_PATH+'/synthetic-original-projection.png';wx.getFileSystemManager().writeFileSync(target,base64,'base64');s.photoPath=target;s.photoSize=wx.getFileSystemManager().statSync(target).size;return target;},ctx.diagramBase64);
        const p=await mp.currentPage(),buttons=await p.$$('.media-button');assert.equal(buttons.length,2);await buttons[1].tap();
        await waitFor(async()=>{const d=await p.data();return !d.mediaBusy&&d.messages.some(m=>m.mediaId);},'real uploaded original');
        await say('共享书房点位图：书桌插座参考图，须结合现场尺寸核对。');const s=(await ctx.materials()).data.sources.find(s=>s.ref.type==='shared_drawing');assert.ok(s?.mediaIds.length);await ctx.verifyOriginal(s.ref.id,s.mediaIds[0]);
        ctx.setExpected(initial,true);return {grantId:s.ref.id,mediaId:s.mediaIds[0],mediaHash:s.original.mediaHash,capture:await capture('native-shared-original')};
      });
      async function ask(label) {
        const p=await customer(),previous=(await p.data('run'))?.id,start=Date.now();await say(ctx.question);
        const run=await waitFor(async()=>{const d=await p.data();return d.run?.id&&d.run.id!==previous?d.run:null;},'real configured-model run');
        const result=await ctx.audit(run.id,label,start);outputs.push(result.outputMessageId);
        await mp.evaluate(ids=>{for(const id of ids)getApp().__qaShared.projectionCitationIds.add(String(id));},result.citations.map(c=>c.id));
        await waitFor(async()=>{const d=await p.data();return !d.busy&&!d.pendingSend&&!d.generating&&d.messages.some(m=>m.id===result.outputMessageId&&m.available);},'sourced original explanation');
        const reopened=await customer();assert.ok((await reopened.data('messages')).some(m=>m.id===result.outputMessageId&&m.available));
        // The existing source sheet still opens the real published knowledge original.
        const citations=await reopened.$$('.citation-chip');assert.ok(citations.length);await citations.at(-1).tap();
        await waitFor(async()=>{const d=await reopened.data();return d.sheet==='citation'&&d.citation&&!d.citationLoading;},'real citation original');
        const sourceCapture=await capture('native-source-'+label);await(await reopened.$('.sheet-head .icon-button')).tap();
        return {runId:run.id,outputMessageId:result.outputMessageId,sourceCapture,capture:await capture('native-answer-'+label)};
      }
      for(let n=1;n<=2;n++)await step('PPT23/38 current shared originals plus knowledge and stage explanation '+n,()=>ask('original-'+n));
      await step('native replacement has a new grant and immediately invalidates old explanations',async()=>{
        await customer();await say('共享书房需求：改为独立办公桌，仅供本人办公，保留电脑和台灯。');ctx.setExpected('改为独立办公桌，仅供本人办公，保留电脑和台灯。',true);
        const p=await customer();assert.ok((await p.data('messages')).filter(m=>outputs.includes(m.id)).every(m=>m.available===false));return {invalidated:[...outputs],snapshot:await ctx.materials()};
      });
      for(let n=1;n<=2;n++)await step('PPT23/38 changed need uses its new original and keeps drawing authority separate '+n,()=>ask('replacement-'+n));
      await step('withdrawing drawing clears dependent native history and protected project media on persisted reentry',async()=>{
        await customer();await say('撤回共享资料'+drawing.grantId);await ctx.verifyOriginal(drawing.grantId,drawing.mediaId,404);
        const p=await customer();await waitFor(async()=>{const messages=await p.data('messages');return outputs.every(id=>messages.some(m=>m.id===id&&m.available===false));},'all derived replies invalidated');
        assert.equal((await ctx.materials()).data.sources.some(s=>s.ref.type==='shared_drawing'),false);return {invalidated:outputs,capture:await capture('native-drawing-withdrawn')};
      });
    } finally {
      if(diagramPath)await mp.evaluate(file=>{try{wx.getFileSystemManager().unlinkSync(file);}catch{}},diagramPath);
    }
  } });
}
