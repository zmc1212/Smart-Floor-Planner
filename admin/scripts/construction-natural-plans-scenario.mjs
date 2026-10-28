import assert from 'node:assert/strict';

export const naturalPlanCases = [
  { first: '请将书房底盒的正式方案发给业主，名称书房插座调整。依这张原图增加一组插座，仍须现场核对桌子摆位。费用增加500元，工期延长2天。',
    second: '请将书房底盒正式方案换一版发给业主，名称书房插座调整。将插座移到桌子右侧，仍需现场复核。费用不变，工期不变。', cost: 50000, days: 2 },
  { first: '把书房底盒这个正式调整方案交给业主决定，名称书房插座调整。依本次附件减少一组插座，桌子摆位仍需到现场核准。费用减少100元，工期缩短1天。',
    second: '麻烦把书房底盒方案更新后发给业主，名称书房插座调整。插座改到桌子右侧，以这张本次原图核对，现场仍要复测。费用不变，工期不变。', cost: -10000, days: -1 },
];

/** User messages remain natural. Source revocation/member changes are separate
 * engineering injections; SDK controls perform real publication/decisions. */
export async function runNaturalPlanScenario(ctx) {
  const { mp, step, identity, open, send, current, check, latest, customerOpen, customerSay, take, takeRoute, trial, save, input } = ctx;
  const route = 'packages/assistant/chat/chat';
  async function button(label) {
    for (const item of await (await mp.currentPage()).$$('button')) if ((await item.text()).trim() === label) return item;
    throw Error('Missing existing native control: ' + label);
  }
  const card = (id, status) => check(async () => { const d = await (await mp.currentPage()).data(); return d.planCards?.[id]?.status === status && !d.planBusy ? d.planCards[id] : false; }, 'exact persisted version ' + status);
  const customerCapture = async name => { await (await (await mp.currentPage()).$('.conversation-scroll')).scrollTo(0, 100000); await takeRoute(name, route); };
  async function publish(text, number, drop = false) {
    await identity(1); trial.phase = 'natural-plan-v' + number; save();
    const picture = await ctx.picture(number);
    await mp.evaluate(base64 => { const s = getApp().__qaShared; s.photoPath = wx.env.USER_DATA_PATH + '/synthetic-d5-formal-original.png';
      wx.getFileSystemManager().writeFileSync(s.photoPath, base64, 'base64'); s.photoSize = wx.getFileSystemManager().statSync(s.photoPath).size; }, picture);
    const p = await current(), controls = await p.$$('.composer-icon'); assert.equal(controls.length, 2); await controls[1].tap();
    await check(async () => (await p.data()).attachments.length === 1 && !(await p.data()).busy, 'actual owned original upload');
    const requested = await send(text), mid = String(requested.message.id);
    await check(async () => /确认发布方案/.test((await latest(mid))?.response?.text || ''), 'configured natural publication preview');
    const before = await ctx.countPlans(); assert.equal(before, number - 1);
    await send('收到'); assert.equal(await ctx.countPlans(), before);
    await open(); assert.match((await latest(mid)).response.text, /确认发布方案/); await take('plan-v' + number + '-preview');
    const confirmed = await send('确认发布方案', drop), match = /方案([1-9]\d*) · V(\d+)/.exec(confirmed.response.text);
    assert.ok(match); assert.equal(Number(match[2]), number); const value = await ctx.readPlan(match[1]);
    assert.equal(value.number, number); assert.equal(value.title, '书房插座调整'); assert.equal(value.difference, text); assert.equal(value.sourceMessageId, mid);
    assert.equal(value.costDeltaCents, number === 1 ? input.cost : 0); assert.equal(value.scheduleDeltaDays, number === 1 ? input.days : 0);
    assert.equal(await ctx.countPlans(), number); return value;
  }
  async function approve(p, loseResponse) {
    await (await button('查看完整图纸与差异')).tap();
    await check(async () => { const d = await (await mp.currentPage()).data(), c = d.planCards?.[p.id]; return c?.full && d.planExpanded === p.id && d.planPaths[c.key] && !d.planBusy; }, 'actual matching protected original download before approval');
    if (loseResponse) await mp.evaluate(id => { const s = getApp().__qaShared; s.planRequest = wx.request; s.dropPlan = true;
      wx.request = function(o) { const success = o.success; return s.planRequest.call(wx, { ...o, success(r) {
        if (s.dropPlan && String(o.url).includes('/plans/' + id + '/approve') && r.statusCode === 200) { s.dropPlan = false; o.fail?.({ errMsg: 'Synthetic formal-decision response loss' }); return; } success?.(r);
      } }); }; }, p.id);
    try {
      await (await button('同意这一版方案')).tap();
      if (loseResponse) { await check(async () => { const d = await (await mp.currentPage()).data(); return d.planPending && !d.planBusy; }, 'exact decision key retained'); await (await button('核对同次决定')).tap(); }
      await card(p.id, 'approved');
    } finally { if (loseResponse) await mp.evaluate(() => { const s = getApp().__qaShared; if (s.planRequest) { wx.request = s.planRequest; delete s.planRequest; } }); }
    await customerOpen(); await card(p.id, 'approved'); assert.equal((await ctx.readPlan(p.id)).status, 'approved');
  }
  const first = await step('natural formal V1 is only a preview until its author separately confirms the full original and explicit impacts', () => publish(input.first, 1));
  await step('customer uses the exact original C05 card and protected drawing to decide V1, with persisted reentry', async () => {
    await ctx.deliver(); await customerOpen(); await card(first.id, 'pending_customer'); await approve(first, false); await customerCapture('plan-v1-approved'); return { planId: first.id };
  });
  const second = await step('natural V2 and lost publication receipt keep one new version and do not inherit V1 approval', () => publish(input.second, 2, true));
  await step('customer V2 has no inherited preview or approval; the same lost decision is reconciled without a second write', async () => {
    await ctx.deliver(); await customerOpen(); const c = await card(second.id, 'pending_customer'); assert.equal(c.previewed, false);
    assert.ok(!(await (await mp.currentPage()).data()).planCards[first.id]); assert.equal(await ctx.readPlan(first.id), null);
    await approve(second, true); await customerCapture('plan-v2-approved'); return { planId: second.id };
  });
  await step('customer naturally asks about the version they approved and receives its real pending execution state', async () => {
    trial.phase = 'customer-formal-plan'; save();
    const answer = await customerSay('我刚才同意的是哪一版书房方案？现在是不是已经落实并关闭了？');
    assert.match(answer.text, /V2|第2|第二|这一版/); assert.match(answer.text, /同意|决定|确认/); assert.match(answer.text, /落实|关闭/);
    assert.doesNotMatch(answer.text, /PRIVATE_INTERNAL|已正式关闭|已经落实并关闭/);
    trial.customerPlanAnswer = answer; save(); await customerOpen(); await customerCapture('plan-customer-answer'); return answer;
  });
  await step('engineering source withdrawal invalidates both the exact C05 original and its derived answer on actual native reentry', async () => {
    await ctx.withdrawSource(); await customerOpen(); await check(async () => { const d = await (await mp.currentPage()).data();
      return !Object.keys(d.planCards || {}).length && !Object.keys(d.planPaths || {}).length && d.messages.some(m => m.id === trial.customerPlanAnswer.id && m.available === false); }, 'formal version and derived answer revoked');
    await customerCapture('plan-source-withdrawn'); return { cleared: true };
  });
  await step('removed publisher cannot retain project originals or action access on native reentry', async () => {
    await identity(1); await ctx.removeMember(); await mp.redirectTo('/packages/construction/chat/chat?projectId=' + ctx.projectId);
    await check(async () => { const d = await (await current()).data(); return d.fatal && !d.items.length && !Object.keys(d.mediaPaths).length && !d.write; }, 'publisher permission revoked');
    await take('plan-member-revoked'); return { cleared: true };
  });
  trial.publishedPlans = [first.id, second.id]; save();
}

