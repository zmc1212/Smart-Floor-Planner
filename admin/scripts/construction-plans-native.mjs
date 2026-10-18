import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run as runSharedChat } from './construction-chat-native.mjs';

/** Reuses the single verified Stable project, actual controls and synthetic-only transport. */
export async function run(ctx) {
  return runSharedChat({ ...ctx, afterReply: async tools => {
    const { mp, step, send, identity, current, waitFor, issueId } = tools;
    const route='packages/assistant/chat/chat',cid=ctx.customer.conversationId,modelIds=[];
    let imagePath='';
    async function customer() {
      await mp.evaluate(s=>{const app=getApp();app.globalData.token=s.token;app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{enterpriseId:s.enterpriseId}}};app.__qaShared.memory.set('token',s.token);},ctx.customer);
      await mp.redirectTo('/'+route+'?conversationId='+cid);
      return waitFor(async()=>{const p=await mp.currentPage();assert.equal(p.path,route);const d=await p.data();return !d.loading&&!d.fatal&&d.conversation?.id===cid&&d.canSend?p:null;},'original customer consultation');
    }
    async function say(text) {
      const p=await mp.currentPage();assert.equal(p.path,route);await(await p.$('.composer-input')).input(text);await waitFor(async()=>await p.data('draft')===text,'customer input');
      await(await p.$('.send-button')).tap();await waitFor(async()=>{const d=await p.data();return !d.busy&&!d.pendingSend&&d.draft===''&&!d.error;},'customer persisted text');await mp.callWxMethod('hideKeyboard');
    }
    async function button(text) {
      const p=await mp.currentPage();for(const b of await p.$$('button'))if((await b.text()).trim()===text)return b;
      throw Error('Missing native button '+text);
    }
    async function capture(name) {
      const p=await mp.currentPage(),stack=await mp.evaluate(()=>getCurrentPages().map(p=>p.route));assert.equal(p.path,route);assert.equal(stack.at(-1),route);
      const scroll=await p.$('.conversation-scroll');await scroll.scrollTo(0,100000);await new Promise(r=>setTimeout(r,400));const target=path.join(ctx.output,name+'.png');await mp.screenshot({path:target});
      const b=fs.readFileSync(target);return {route,stack,logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)],target};
    }
    async function card(id,status) {
      return waitFor(async()=>{const d=await(await mp.currentPage()).data();return d.planCards?.[id]?.status===status&&!d.planBusy?d.planCards[id]:null;},'persisted version card '+status);
    }
    async function publish(number=1) {
      await identity(1);const p=await current();
      if(number===2)await mp.evaluate(base64=>{const s=getApp().__qaShared;wx.getFileSystemManager().writeFileSync(s.photoPath,base64,'base64');s.photoSize=wx.getFileSystemManager().statSync(s.photoPath).size;},ctx.diagramV2Base64);
      const controls=await p.$$('.composer-icon');assert.equal(controls.length,2);await controls[1].tap();
      await waitFor(async()=>{const d=await p.data();return d.attachments.length===1&&!d.busy&&!d.pending;},'real staff drawing upload');
      const difference=number===2?'相对V1，将新增插座从桌面左侧移到右侧，详见本版图纸；本次调整仍须现场落实。':'由单人桌改为双人桌，新增一组插座；先复核图纸标注位置。';
      const result=await send(`发布方案事项${issueId}\n标题：书房插座调整\n差异：${difference}\n费用变化：+500.00元\n工期变化：+2天`);
      const match=/方案([1-9]\d*) · V(\d+)/.exec(result.response.text);assert.ok(match);return {id:match[1],number:Number(match[2]),messageId:result.message.id};
    }
    try {
      await step('PPT23 customer explicitly shares room needs and staff rechecks the same existing issue',async()=>{
        await customer();await say('共享书房需求：靠窗双人办公，需要电脑和台灯插座。');
        await identity(1);await send('重新核对事项'+issueId+'：已收到业主明确共享的需求');await send('回复事项'+issueId+'：准备明确版本图纸，客户决定后仍需现场落实。');
        imagePath=await mp.evaluate(base64=>{const s=getApp().__qaShared,target=wx.env.USER_DATA_PATH+'/synthetic-p5-formal-drawing.png';wx.getFileSystemManager().writeFileSync(target,base64,'base64');s.photoPath=target;s.photoSize=wx.getFileSystemManager().statSync(target).size;return target;},ctx.diagramBase64);
        return {issueId,needSources:(await ctx.materials()).sources.length};
      });
      const first=await step('S04 issuer uploads original and explicitly publishes immutable V1 with stated differences and impacts',async()=>{const p=await publish();assert.equal(p.number,1);const saved=await ctx.planState(p.id);assert.equal(saved.costDeltaCents,50000);assert.equal(saved.scheduleDeltaDays,2);return {...p,originalHash:await ctx.planOriginalHash(p.id)};});
      await step('publication waits through human reception then is delivered once to the original C01',async()=>{
        await ctx.deliverPlans();await customer();assert.deepEqual((await(await mp.currentPage()).data('planCards')),{});
        await mp.mockWxMethod('showModal',{confirm:true,cancel:false});try{await(await button('结束接续，回到小K')).tap();await waitFor(async()=>(await(await mp.currentPage()).data('conversation')).mode==='ai','native end reception');}finally{await mp.restoreWxMethod('showModal');}
        await ctx.deliverPlans();await customer();const p=await card(first.id,'pending_customer');assert.equal(p.number,1);return {planId:first.id,capture:await capture('native-plan-pending')};
      });
      await step('C05 later decision persists and requested changes return to the same shared project',async()=>{
        await(await button('稍后决定')).tap();await card(first.id,'deferred');await customer();await card(first.id,'deferred');
        await mp.mockWxMethod('showModal',{confirm:true,cancel:false,content:'请把新增插座移到桌面右侧'});try{await(await button('希望调整一下')).tap();await card(first.id,'changes_requested');}finally{await mp.restoreWxMethod('showModal');}
        assert.equal((await ctx.planState(first.id)).status,'changes_requested');return {planId:first.id,capture:await capture('native-plan-changes')};
      });
      const second=await step('V2 supersedes V1 without inheriting preview or decision; old direct original is rejected',async()=>{
        const p=await publish(2);assert.equal(p.number,2);const originalHash=await ctx.planOriginalHash(p.id);assert.notEqual(originalHash,first.originalHash);await ctx.deliverPlans();await customer();const c=await card(p.id,'pending_customer');assert.equal(c.previewed,false);assert.match(c.difference,/右侧/);assert.ok(!(await(await mp.currentPage()).data('planCards'))[first.id]);await assert.rejects(ctx.planState(first.id));return {...p,originalHash};
      });
      await step('C05 expands exact drawing and impacts before approval; lost response is reconciled with original key',async()=>{
        await(await button('查看完整图纸与差异')).tap();await waitFor(async()=>{const d=await(await mp.currentPage()).data(),p=d.planCards?.[second.id];return p?.full&&d.planExpanded===second.id&&d.planPaths[p.key]&&!d.planBusy;},'matching full preview with actual downloaded original');
        await mp.evaluate(id=>{const s=getApp().__qaShared;s.planRequest=wx.request;s.dropPlan=true;wx.request=function(o){const success=o.success;return s.planRequest.call(wx,{...o,success(r){if(s.dropPlan&&String(o.url).includes('/plans/'+id+'/approve')&&r.statusCode===200){s.dropPlan=false;o.fail?.({errMsg:'synthetic plan response loss'});return;}success?.(r);}});};},second.id);
        try{await(await button('同意这一版方案')).tap();await waitFor(async()=>{const d=await(await mp.currentPage()).data();return d.planPending&&!d.planBusy;},'original plan action retained');await(await button('核对同次决定')).tap();await card(second.id,'approved');}finally{await mp.evaluate(()=>{const s=getApp().__qaShared;if(s.planRequest){wx.request=s.planRequest;delete s.planRequest;}});}
        await customer();assert.equal((await ctx.planState(second.id)).status,'approved');await card(second.id,'approved');return {planId:second.id,capture:await capture('native-plan-approved')};
      });
      await step('two real configured-model follow-ups read formal version and distinguish approval from execution',async()=>{
        const results=[];for(const text of ['刚才发给我的书房方案具体改了什么？费用和工期各变化多少？','我同意的是哪一版方案？这件现场事项是不是已经落实并关闭了？']){
          const p=await mp.currentPage(),prior=await p.data('run');await(await p.$('.composer-input')).input(text);await waitFor(async()=>await p.data('draft')===text,'model follow-up input');await(await p.$('.send-button')).tap();
          const run=await waitFor(async()=>{const d=await p.data();return d.run?.id&&d.run.id!==prior?.id?d.run:null;},'actual configured model run');const saved=await ctx.waitRun(run.id);assert.match(saved.text,/500|2天/);assert.match(saved.text,/尚未关闭|分别记录|落实/);modelIds.push(saved.outputMessageId);results.push(saved);
          await waitFor(async()=>{const d=await p.data();return !d.generating&&!d.busy&&d.messages.some(m=>m.id===saved.outputMessageId);},'actual sourced response');await mp.callWxMethod('hideKeyboard');
        }return {runs:results,capture:await capture('native-plan-followup')};
      });
      await step('formal withdrawal stops current version, protected media and both derived replies on native reentry',async()=>{
        await identity(0);await send('撤回方案'+second.id+'：现场尺寸需要重新核对');await customer();
        const d=await(await mp.currentPage()).data();assert.deepEqual(d.planCards,{});assert.deepEqual(d.planPaths,{});assert.equal(modelIds.length,2);assert.ok(modelIds.every(id=>d.messages.some(m=>m.id===id&&m.available===false)));await assert.rejects(ctx.planState(second.id));return {planId:second.id,capture:await capture('native-plan-withdrawn')};
      });
    } finally {
      if(imagePath)await mp.evaluate(p=>{try{wx.getFileSystemManager().unlinkSync(p);}catch{}},imagePath);
    }
    await identity(1);
  } });
}
