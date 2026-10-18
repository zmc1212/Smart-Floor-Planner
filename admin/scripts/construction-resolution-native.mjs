import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { run as runSharedChat } from './construction-chat-native.mjs';

/** Uses the same verified project/window, real HTTP, Worker and approved S04/C01 components. */
export async function run(ctx) {
  return runSharedChat({ ...ctx, skipCancel: true, afterReply: async tools => {
    const { mp, step, send, identity, current, open, waitFor, issueId } = tools;
    const route='packages/assistant/chat/chat',cid=ctx.customer.conversationId,modelIds=[];
    let imagePath='',proofId='',planId='';
    async function customer() {
      await mp.evaluate(s=>{const app=getApp();app.globalData.token=s.token;app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{enterpriseId:s.enterpriseId}}};app.__qaShared.memory.set('token',s.token);},ctx.customer);
      await mp.redirectTo('/'+route+'?conversationId='+cid);
      return waitFor(async()=>{const p=await mp.currentPage();assert.equal(p.path,route);const d=await p.data();return !d.loading&&!d.fatal&&d.conversation?.id===cid&&d.canSend?p:null;},'original customer consultation');
    }
    async function say(text) {
      const p=await mp.currentPage();assert.equal(p.path,route);await(await p.$('.composer-input')).input(text);await waitFor(async()=>await p.data('draft')===text,'customer input');
      await(await p.$('.send-button')).tap();await waitFor(async()=>{const d=await p.data();return !d.busy&&!d.pendingSend&&d.draft===''&&!d.error;},'customer persisted text');await mp.callWxMethod('hideKeyboard');
    }
    async function button(text, selector='button') { const p=await mp.currentPage();for(const b of await p.$$(selector))if((await b.text()).trim()===text)return b;throw Error('Missing native button '+text); }
    async function photo() { const p=await current();await(await p.$$('.composer-icon'))[1].tap();await waitFor(async()=>{const d=await p.data();return d.attachments.length===1&&!d.busy&&!d.pending;},'real original upload'); }
    async function capture(name) {
      const p=await mp.currentPage(),stack=await mp.evaluate(()=>getCurrentPages().map(p=>p.route));assert.equal(stack.at(-1),p.path);assert.ok([route,'packages/construction/chat/chat'].includes(p.path));
      const scroll=await p.$(p.path===route?'.conversation-scroll':'.chat-scroll');await scroll.scrollTo(0,100000);await new Promise(r=>setTimeout(r,400));const target=path.join(ctx.output,name+'.png');await mp.screenshot({path:target});const b=fs.readFileSync(target);
      return {route:p.path,stack,logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)],target};
    }
    const finish = close => `${close?'关闭':'解决'}事项${issueId}\n结论：合成现场原件及尺寸已复核\n回传：书房右侧插座已按本次图纸落实，项目团队已核对。\n回传原件：是`;
    const implement = () => `落实事项${issueId}方案${planId}记录${proofId}：右侧插座已按获同意图纸落实，现场尺寸已复核。`;
    try {
      await step('original customer grants room needs; staff refreshes the same issue without creating a new one',async()=>{
        await customer();await say('共享书房需求：靠窗双人办公，需要电脑和台灯插座。');
        await mp.mockWxMethod('showModal',{confirm:true,cancel:false});try{await(await button('结束接续，回到小K')).tap();await waitFor(async()=>(await(await mp.currentPage()).data('conversation')).mode==='ai','end existing reception');}finally{await mp.restoreWxMethod('showModal');}
        await identity(1);await send('重新核对事项'+issueId+'：已收到本次明确共享需求');await send('回复事项'+issueId+'：核对本次版本后发布，客户同意仍需现场落实。');
        imagePath=await mp.evaluate(base64=>{const s=getApp().__qaShared,target=wx.env.USER_DATA_PATH+'/synthetic-p5-resolution-original.png';wx.getFileSystemManager().writeFileSync(target,base64,'base64');s.photoPath=target;s.photoSize=wx.getFileSystemManager().statSync(target).size;return target;},ctx.diagramBase64);
        await send('关闭事项'+issueId+'？');await send('解决事项'+issueId+'了吗？');assert.equal(await ctx.resolutionState(issueId),null);
        return {issueId,ordinaryQuestionsDoNotCreateFormalState:true};
      });
      await step('explicit formal version with real original receives customer preview and exact approval',async()=>{
        await photo();const row=await send(`发布方案事项${issueId}\n标题：书房右侧插座落实\n差异：新增右侧桌面插座，现场按图纸尺寸复核\n费用变化：+500.00元\n工期变化：+2天`);planId=/方案([1-9]\d*) · V1/.exec(row.response.text)[1];
        await ctx.deliverPlans();await customer();await waitFor(async()=>(await(await mp.currentPage()).data('planCards'))[planId],'exact plan card');
        await(await button('查看完整图纸与差异')).tap();await waitFor(async()=>{const d=await(await mp.currentPage()).data(),p=d.planCards[planId];return p?.full&&d.planPaths[p.key]&&!d.planBusy;},'exact original loaded');
        await(await button('同意这一版方案')).tap();await waitFor(async()=>(await(await mp.currentPage()).data('planCards'))[planId]?.status==='approved','exact customer approval');
        assert.equal(await ctx.resolutionState(issueId),null);return {planId,customerStatus:(await ctx.planState(planId)).status};
      });
      await step('worker uploads a distinct synthetic site original, reviews actual model draft and publishes internally through native controls',async()=>{
        await identity(2);await mp.evaluate(base64=>{const s=getApp().__qaShared;wx.getFileSystemManager().writeFileSync(s.photoPath,base64,'base64');s.photoSize=wx.getFileSystemManager().statSync(s.photoPath).size;},ctx.diagramV2Base64);
        await photo();const row=await send('书房右侧插座今天已经按本次图纸装好，尺寸已经复核，没有剩余待处理和待沟通事项。');proofId=row.record.id;
        const p=await current();await(await p.$(`.secondary[data-id="${proofId}"]`)).tap();await waitFor(async()=>await p.data('sheet')==='edit','review draft');
        for(const [field,value] of Object.entries({completed:'右侧插座已按本次图纸安装并复核尺寸',pending:'',coordination:'',note:'合成测试现场原件，不是实际客户施工照片'}))await(await p.$(`textarea[data-field="${field}"]`)).input(value);
        await(await button('保存核对内容','.sheet button')).tap();await waitFor(async()=>!(await p.data('sheet'))&&!await p.data('busy'),'review persisted');
        await(await p.$(`.primary[data-id="${proofId}"]`)).tap();await waitFor(async()=>await p.data('sheet')==='publish','exact record scope');
        await(await button('核对并发布','.sheet button')).tap();await waitFor(async()=>{const d=await p.data();return !d.sheet&&d.items.find(i=>i.record.id===proofId)?.record.status==='published';},'internal reviewed publication');
        const proof=await ctx.proofHash(proofId);assert.notEqual(proof.hash,await ctx.planOriginalHash(planId));return {recordId:proofId,...proof,capture:await capture('native-execution-record')};
      });
      await step('assigned reviewer records evidence; manager separately resolves and closes with lost response and persisted reentry',async()=>{
        await identity(1);await send(implement());assert.equal((await ctx.resolutionState(issueId)).state,'implemented');
        await ctx.setMode('human');await identity(0);await send(finish(false));assert.equal((await ctx.resolutionState(issueId)).state,'resolved');await ctx.deliver();
        await send(finish(true),true);await open();const current=await ctx.resolutionState(issueId);assert.equal(current.state,'closed');assert.equal(current.revision,3);assert.equal((await ctx.planState(planId)).status,'approved');
        return {issueId,planId,evidenceId:current.evidenceId,lifecycleId:current.id,capture:await capture('native-formally-closed')};
      });
      await step('human mode defers result; resumed Worker delivers one current close and exact JWT-protected evidence to original consultation',async()=>{
        assert.equal(Number((await ctx.resultState()).delivered),0);await ctx.setMode('ai');await Promise.all([ctx.deliver(),ctx.deliver()]);await customer();
        const d=await(await mp.currentPage()).data(),returned=d.messages.filter(m=>m.available&&m.siteRecordList?.some(r=>r.id===proofId));assert.equal(returned.length,1);
        await waitFor(async()=>Object.keys((await(await mp.currentPage()).data('siteRecordPaths'))||{}).length>0,'returned original download');
        const p=await mp.currentPage();await(await p.$('.conversation-scroll')).scrollTo(0,100000);
        const photo=await waitFor(()=>p.$('.site-record-photos image'),'rendered returned original');await photo.tap();
        const downloaded=await waitFor(()=>mp.evaluate(()=>getApp().__qaShared.previewed?.[0]),'authorized original preview');const bytes=await mp.evaluate(p=>wx.getFileSystemManager().readFileSync(p,'base64'),downloaded);
        assert.equal(createHash('sha256').update(Buffer.from(bytes,'base64')).digest('hex'),(await ctx.proofHash(proofId)).hash);
        return {messageId:returned[0].id,recordId:proofId,capture:await capture('native-customer-closed-proof')};
      });
      await step('two actual configured-model questions report exact formal closure and evidence without implying acceptance or payment',async()=>{
        const results=[];for(const text of ['书房这件事现在是否已经落实并关闭了？','这次关闭依据哪份方案和现场记录，是否代表已经验收付款？']){
          const p=await mp.currentPage(),prior=await p.data('run');await(await p.$('.composer-input')).input(text);await(await p.$('.send-button')).tap();
          const run=await waitFor(async()=>{const d=await p.data();return d.run?.id&&d.run.id!==prior?.id?d.run:null;},'configured model run');const saved=await ctx.waitRun(run.id);assert.match(saved.text,/已正式关闭/);assert.match(saved.text,/不代表工程验收通过、付款或结算/);assert.match(saved.text,new RegExp('记录'+proofId));modelIds.push(saved.outputMessageId);results.push(saved);
          await waitFor(async()=>{const d=await p.data();return !d.generating&&!d.busy&&d.messages.some(m=>m.id===saved.outputMessageId);},'source-backed closed result');await mp.callWxMethod('hideKeyboard');
        }return {runs:results,capture:await capture('native-closed-agent-followup')};
      });
      await step('reopen requires fresh formal processing; old customer originals and both derived answers stop on reentry',async()=>{
        await identity(0);await send('重新处理事项'+issueId+'：补充现场复核，旧结论停止沿用');await customer();
        const d=await(await mp.currentPage()).data();assert.deepEqual(d.siteRecordPaths,{});assert.ok(modelIds.every(id=>d.messages.some(m=>m.id===id&&m.available===false)));
        await identity(1);await send(implement());await identity(0);await send(finish(false));await send(finish(true));await ctx.deliver();await customer();
        assert.equal((await ctx.resolutionState(issueId)).state,'closed');return {issueId,revision:(await ctx.resolutionState(issueId)).revision,capture:await capture('native-reclosed')};
      });
      await step('withdrawn exact evidence revokes the current closed result and its original-photo cache',async()=>{
        await identity(2);const p=await current();await(await button('撤回发布',`.record-links button[data-id="${proofId}"]`)).tap();await waitFor(async()=>await p.data('sheet')==='withdraw','withdraw selected evidence');
        await(await p.$('.sheet textarea')).input('合成证据需重新复核');await(await button('确认撤回','.sheet button')).tap();await waitFor(async()=>!(await p.data('sheet'))&&!await p.data('busy'),'evidence withdrawal');
        assert.equal((await ctx.resolutionState(issueId)).available,false);await customer();const d=await(await mp.currentPage()).data();assert.deepEqual(d.siteRecordPaths,{});assert.ok(!d.messages.some(m=>m.available&&m.siteRecordList?.some(r=>r.id===proofId)));
        return {issueId,recordId:proofId,capture:await capture('native-evidence-withdrawn')};
      });
    } finally { if(imagePath)await mp.evaluate(p=>{try{wx.getFileSystemManager().unlinkSync(p);}catch{}},imagePath); }
    await identity(1);
  } });
}
