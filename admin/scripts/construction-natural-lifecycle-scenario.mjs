import assert from 'node:assert/strict';
export const lifecycleCases = [
  { transfer: '请把书房底盒的位置核对转交给测试师傅继续处理。', reply: '书房底盒这件事我已核对，请记下我的回复：已对照图纸，按桌子右侧位置处理。',
    completed: '书房底盒今天已经按同意的V2固定在桌子右侧，桌子摆位也已复核，这项现场工作已完成。',
    implement: '书房底盒已按同意的V2完成，请把今天这条已完成记录作为本次现场落实依据。', originals: false },
  { transfer: '书房底盒还需现场处理，麻烦转交测试师傅继续跟进。', reply: '请把我对书房底盒的处理说明记下来：图纸和桌子位置已核对，接下来按右侧位置落实。',
    completed: '书房桌子右侧底盒已经按业主同意的V2位置固定，现场摆位复核完成。',
    implement: '请记录书房底盒这次现场落实：按业主同意的V2固定完了，依据今天核对发布的完成记录。', originals: true },
];
export async function runNaturalLifecycleScenario(ctx) {
  const { mp, step, identity, open, send, current, check, latest, take, takeRoute, customerOpen, customerSay, trial, save, input } = ctx;
  const chatRoute = 'packages/assistant/chat/chat', briefRoute = 'packages/construction/brief/brief';
  const row = async () => (await (await current()).data()).items.find(i => i.record?.id === trial.completionRecordId);
  async function action(text, confirm, name, drop = false) {
    trial.phase = name; save(); const sent = await send(text), id = String(sent.message.id);
    await check(async () => (await latest(id))?.response?.text?.includes(confirm), 'natural ' + name + ' preview');
    await send('收到'); await open(); assert.ok((await latest(id)).response.text.includes(confirm));
    await take(name + '-preview'); return send(confirm, drop);
  }
  async function brief(name, first = false) {
    await identity(0); await mp.redirectTo('/' + briefRoute);
    const page = await check(async () => { const p = await mp.currentPage(); if (p.path !== briefRoute) return false; const d = await p.data();
      if (d.error) throw Error(d.error); return !d.loading && d.items.length === 2 ? p : false; }, 'two real scoped project facts');
    const d = await page.data(), a = d.items.find(p => p.projectId === ctx.projectId), b = d.items.find(p => p.projectId === ctx.otherProjectId);
    assert.ok(a && b); assert.notEqual(a.summary, b.summary); assert.ok(b.latestRecord); assert.match(b.summary, /待分配|门框/); assert.doesNotMatch(JSON.stringify(d.items), /逾期[：:]|PRIVATE_INTERNAL/);
    if (!first) assert.ok(a.issues.some(i => i.status === 'closed'));
    await takeRoute(name, briefRoute);
    const projects = await page.$$('.brief-project'); let target; for (const p of projects) if ((await p.text()).includes('测试工地甲')) target = p;
    assert.ok(target); await target.tap();
    await check(async () => { const p = await mp.currentPage(); return p.path === 'packages/construction/chat/chat' && !(await p.data()).loading; }, 'exact issue from brief');
    return d.items;
  }
  if (!ctx.answerOnly) {
  await step('manager sees two distinct service-written sites and enters the original study issue from the real brief', async () => {
    trial.beforeBrief = await brief('lifecycle-two-sites-before', true); const p = await current(), draft = (await p.data()).draft;
    assert.ok(draft.includes(trial.issueId)); await send(draft); return { projectId: ctx.projectId, issueId: trial.issueId };
  });
  await step('natural coordination transfers only after the original manager confirms and survives a lost receipt', async () => {
    await action(input.transfer, '确认转交', 'lifecycle-transfer', true); const issue = await ctx.readIssue();
    assert.equal(issue.ownerId, ctx.workerId); assert.equal(issue.status, 'awaiting_owner'); return { ownerId: issue.ownerId, revision: issue.revision };
  });
  await step('the new assignee supplies and independently confirms their own reply before new formal versions exist', async () => {
    await identity(2); await action(input.reply, '确认回复', 'lifecycle-assignee-reply');
    assert.equal((await ctx.readIssue()).status, 'awaiting_review');
    const prepared = await ctx.preparePlans(); trial.savedPlans = prepared.plans; trial.engineeringPlanPreparation = prepared; save();
    assert.equal(prepared.providerCalls, 0); assert.equal(prepared.plans[1].number, 2); assert.equal(prepared.plans[1].status, 'approved');
    return { exactCurrentPlan: prepared.plans[1].id, staffPublicationEvidenceReused: true };
  });
  await step('actual natural completed record and new original are reviewed and internally published through the existing sheet', async () => {
    await identity(2); const picture = await ctx.picture(); await mp.evaluate(base64 => { const s = getApp().__qaShared; s.photoPath = wx.env.USER_DATA_PATH + '/synthetic-d5-implementation.png';
      wx.getFileSystemManager().writeFileSync(s.photoPath, base64, 'base64'); s.photoSize = wx.getFileSystemManager().statSync(s.photoPath).size; }, picture);
    const p = await current(), controls = await p.$$('.composer-icon'); await controls[1].tap();
    await check(async () => (await p.data()).attachments.length === 1 && !(await p.data()).busy, 'owned completion original upload');
    trial.phase = 'lifecycle-completion-record'; save(); const sent = await send(input.completed); trial.completionRecordId = sent.record.id; save();
    const draft = (await row()).record; assert.ok(draft.data.completed); assert.equal(draft.data.pending, ''); assert.equal(draft.data.coordination, '');
    await identity(0); const boss = await current(); await (await boss.$(`.record-actions .primary[data-id="${trial.completionRecordId}"]`)).tap();
    await check(async () => (await boss.data()).sheet === 'publish', 'original review sheet'); await (await boss.$('.sheet .primary')).tap();
    await check(async () => { const d = await boss.data(); return !d.sheet && !d.busy && d.items.some(i => i.record?.id === trial.completionRecordId && i.record.status === 'published' && i.record.audience === 'internal'); }, 'reviewed internal original');
    await open(); await take('lifecycle-completion-published'); return { recordId: trial.completionRecordId };
  });
  await step('assignee confirms the exact approved V2 and reviewed completed record as implementation without closing', async () => {
    await identity(2); await action(input.implement, '确认落实', 'lifecycle-implement'); const r = await ctx.readResolution();
    assert.equal(r.state, 'implemented'); assert.equal(r.planId, trial.savedPlans[1].id); assert.equal(r.evidence.recordId, trial.completionRecordId); return { state: r.state, id: r.id };
  });
  for (const close of [false, true]) await step('manager separately confirms formal ' + (close ? 'closure' : 'resolution') + ' with an explicit literal customer excerpt and original policy', async () => {
    await identity(0); const excerpt = `书房底盒已按同意的V2落实，${close ? '事项已正式关闭' : '事项已正式解决，尚未关闭'}。`;
    const text = `请正式${close ? '关闭' : '解决'}书房底盒这件事。本次内部核对记录：原固定方式纳入项目复盘。给业主说：“${excerpt}”${input.originals ? '把本次落实照片原件也回传给业主' : '只回传文字'}。`;
    await action(text, close ? '确认正式关闭' : '确认正式解决', close ? 'lifecycle-close' : 'lifecycle-resolve', close);
    const r = await ctx.readResolution(); assert.equal(r.state, close ? 'closed' : 'resolved'); await ctx.deliver(); return { state: r.state, id: r.id, excerpt, originals: input.originals };
  });
  await step('brief reentry keeps the closed study issue separate from the other site waiting for assignment', async () => {
    trial.afterBrief = await brief('lifecycle-two-sites-after'); return { closed: true, otherSiteStillWaiting: true };
  });
  }
  await step('original customer sees only the actual formal return and explicitly shared originals, then asks a normal status question', async () => {
    trial.phase = 'lifecycle-customer-state'; save(); const page = await customerOpen();
    const data = await page.data(), body = m => JSON.stringify(m.content || m);
    assert.ok(data.messages.some(m => m.available !== false && body(m).includes('事项已正式关闭')));
    assert.doesNotMatch(JSON.stringify(data.messages), /PRIVATE_INTERNAL|原固定方式纳入项目复盘/);
    const keys = Object.keys(data.siteRecordPaths || {}).filter(k => k.startsWith(trial.completionRecordId + '_'));
    if (input.originals) assert.ok(keys.length); else assert.equal(keys.length, 0);
    const answer = await customerSay('书房底盒现在处理到哪一步了？同意的是哪一版，这就算验收和付款完成了吗？');
    assert.match(answer.text, /V2|第2|第二/); assert.match(answer.text, /关闭/); assert.match(answer.text, /验收|付款/); assert.doesNotMatch(answer.text, /PRIVATE_INTERNAL|原固定方式纳入项目复盘|已经验收|已经付款/);
    trial.lifecycleCustomerAnswer = answer; save(); await customerOpen(); await (await (await mp.currentPage()).$('.conversation-scroll')).scrollTo(0, 100000);
    await takeRoute('lifecycle-customer-answer', chatRoute); return answer;
  });
  await step('actual source withdrawal invalidates formal state, original photos and derived customer answer on reentry', async () => {
    await ctx.withdrawSource(); await customerOpen(); await check(async () => { const d = await (await mp.currentPage()).data();
      return !Object.keys(d.planCards || {}).length && !Object.keys(d.siteRecordPaths || {}).some(k => k.startsWith(trial.completionRecordId + '_')) && d.messages.some(m => m.id === trial.lifecycleCustomerAnswer.id && m.available === false); }, 'formal return/source/media revoked');
    await (await (await mp.currentPage()).$('.conversation-scroll')).scrollTo(0, 100000); await takeRoute('lifecycle-source-revoked', chatRoute); return { cleared: true };
  });
  await step('removed assignee loses S04 originals and every natural/formal action on native reentry', async () => {
    await identity(2); await ctx.removeWorker(); await mp.redirectTo('/packages/construction/chat/chat?projectId=' + ctx.projectId);
    await check(async () => { const d = await (await current()).data(); return d.fatal && !d.items.length && !Object.keys(d.mediaPaths).length && !d.write; }, 'assignee revoked');
    await take('lifecycle-member-revoked'); return { cleared: true };
  });
}
