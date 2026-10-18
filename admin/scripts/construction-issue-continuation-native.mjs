import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run as runSharedChat } from './construction-chat-native.mjs';

/** Actual approved S04/C01 controls; only the marked fixture can use this temporary transport. */
export async function run(ctx) {
  return runSharedChat({ ...ctx, skipCancel: true, afterReply: async tools => {
    const { mp, step, send, identity, current, waitFor, issueId, capture } = tools;
    const route = 'packages/assistant/chat/chat', cid = ctx.customer.conversationId, outputs = [];
    async function customer() {
      await mp.evaluate(s => {
        const app = getApp(); app.globalData.token = s.token;
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: s.enterpriseId } } };
        app.__qaShared.memory.set('token', s.token);
      }, ctx.customer);
      await mp.redirectTo('/' + route + '?conversationId=' + cid);
      return waitFor(async () => { const p = await mp.currentPage(); assert.equal(p.path, route); const d = await p.data();
        return !d.loading && !d.fatal && d.canSend && d.conversation?.id === cid ? p : null; }, 'original customer consultation');
    }
    async function customerCapture(name) {
      const p = await mp.currentPage(), stack = await mp.evaluate(() => getCurrentPages().map(p => p.route));
      assert.equal(p.path, route); assert.equal(stack.at(-1), route);
      await (await p.$('.conversation-scroll')).scrollTo(0, 100000); await new Promise(r => setTimeout(r, 400));
      const geometry = {};
      for (const selector of ['.brand-home','.composer-input','.send-button']) {
        const element = await p.$(selector); assert.ok(element);
        const offset = await element.offset(), size = await element.size();
        geometry[selector] = { ...offset, ...size, fontSize: await element.style('font-size') };
        assert.ok(size.width > 0 && size.height > 0); assert.ok(offset.left >= 0 && offset.left + size.width <= 391);
      }
      assert.ok(Math.abs(geometry['.send-button'].width - 84*390/750) < 1.5, 'retain approved 84rpx action diameter');
      assert.ok(Math.abs(parseFloat(geometry['.composer-input'].fontSize) - 30*390/750) < 1, 'retain approved 30rpx composer text');
      const capsule = await mp.evaluate(() => wx.getMenuButtonBoundingClientRect());
      assert.ok(geometry['.brand-home'].left + geometry['.brand-home'].width < capsule.left, 'brand remains left of native capsule');
      const target = path.join(ctx.output, name + '.png'); await mp.screenshot({ path: target }); const bytes = fs.readFileSync(target);
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      return { route, stack, logical: [390,844], encoded: [bytes.readUInt32BE(16),bytes.readUInt32BE(20)], target, geometry, capsule };
    }
    async function ask(state) {
      ctx.setIssue(issueId, state); const p = await customer(), before = (await p.data('run'))?.id, start = Date.now();
      await (await p.$('.composer-input')).input(ctx.question); await waitFor(async () => await p.data('draft') === ctx.question, 'real customer input');
      await (await p.$('.send-button')).tap(); const feedbackMs = Date.now()-start;
      const run = await waitFor(async () => { const d = await p.data(); if (d.error && !d.busy && !d.pendingSend) throw Error(d.error);
        return d.run?.id && d.run.id !== before ? d.run : null; }, 'actual customer Agent run');
      const result = await ctx.audit(run.id, state, start); outputs.push(result.outputMessageId);
      await waitFor(async () => { const d = await p.data(); return !d.generating && !d.busy && !d.pendingSend && d.messages.some(m => m.id === result.outputMessageId && m.available); }, 'current sourced reply');
      await mp.callWxMethod('hideKeyboard');
      const reopened = await customer(); assert.ok((await reopened.data('messages')).some(m => m.id === result.outputMessageId && m.available));
      return { runId: run.id, issueId, expectedState: state, feedbackMs, outputMessageId: result.outputMessageId, capture: await customerCapture('native-customer-' + state) };
    }
    await step('S04 explicit cancellation survives a lost receipt and returns the truthful cancelled state to the original C01', async () => {
      await identity(0); const cancelled = await send('取消事项' + issueId + '：暂缓本次核对，当前未安排施工。', true);
      assert.equal(cancelled.response.issue.status, 'cancelled');
      await send('回传事项' + issueId + '：已取消本次底盒核对跟进，当前没有待执行安排；如需继续由有权人员沿原事项恢复。');
      await ctx.deliver(); return { issueId, revision: cancelled.response.issue.revision, capture: await capture('native-site-cancelled') };
    });
    await step('C01 asks the real configured model to combine the cancelled issue with effective enterprise knowledge and persists reentry', () => ask('cancelled'));
    await step('S04 explicit same-id restore reconciles a lost receipt, clears old processing and explicitly returns the current waiting party', async () => {
      await identity(0); const before = await ctx.verify(), revision = before.issues.find(i => i.issueId === issueId).revision;
      const row = await send('恢复事项' + issueId + '：继续按当前资料重新核对，旧结论不自动恢复。', true);
      assert.equal(row.response.issue.issueId, issueId); assert.equal(row.response.issue.revision, revision+1);
      assert.equal(row.response.issue.status, 'awaiting_owner'); assert.equal(row.response.issue.progressMessageId, null); assert.equal(row.response.issue.drawingGrantId, null);
      await send('回传事项' + issueId + '：已沿原事项恢复，当前由合成设计师重新核对，尚无正式点位批准。');
      await identity(0); const p = await current(), data = await p.data(); assert.ok(data.items.some(i => i.record?.id && i.issue?.issueId === issueId && i.issue.status === 'awaiting_owner'));
      await ctx.deliver(); return { issueId, revision: row.response.issue.revision, capture: await capture('native-site-restored') };
    });
    await step('C01 repeats the same question with the restored state, actual assignee and current knowledge', () => ask('awaiting_owner'));
    await step('knowledge withdrawal invalidates both generated explanations on exact native C01 reentry', async () => {
      await ctx.retire(); const p = await customer();
      await waitFor(async () => { const messages = await p.data('messages'); return outputs.every(id => messages.some(m => m.id === id && m.available === false)); }, 'both derived replies unavailable');
      return { outputMessageIds: outputs, capture: await customerCapture('native-withdrawn') };
    });
  } });
}
