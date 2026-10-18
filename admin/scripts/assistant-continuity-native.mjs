import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run as runSharedChat } from './construction-chat-native.mjs';

/** Existing Stable S04/C01 components and synthetic-only real HTTP transport. */
export async function run(ctx) {
  return runSharedChat({ ...ctx, skipCancel: true, afterReply: async tools => {
    const { mp, step, waitFor, identity, send, issueId } = tools, route = 'packages/assistant/chat/chat', outputs = [];
    ctx.setIssue(issueId); let imagePath = '';
    await mp.evaluate(backendOrigin => {
      const s = getApp().__qaShared, prior = wx.request; s.teamCitationIds = new Set();
      wx.request = function(o) {
        const raw = String(o.url), i = raw.indexOf('/api/'), p = i < 0 ? '' : raw.slice(i), m = /^\/api\/miniprogram\/assistant\/citations\/([1-9]\d*)$/.exec(p);
        if (!m || !s.teamCitationIds.has(m[1])) return prior.call(wx, o);
        const row = { path: p, verb: o.method || 'GET', status: null }; s.requests.push(row); const success = o.success;
        return s.request.call(wx, { ...o, url: backendOrigin + p, success(r) { row.status = r.statusCode; success?.(r); } });
      };
    }, ctx.origin || 'http://localhost:3006');
    async function customer() {
      await mp.evaluate(s => { const app = getApp(); app.globalData.token = s.token;
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: s.enterpriseId } } }; app.__qaShared.memory.set('token', s.token);
      }, ctx.customer);
      await mp.redirectTo('/' + route + '?conversationId=' + ctx.customer.conversationId);
      return waitFor(async () => { const p = await mp.currentPage(); assert.equal(p.path, route); const d = await p.data(); return !d.loading && !d.fatal && d.canSend ? p : null; }, 'original C01 live reentry');
    }
    async function say(text) {
      const p = await mp.currentPage(); assert.equal(p.path, route); await (await p.$('.composer-input')).input(text);
      await waitFor(async () => await p.data('draft') === text, 'real C01 input'); await (await p.$('.send-button')).tap();
      await waitFor(async () => { const d = await p.data(); if (d.error && !d.busy && !d.pendingSend) throw Error(d.error); return !d.busy && !d.pendingSend && !d.draft; }, 'persisted C01 send');
      await mp.callWxMethod('hideKeyboard');
    }
    async function capture(name) {
      const p = await mp.currentPage(), stack = await mp.evaluate(() => getCurrentPages().map(p => p.route)); assert.equal(p.path, route); assert.equal(stack.at(-1), route);
      await (await p.$('.conversation-scroll')).scrollTo(0, 100000); await new Promise(r => setTimeout(r, 450));
      const geometry = {}; for (const selector of ['.brand-home','.composer-input','.send-button']) {
        const e = await p.$(selector); assert.ok(e); geometry[selector] = { ...await e.offset(), ...await e.size(), fontSize: await e.style('font-size') };
        assert.ok(geometry[selector].width > 0 && geometry[selector].left >= 0 && geometry[selector].left + geometry[selector].width <= 391);
      }
      const capsule = await mp.evaluate(() => wx.getMenuButtonBoundingClientRect()); assert.ok(geometry['.brand-home'].left + geometry['.brand-home'].width < capsule.left);
      assert.ok(Math.abs(geometry['.send-button'].width - 84 * 390 / 750) < 1.5); assert.ok(Math.abs(parseFloat(geometry['.composer-input'].fontSize) - 30 * 390 / 750) < 1);
      const target = path.join(ctx.output, name + '.png'); await mp.screenshot({ path: target }); const b = fs.readFileSync(target); assert.equal(b.subarray(1,4).toString(), 'PNG');
      return { route, stack, target, logical: [390,844], encoded: [b.readUInt32BE(16),b.readUInt32BE(20)], geometry, capsule };
    }
    async function ask(label, text = ctx.question, withdrawn = false) {
      const p = await customer(), prior = (await p.data('run'))?.id, started = Date.now(); await say(text);
      const run = await waitFor(async () => { const d = await p.data(); return d.run?.id && d.run.id !== prior ? d.run : null; }, 'real configured run');
      const result = await ctx.audit(run.id, label, started, withdrawn); outputs.push(result.outputMessageId);
      await mp.evaluate(ids => { for (const id of ids) getApp().__qaShared.teamCitationIds.add(String(id)); }, result.citations.map(c => c.id));
      await waitFor(async () => { const d = await p.data(); return !d.busy && !d.generating && d.messages.some(m => m.id === result.outputMessageId && m.available); }, 'actual explanation');
      const reopened = await customer(); assert.ok((await reopened.data('messages')).some(m => m.id === result.outputMessageId && m.available));
      const citations = await reopened.$$('.citation-chip'); assert.ok(citations.length); await citations.at(-1).tap();
      await waitFor(async () => { const d = await reopened.data(); return d.sheet === 'citation' && d.citation && !d.citationLoading; }, 'actual knowledge original');
      const sourceCapture = await capture('native-source-' + label); await (await reopened.$('.sheet-head .icon-button')).tap();
      return { runId: run.id, outputMessageId: result.outputMessageId, sourceCapture, capture: await capture('native-answer-' + label) };
    }
    async function publish(conflict, previous) {
      const p = await identity(1), buttons = await p.$$('.composer-icon'); assert.equal(buttons.length, 2); await buttons[1].tap();
      await waitFor(async () => { const d = await p.data(); return d.attachments.length === 1 && !d.busy && !d.pending; }, 'real native formal original upload');
      await send(ctx.planText(conflict));
      const source = await waitFor(async () => { const s = (await ctx.materials()).data.sources.find(s => s.ref.type === 'formal_plan'); return s && s.ref.id !== previous ? s : null; }, 'delivered precise formal version');
      return source.ref.id;
    }
    try {
      await step('native explicit multi-field needs are actually saved and reenter the same consultation', async () => {
        const p = await customer(), prior = (await p.data('run'))?.id; await say(ctx.initialNeeds);
        const run = await waitFor(async () => { const d = await p.data(); return d.run?.id && d.run.id !== prior ? d.run : null; }, 'initial record run');
        await ctx.auditPreparation(run.id); await ctx.seedLegacyMemory();
        await waitFor(async () => !await p.data('generating'), 'initial memory feedback');
        return { runId: run.id, capture: await capture('native-initial-needs') };
      });
      await step('native C01 explicit reference sharing and actual photo upload retain exact source authority', async () => {
        await customer(); await say('共享书房需求：靠窗双人办公，电脑和台灯，具体尺寸待核对。');
        imagePath = await mp.evaluate(base64 => { const s = getApp().__qaShared, file = wx.env.USER_DATA_PATH + '/synthetic-continuity-original.png';
          wx.getFileSystemManager().writeFileSync(file, base64, 'base64'); s.photoPath = file; s.photoSize = wx.getFileSystemManager().statSync(file).size; return file; }, ctx.diagramBase64);
        const p = await mp.currentPage(), buttons = await p.$$('.media-button'); await buttons[1].tap();
        await waitFor(async () => { const d = await p.data(); return !d.mediaBusy && d.messages.some(m => m.mediaId); }, 'persisted customer photo');
        await say('共享书房点位图：客户参考图，图内尺寸尚未核实。');
        return { snapshot: await ctx.materials(), capture: await capture('native-customer-reference') };
      });
      const drawing = (await ctx.materials()).data.sources.find(s => s.ref.type === 'shared_drawing'); assert.ok(drawing);
      await step('native S04 exact reference check and explicit return keep the existing site issue', async () => {
        // Sharing new references invalidates the earlier reply's material snapshot.
        // Refresh that same issue through its existing explicit command first.
        await identity(1); await send('重新核对事项' + issueId + '：客户新增共享需求和点位图，按当前材料继续核对。');
        await send('回复事项' + issueId + '：已按新增共享资料重新核对关联，底盒先不固定，现场尺寸仍待复核。');
        await send('核对事项' + issueId + '图纸' + drawing.ref.id);
        await identity(0); await send('回传事项' + issueId + '：图纸已按本项目书房核对关联，现场尺寸仍待复核。');
        await waitFor(async () => (await ctx.materials()).data.sources.some(s => s.ref.type === 'team_review'), 'explicit check delivery');
        return { issueId, drawingId: drawing.ref.id };
      });
      let first = '';
      await step('native precise formal original upload and real full-preview/approval actions persist this version only', async () => {
        first = await publish(false); const p = await customer(); await (await p.$('.owner-public-primary')).tap();
        await waitFor(async () => { const d = await p.data(), card = d.planCards[first];
          return !d.planBusy && card?.full && d.planExpanded === first && d.planPaths[card.key]; }, 'full formal preview');
        const previewCapture = await capture('native-formal-preview'); await (await p.$('.owner-public-primary')).tap();
        await waitFor(async () => (await ctx.materials()).data.sources.find(s => s.ref.id === first)?.formal?.decision === 'approved', 'exact approval');
        return { versionId: first, previewCapture };
      });
      const before = await ctx.disclosure();
      const phases = ctx.focusContinuation ? ['mixed-correction', 'continuation'] : ['baseline', 'mixed-correction', 'continuation'];
      for (const phase of phases) {
        ctx.setExpected({ phase, versionId: first, single: phase !== 'baseline' });
        const text = phase === 'mixed-correction' ? ctx.correction : phase === 'continuation' ? ctx.continuation : ctx.question;
        // Repeated model samples belong to the serial service harness. Native
        // verifies each real input/state/reentry path once at the target viewport.
        await step('PPT15/23/37/38 native actual model ' + phase, () => ask(phase + '-1', text));
      }
      await step('private corrections retain independent memories and do not share or decide formal business on reentry', async () => {
        assert.deepEqual(await ctx.disclosure(), before); await customer();
        const snapshot = await ctx.materials(); assert.equal(snapshot.data.sources.find(s => s.ref.type === 'formal_plan')?.formal?.decision, 'approved');
        assert.match(snapshot.data.sources.find(s => s.ref.type === 'shared_need').text, /双人/);
        return { sourceId: first, followups: await ctx.followups(), capture: await capture('native-correction-reentry') };
      });
      await step('reference withdrawal invalidates current derived answers and the exact plan without old-version fallback', async () => {
        await customer(); await say('撤回共享资料' + drawing.ref.id); const p = await customer();
        await waitFor(async () => { const d = await p.data(); return outputs.every(id => d.messages.some(m => m.id === id && !m.available)); }, 'persisted derived history unavailable');
        assert.equal((await ctx.materials()).data.sources.some(s => ['shared_drawing','team_review','formal_plan'].includes(s.ref.type)), false);
        assert.equal(Object.keys(await p.data('planCards')).length, 0);
        return { invalidated: outputs, capture: await capture('native-reference-withdrawn') };
      });
      await step('native unavailable correction never revives old mixed occupancy',
        () => ask('withdrawn-no-fallback-1', ctx.withdrawnQuestion, true));
    } finally { if (imagePath) await mp.evaluate(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch {} }, imagePath); }
  } });
}
