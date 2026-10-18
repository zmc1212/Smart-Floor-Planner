import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run as runSharedChat } from './construction-chat-native.mjs';

/** Existing Stable S04/C01 components and synthetic-only real HTTP transport. */
export async function run(ctx) {
  return runSharedChat({ ...ctx, skipCancel: true, afterReply: async tools => {
    const { mp, step, waitFor, identity, send, issueId } = tools, route = 'packages/assistant/chat/chat', outputs = [];
    ctx.setIssue(issueId); let imagePath = '';
    await mp.evaluate(() => {
      const s = getApp().__qaShared, prior = wx.request; s.teamCitationIds = new Set();
      wx.request = function(o) {
        const raw = String(o.url), i = raw.indexOf('/api/'), p = i < 0 ? '' : raw.slice(i), m = /^\/api\/miniprogram\/assistant\/citations\/([1-9]\d*)$/.exec(p);
        if (!m || !s.teamCitationIds.has(m[1])) return prior.call(wx, o);
        const row = { path: p, verb: o.method || 'GET', status: null }; s.requests.push(row); const success = o.success;
        return s.request.call(wx, { ...o, url: 'http://localhost:3006' + p, success(r) { row.status = r.statusCode; success?.(r); } });
      };
    });
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
    async function ask(label) {
      const p = await customer(), prior = (await p.data('run'))?.id, started = Date.now(); await say(ctx.question);
      const run = await waitFor(async () => { const d = await p.data(); return d.run?.id && d.run.id !== prior ? d.run : null; }, 'real configured run');
      const result = await ctx.audit(run.id, label, started); outputs.push(result.outputMessageId);
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
      await step('native C01 customer shares exact need and original photo without opening private chat to the team', async () => {
        await customer(); await say('共享书房需求：靠窗双人办公，电脑和台灯，具体尺寸待核对。');
        imagePath = await mp.evaluate(base64 => { const s = getApp().__qaShared, file = wx.env.USER_DATA_PATH + '/synthetic-team-original.png';
          wx.getFileSystemManager().writeFileSync(file, base64, 'base64'); s.photoPath = file; s.photoSize = wx.getFileSystemManager().statSync(file).size; return file; }, ctx.diagramBase64);
        const p = await mp.currentPage(), buttons = await p.$$('.media-button'); await buttons[1].tap();
        await waitFor(async () => { const d = await p.data(); return !d.mediaBusy && d.messages.some(m => m.mediaId); }, 'persisted customer photo');
        await say('共享书房点位图：客户参考图，图内尺寸尚未核实。'); ctx.setExpected({ phase: 'unreviewed', review: false, versionId: null });
        return { snapshot: await ctx.materials(), capture: await capture('native-customer-reference') };
      });
      await step('unreviewed originals change no formal state in a real professional answer', () => ask('unreviewed'));
      const drawing = (await ctx.materials()).data.sources.find(s => s.ref.type === 'shared_drawing'); assert.ok(drawing);
      await step('native S04 exact drawing check and explicit manager return affect original C01 explanation', async () => {
        await identity(1); await send(`重新核对事项${issueId}：按本次有效共享资料重新核对`);
        await send(`回复事项${issueId}：图纸关联与现场尺寸分别核对，安装尺寸仍待复核。`);
        await send(`核对事项${issueId}图纸${drawing.ref.id}`); await identity(0); await send(`回传事项${issueId}：图纸已按本项目书房核对关联，现场尺寸仍待复核。`);
        await waitFor(async () => (await ctx.materials()).data.sources.some(s => s.ref.type === 'team_review'), 'explicit check delivery');
        ctx.setExpected({ phase: 'reviewed', review: true, versionId: null }); return ask('reviewed');
      });
      let first = '', second = '';
      await step('native formal original upload and publication expose pending precise version in C01', async () => {
        first = await publish(false); ctx.setExpected({ phase: 'pending-v1', review: true, versionId: first, number: 1, decision: 'pending_customer' });
        await customer(); const capturePending = await capture('native-formal-pending'); return { capturePending, ...await ask('pending-v1') };
      });
      await step('real C01 full-preview and exact approval buttons persist consent without execution', async () => {
        const p = await customer(); const preview = await p.$('.owner-public-primary'); assert.ok(preview); await preview.tap();
        await waitFor(async () => { const d = await p.data(), c = d.planCards[first]; return !d.planBusy && c?.full && d.planExpanded === first && d.planPaths[c.key]; }, 'full original and precise differences');
        const previewCapture = await capture('native-formal-preview'); await (await p.$('.owner-public-primary')).tap();
        await waitFor(async () => (await ctx.materials()).data.sources.find(s => s.ref.id === first)?.formal?.decision === 'approved', 'persisted exact approval');
        ctx.setExpected({ phase: 'approved-v1', review: true, versionId: first, number: 1, decision: 'approved' });
        return { previewCapture, ...await ask('approved-v1') };
      });
      await step('native new version preserves conflicting intent and requires a fresh decision', async () => {
        second = await publish(true, first); ctx.setExpected({ phase: 'changed-v2', review: true, versionId: second, number: 2, decision: 'pending_customer', conflict: true });
        const p = await customer(); assert.equal((await p.data('planCards'))[second].status, 'pending_customer'); assert.ok(!(await p.data('planCards'))[first]);
        return ask('changed-v2');
      });
      await step('native latest-version withdrawal fences prior answer and never revives old consent', async () => {
        await identity(1); await send(`撤回方案${second}：单人及取消台灯与客户需求不一致，重新核对`);
        ctx.setExpected({ phase: 'withdrawn', review: true, versionId: null }); const p = await customer(); assert.equal(Object.keys(await p.data('planCards')).length, 0);
        return ask('withdrawn');
      });
      await step('native reference withdrawal clears every derived explanation and review on persisted reentry', async () => {
        await customer(); await say('撤回共享资料' + drawing.ref.id); const p = await customer();
        for (let page = 0; page < 10; page++) {
          const data = await p.data(); if (outputs.every(id => data.messages.some(m => m.id === id))) break;
          assert.ok(data.messageCursor, 'older derived answers remain accessible through real pagination');
          const before = data.messageCursor; await (await p.$('.older-action')).tap();
          await waitFor(async () => { const d = await p.data(); return !d.busy && d.messageCursor !== before; }, 'real C01 older-message pagination');
        }
        await waitFor(async () => { const messages = await p.data('messages'); return outputs.every(id => messages.some(m => m.id === id && m.available === false)); }, 'all dependent explanations unavailable');
        const s = await ctx.materials(); assert.ok(!s.data.sources.some(s => ['team_review','formal_plan'].includes(s.ref.type)));
        return { invalidated: outputs, capture: await capture('native-reference-withdrawn') };
      });
    } finally { if (imagePath) await mp.evaluate(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch {} }, imagePath); }
  } });
}
