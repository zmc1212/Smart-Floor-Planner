const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../packages/construction/projects/projects.js');
const model = require('../packages/construction/projects/projects-model');

function detail(issues = [], plans = []) {
  return model.decorateDetail({
    project: { id: '1', name: '合成工地', status: 'active', current_stage_key: 'utilities', version: 3 },
    stages: [{ key: 'utilities', name: '水电' }], issues, plans,
    assignments: [], members: [], rooms: [{ id: '2', name: '书房' }], myRole: 'designer', manage: false,
  });
}
function page() {
  let def;
  const app = { globalData: { token: 'a', bootstrap: { current: { role: 'designer', capabilities: ['construction.projects'], context: { enterpriseId: '1', staffId: '2' } } } } };
  const calls = [], wx = { navigateTo: o => calls.push(o.url), getStorageSync: () => '', getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, left: 296, height: 32 }) };
  const local = createRequire(file);
  new Function('require', 'Page', 'getApp', 'wx', fs.readFileSync(file, 'utf8'))(name => {
    if (name.includes('utils/api')) return { request: async () => ({ data: { items: [] } }) };
    if (name.includes('identity-navigation')) return { canAccessRoute: () => true };
    if (name === './projects-model.js') return model;
    if (name.includes('chat/site-client')) return { decorate: value => value };
    if (name.includes('lib/site-font')) return { loadSiteFont() {} };
    return local(name);
  }, value => { def = value; }, () => app, wx);
  const p = { ...def, data: structuredClone(def.data), setData(value) { Object.assign(this.data, value); }, current: () => true };
  return { p, calls };
}

test('a shared need and a formal plan are shown as separate project facts', () => {
  const d = detail([
    { issueId: '12', sourceKind: 'need', roomId: '2', roomName: '书房', status: 'awaiting_owner', ownerName: '合成设计师', text: '业主需求' },
    { issueId: '13', sourceKind: 'record', roomName: '主卧', status: 'awaiting_review', ownerName: '', text: '现场记录' },
    { issueId: '14', sourceKind: 'record', roomName: '客厅', status: 'closed', ownerName: '', text: '已关闭' },
  ], [
    { id: '21', available: true, status: 'approved', issueId: '12', roomName: '书房', number: 2, title: '书桌插座', difference: '靠窗', costDeltaCents: 0, scheduleDeltaDays: 0 },
    { id: '22', available: true, status: 'pending_customer', issueId: '12', roomName: '书房', number: 3, title: '待确认版', difference: '', costDeltaCents: 10000, scheduleDeltaDays: 1 },
  ]);
  assert.equal(d.issueCount, 2);
  assert.deepEqual(d.pendingIssues.map(i => i.issueId), ['12', '13']);
  const need = d.pendingIssues[0];
  assert.equal(need.sourceLabel, '业主需求');
  assert.equal(need.statusLabel, '待处理');
  assert.match(need.waitingText, /等待合成设计师处理/);
  assert.deepEqual(d.approvedPlans.map(p => p.id), ['21']);
  assert.equal(d.approvedPlans[0].statusLabel, '已确认');
  assert.equal(d.approvedPlans[0].costText, '+0.00元');
});

test('designer and worker entries open the same project chat with an issue or room scope', () => {
  const f = page();
  f.p.data.detail = { project: { id: '1', status: 'active' } };
  f.p.data.busy = false; f.p.data.pending = null;
  f.p.openIssue({ currentTarget: { dataset: { id: '12' } } });
  f.p.openPlan({ currentTarget: { dataset: { room: '书房' } } });
  assert.match(f.calls[0], /projectId=1&issueId=12&mode=review/);
  assert.match(f.calls[1], /projectId=1&mode=plan&room=/);
  f.p.openIssue({ currentTarget: { dataset: { id: '' } } });
  assert.equal(f.calls.length, 2, 'an empty issue id never opens chat');
});
