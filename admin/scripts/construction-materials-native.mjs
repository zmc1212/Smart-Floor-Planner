import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run as runSharedChat } from './construction-chat-native.mjs';

/** Adds the real C01 opt-in/original and original-consultation return to the maintained Stable S04 workflow. */
export async function run(ctx) {
  return runSharedChat({ ...ctx, afterReply: async tools => {
    const { mp, step, send, identity, open, capture, current, waitFor, issueId } = tools;
    const customerRoute = 'packages/assistant/chat/chat', cid = ctx.customer.conversationId;
    let diagramPath = '';
    const modelMessageIds = [];
    async function customer() {
      await mp.evaluate(s => {
        const app = getApp(); app.globalData.token = s.token;
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: s.enterpriseId } } };
        app.__qaShared.memory.set('token', s.token);
      }, ctx.customer);
      await mp.redirectTo('/' + customerRoute + '?conversationId=' + cid);
      return waitFor(async () => { const p = await mp.currentPage(); assert.equal(p.path, customerRoute);
        const d = await p.data(); return !d.loading && !d.fatal && d.conversation?.id === cid && d.canSend ? p : null; }, 'original customer consultation');
    }
    async function say(text) {
      const p = await mp.currentPage(); assert.equal(p.path, customerRoute);
      await (await p.$('.composer-input')).input(text);
      await waitFor(async () => await p.data('draft') === text, 'customer composer input');
      await (await p.$('.send-button')).tap();
      await waitFor(async () => { const d = await p.data(); return !d.busy && !d.pendingSend && d.draft === '' && !d.error; }, 'persisted explicit customer material command');
      await mp.callWxMethod('hideKeyboard');
    }
    async function customerCapture(name) {
      const p = await mp.currentPage(), stack = await mp.evaluate(() => getCurrentPages().map(p => p.route));
      assert.equal(p.path, customerRoute); assert.equal(stack.at(-1), customerRoute);
      const scroll = await p.$('.conversation-scroll'); assert.ok(scroll); await scroll.scrollTo(0, 100000);
      await new Promise(resolve => setTimeout(resolve, 400));
      const target = path.join(ctx.output, name + '.png'); await mp.screenshot({ path: target });
      const b = fs.readFileSync(target); return { route: p.path, stack, logical: [390,844], encoded: [b.readUInt32BE(16),b.readUInt32BE(20)], target };
    }
    try {
      await step('C01 customer explicitly shares one room need through the existing composer', async () => {
        await customer(); await say('共享书房需求：靠窗书桌，偶尔双人办公；电脑、显示器、台灯和手机充电。');
        const sources = await ctx.materials(); assert.equal(sources.sources.length, 1); assert.equal(sources.sources[0].kind, 'need');
        return { grantId: sources.sources[0].id, sourceMessageId: sources.sources[0].sourceMessageId };
      });
      const drawing = await step('C01 real photo button uploads an original and explicit sharing binds the immediately preceding image', async () => {
        diagramPath = await mp.evaluate(base64 => {
          const s = getApp().__qaShared, target = wx.env.USER_DATA_PATH + '/synthetic-ppt23-point-v2.png';
          wx.getFileSystemManager().writeFileSync(target, base64, 'base64'); s.photoPath = target; s.photoSize = wx.getFileSystemManager().statSync(target).size;
          return target;
        }, ctx.diagramBase64);
        const p = await mp.currentPage(); const buttons = await p.$$('.media-button'); assert.equal(buttons.length, 2); await buttons[1].tap();
        await waitFor(async () => { const d = await p.data(); return !d.mediaBusy && d.messages.some(m => m.mediaId); }, 'actual multipart upload and visible own original');
        await say('共享书房点位图：V2书桌点位图，须结合现场尺寸核对。');
        const sources = await ctx.materials(), source = sources.sources.find(s => s.kind === 'drawing'); assert.ok(source?.mediaId);
        return { grantId: source.id, mediaId: source.mediaId, sourceHash: source.sourceHash };
      });
      await step('PPT23 designer query renders granted needs and downloads the exact drawing through the project grant gate', async () => {
        await identity(1); const row = await send('书房底盒待核对，帮我找对应图纸和需求');
        assert.match(row.response.text, /靠窗书桌.*双人办公/); assert.match(row.response.text, /V2书桌点位图/);
        const p = await current(); await waitFor(async () => Object.keys(await p.data('mediaPaths')).some(k => k.startsWith('shared-')), 'protected shared drawing thumbnail');
        const slots = await p.$$('.photo-slot'); assert.ok(slots.length); await slots.at(-1).tap();
        await waitFor(async () => await mp.evaluate(() => !!getApp().__qaShared.previewed?.length), 'real original preview download');
        await ctx.verifyOriginal(drawing.grantId, drawing.mediaId);
        return { ...drawing, capture: await capture('native-granted-materials') };
      });
      await step('designer rechecks the same issue, binds the current drawing and replies using the approved source version', async () => {
        await send('重新核对事项' + issueId + '：接入业主本次明确共享资料');
        await send('核对事项' + issueId + '图纸' + drawing.grantId);
        const row = await send('回复事项' + issueId + '：已结合V2与靠窗双人办公需求核对关联，底盒先不固定，具体尺寸仍待现场复核。');
        assert.equal(row.response.issue.status, 'awaiting_review'); assert.equal(row.response.issue.drawingGrantId, drawing.grantId);
        return { issueId, revision: row.response.issue.revision, capture: await capture('native-sourced-reply') };
      });
      await step('manager explicitly returns one excerpt while human reception prevents interjection', async () => {
        await identity(0); const row = await send('回传事项' + issueId + '：设计师已按V2与双人办公需求回复，底盒位置仍待现场复核。', true);
        assert.match(row.response.text, /授权回传原咨询/);
        const state = await ctx.resultState(); assert.equal(state.delivered, 0); assert.equal(state.mode, 'human');
        return { issueId, revision: row.response.issue.revision, deliveredInHumanMode: state.delivered };
      });
      await step('ending reception through the real C01 action delivers once to the original consultation and persists on reentry', async () => {
        const p = await customer(); const buttons = await p.$$('.text-action'); let end;
        for (const button of buttons) if ((await button.text()).includes('结束接续')) end = button;
        assert.ok(end);
        // The real button opens a native confirmation outside the WXML tree.
        // Resolve this synthetic-only confirmation with the official SDK, then restore it.
        await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
        try { await end.tap();
        await waitFor(async () => { const d = await p.data(); return d.conversation?.mode === 'ai' && !d.busy; }, 'human mode ends via customer action');
        } finally { await mp.restoreWxMethod('showModal'); }
        await ctx.deliver(); await customer();
        const data = await (await mp.currentPage()).data(); assert.match(JSON.stringify(data.messages), /项目团队回传/);
        await ctx.deliver(); const state = await ctx.resultState(); assert.equal(state.delivered, 1);
        return { issueId, delivered: state.delivered, capture: await customerCapture('native-customer-result') };
      });
      await step('two configured-model follow-ups use the returned issue evidence without approving construction', async () => {
        const results = [];
        for (const text of ['刚才团队回传的底盒处理结论是什么？现在能固定了吗？', '所以这件事已经正式批准了吗，还是仍需现场复核？']) {
          const p = await mp.currentPage(), prior = await p.data('run');
          await (await p.$('.composer-input')).input(text);
          await waitFor(async () => await p.data('draft') === text, 'actual follow-up input');
          await (await p.$('.send-button')).tap();
          const run = await waitFor(async () => { const d = await p.data(); return d.run?.id && d.run.id !== prior?.id ? d.run : null; }, 'new actual model run');
          const persisted = await ctx.waitRun(run.id);
          await waitFor(async () => { const d = await p.data(); return !d.busy && !d.generating && d.messages.some(m => m.id === persisted.outputMessageId); }, 'sourced model reply visible');
          assert.match(persisted.text, /核对|复核|确认/); assert.match(persisted.text, /不|未|待|还|需/);
          modelMessageIds.push(persisted.outputMessageId); results.push(persisted);
          await mp.callWxMethod('hideKeyboard');
        }
        return { runs: results, capture: await customerCapture('native-customer-followup') };
      });
      await step('customer withdrawal invalidates the result and clears protected drawing bytes on native project reentry', async () => {
        await say('撤回共享资料' + drawing.grantId); await customer();
        const d = await (await mp.currentPage()).data(); assert.ok(d.messages.some(m => m.available === false));
        assert.equal(modelMessageIds.length, 2);
        assert.ok(modelMessageIds.every(id => d.messages.some(m => m.id === id && m.available === false)), 'source withdrawal invalidates both inherited Agent replies');
        await identity(1); const data = await (await current()).data();
        assert.ok(data.items.some(i => i.issue?.issueId === issueId && i.issue.status === 'invalidated'));
        assert.equal(Object.keys(data.mediaPaths).filter(k => k.startsWith('shared-')).length, 0);
        await ctx.assertOriginalRevoked(drawing.grantId, drawing.mediaId);
        return { issueId, invalidated: true, capture: await capture('native-material-revoked') };
      });
    } finally {
      if (diagramPath) await mp.evaluate(target => { try { wx.getFileSystemManager().unlinkSync(target); } catch {} }, diagramPath);
    }
    await identity(1); await open();
  } });
}