/** Continue only the two saved, already published/approved versions. No staff
 * interpretation or publication is repeated; original failed answers stay failed. */
export async function runNaturalPlanAnswerScenario(ctx) {
  const { mp, step, identity, current, check, customerOpen, customerSay, take, takeRoute, trial, save } = ctx;
  const route = 'packages/assistant/chat/chat', id = ctx.savedPlans[1].id;
  const capture = async name => { await (await (await mp.currentPage()).$('.conversation-scroll')).scrollTo(0, 100000); await takeRoute(name, route); };
  await step('saved V2 approval and its exact protected original reenter without repeating staff interpretation or publication', async () => {
    const plan = await ctx.readPlan(id); assert.equal(plan.number, 2); assert.equal(plan.status, 'approved'); assert.equal(plan.difference, ctx.input.second);
    assert.equal(await ctx.countPlans(), 2); await ctx.deliver(); await customerOpen();
    await check(async () => (await (await mp.currentPage()).data()).planCards?.[id]?.status === 'approved', 'saved exact approved V2');
    let preview; for (const b of await (await mp.currentPage()).$$('button')) if ((await b.text()).trim() === '查看这一版图纸') { preview = b; break; }
    assert.ok(preview); await preview.tap();
    await check(async () => { const d = await (await mp.currentPage()).data(), p = d.planCards?.[id]; return p?.full && d.planPaths[p.key] && !d.planBusy; }, 'saved exact JWT original downloaded');
    await capture('saved-plan-v2-original'); return { planId: id, sourceMessageId: plan.sourceMessageId, repeats: 0 };
  });
  await step('fixed configured formal-version question completes with the original bounded validation recovery', async () => {
    trial.phase = 'customer-formal-plan'; save(); const answer = await customerSay('我刚才同意的是哪一版书房方案？现在是不是已经落实并关闭了？');
    assert.match(answer.text, /V2|第2|第二|这一版/); assert.match(answer.text, /同意|决定|确认/); assert.match(answer.text, /落实|关闭/);
    assert.doesNotMatch(answer.text, /PRIVATE_INTERNAL|已正式关闭|已经落实并关闭/);
    trial.customerPlanAnswer = answer; trial.validationRepairs = await ctx.repairCount(); save();
    await customerOpen(); await capture('formal-plan-answer-reentry'); return { ...answer, validationRepairs: trial.validationRepairs };
  });
  await step('engineering source withdrawal removes the formal version, original and recovered answer on native reentry', async () => {
    await ctx.withdrawSource(); await customerOpen(); await check(async () => { const d = await (await mp.currentPage()).data();
      return !Object.keys(d.planCards || {}).length && !Object.keys(d.planPaths || {}).length && d.messages.some(m => m.id === trial.customerPlanAnswer.id && m.available === false); }, 'version/media/answer source revoked');
    await capture('formal-plan-answer-withdrawn'); return { cleared: true };
  });
  await step('actual publisher removal clears native project originals and all action access', async () => {
    await identity(1); await ctx.removeMember(); await mp.redirectTo('/packages/construction/chat/chat?projectId=' + ctx.projectId);
    await check(async () => { const d = await (await current()).data(); return d.fatal && !d.items.length && !Object.keys(d.mediaPaths).length && !d.write; }, 'publisher removed');
    await take('formal-plan-answer-member-revoked'); return { cleared: true };
  });
}
