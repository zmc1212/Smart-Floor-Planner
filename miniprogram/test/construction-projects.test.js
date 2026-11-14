const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { canAccessRoute, getRoleLanding } = require('../utils/identity-navigation');
const { decorateDetail } = require('../packages/construction/projects/projects-model');
const filename = path.resolve(__dirname, '../packages/construction/projects/projects.js');
const source = fs.readFileSync(filename, 'utf8');

function fixture(role = 'construction_staff', values = new Map()) {
  const app = { globalData: { token: 'session-a', bootstrap: { current: { role, capabilities: ['construction.projects','account'], context: { enterpriseId: '1', staffId: '2', staffRole: role, staffDisplayName: '项目员工' } } } } };
  let handler = async () => ({ success: true, data: { items: [], stages: [] } });
  let definition; const calls = [], messages = [], unlinked = [];
  let download = async () => { throw new Error('Unexpected media download'); };
  const wx = {
    getStorageSync: key => values.get(key), setStorageSync: (k,v) => values.set(k, JSON.parse(JSON.stringify(v))), removeStorageSync: k => values.delete(k),
    showToast: msg => messages.push(msg.title), getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 296, top: 48, height: 32 }),
    switchTab: options => messages.push(options.url), stopPullDownRefresh: () => messages.push('refresh-stopped'),
    navigateTo: options => messages.push(options.url),
    getFileSystemManager: () => ({ unlink: ({ filePath }) => unlinked.push(filePath) }),
  };
  const localRequire = createRequire(filename);
  const api = { request: async (...args) => { calls.push(args); return handler(...args); }, downloadFile: (...args) => download(...args) };
  new Function('require','Page','getApp','wx', source)(name => name.includes('utils/api') ? api : localRequire(name), value => { definition = value; }, () => app, wx);
  function page() { return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } }; }
  return { app, calls, messages, values, page, unlinked, intercept: fn => { handler = fn; }, interceptDownload: fn => { download = fn; } };
}

test('designers, construction staff and enterprise owners share the cloud-site route while measurers remain outside', async () => {
  const route = '/packages/construction/projects/projects';
  for (const role of ['designer','construction_staff','enterprise_admin']) {
    assert.equal(canAccessRoute(route, { mode: 'staff', staffRole: role, enterpriseId: '1' }), true);
    const f = fixture(role), p = f.page(); p.onLoad(); await p.onShow();
    assert.equal(p.data.error, ''); assert.equal(p.data.items.length,0); assert.equal(p.data.name,'项目员工');
    assert.equal(p.data.navRight,104); assert.equal(f.calls[0][0],'/miniprogram/construction/projects');
  }
  assert.equal(canAccessRoute(route,{ mode: 'staff', staffRole: 'measurer', enterpriseId: '1' }),false);
  assert.equal(getRoleLanding({ mode:'staff',staffRole:'construction_staff' }),route);
  const f = fixture(), p = f.page(); await p.onShow(); p.back(); assert.equal(f.messages.at(-1), '/pages/mine/mine');
  await p.onPullDownRefresh(); assert.equal(f.messages.at(-1), 'refresh-stopped');
});

test('the enterprise owner brief entry opens the company project brief instead of a private followup', async () => {
  const owner = fixture('enterprise_admin');
  owner.intercept(async () => ({ data: { owner: true, collaboration: false, stages: [], items: [{ id: '19', status: 'active', name: '项目 A' }] } }));
  const ownerPage = owner.page(); await ownerPage.onShow();
  assert.equal(ownerPage.data.managementBrief, true);
  ownerPage.openBrief();
  assert.equal(owner.messages.at(-1), '/packages/construction/brief/brief');

  const staff = fixture('construction_staff');
  staff.intercept(async () => ({ data: { owner: false, collaboration: false, stages: [], items: [{ id: '19', status: 'active', name: '项目 A', my_role: 'worker' }] } }));
  const staffPage = staff.page(); await staffPage.onShow();
  assert.equal(staffPage.data.managementBrief, false);
  staffPage.openBrief();
  assert.equal(staff.messages.at(-1), '/packages/assistant/chat/chat?followup=1');
});

test('project shortcuts use authorized rows and preserve inactive, pending and session boundaries', async () => {
  const f=fixture(),p=f.page();await p.onShow();
  p.setData({items:[{id:'1',status:'active'},{id:'2',status:'paused'},{id:'3',status:'archived'}]});
  p.chooseStatus({currentTarget:{dataset:{status:'active'}}});assert.deepEqual(p.data.filteredItems.map(x=>x.id),['1']);
  const event=id=>({currentTarget:{dataset:{id}}});
  p.openSiteCamera(event('1'));assert.equal(f.messages.at(-1),'/packages/construction/camera/camera?projectId=1');
  const count=f.messages.length;p.openSiteCamera(event('2'));p.openSiteChat(event('3'));p.openSiteChat(event('foreign'));assert.equal(f.messages.length,count);
  p.setData({pending:{key:'pending'}});p.openSiteCamera(event('1'));assert.equal(f.messages.length,count);
  p.setData({pending:null});p.onHide();p.openSiteChat(event('1'));assert.equal(f.messages.length,count);
});

test('the current construction requirement opens the room by its server ID', async () => {
  const f = fixture(), page = f.page(); await page.onShow();
  page.setData({ detail: { project: { id: '9', status: 'active' }, approvedPlans: [{ id: '27', roomId: '5', roomName: '书房' }] } });
  page.openPlan({ currentTarget: { dataset: { id: '26' } } });
  assert.deepEqual(f.messages, []);
  page.openPlan({ currentTarget: { dataset: { id: '27' } } });
  assert.deepEqual(f.messages, ['/packages/construction/chat/chat?projectId=9&mode=plan&roomId=5']);
});

test('overview never restores a late private record after hide and clears the whole preview on revoked read', async () => {
  const f=fixture(),p=f.page();await p.onShow();p.setData({projectId:'9',detail:{project:{id:'9'}}});
  let finish;f.intercept(()=>new Promise(resolve=>{finish=resolve;}));const reading=p.loadPreview(p._generation);p.onHide();
  finish({data:{items:[{message:{id:'7',created_at:new Date().toISOString(),content:{blocks:[{type:'text',text:'private'}]}},record:{id:'8',data:{},status:'draft',media:[]}}]}});
  await reading;assert.equal(p.data.preview,null);assert.deepEqual(p.data.previewPhotos,[]);
  f.intercept(async()=>({data:{items:[],stages:[]}}));await p.onShow();p.setData({projectId:'9',detail:{project:{id:'9'}},preview:{text:'old private'}});
  f.intercept(async()=>{throw {statusCode:403,error:'construction_forbidden'};});await p.loadPreview(p._generation);
  assert.equal(p.data.preview,null);assert.equal(p.data.detail,null);assert.deepEqual(p.data.items,[]);
});

test('unavailable record media leaves an authorized project usable, while archived projects skip the chat read', async () => {
  const f = fixture(), p = f.page(); await p.onShow();
  const project = { id: '9', status: 'active', name: '可查看的工地' };
  p.setData({ projectId: project.id, detail: { project } });
  f.intercept(async url => ({ data: url.includes('/chat?') ? { items: [{
    message: { id: '7', created_at: '2026-11-07T04:00:00Z', content: { blocks: [{ type: 'text', text: '客厅线管已敷设' }] } },
    record: { id: '8', data: {}, status: 'draft', media: [{ id: '3' }, { id: '4' }] },
  }] } : { project, stages: [] } }));
  f.interceptDownload(async url => {
    if (url.endsWith('/4')) throw { statusCode: 404 };
    return { tempFilePath: 'wxfile://test/private-first-photo' };
  });
  await p.refreshPreview();
  assert.equal(p.data.detail.project.id, project.id);
  assert.equal(p.data.loading, false);
  assert.equal(p.data.preview, null);
  assert.deepEqual(p.data.previewPhotos, []);
  assert.deepEqual(f.unlinked, ['wxfile://test/private-first-photo']);
  assert.ok(p.data.previewError);
  p.openCamera(); assert.match(f.messages.at(-1), /camera\?projectId=9$/);
  p.setData({ detail: { project: { ...project, status: 'archived' } } });
  const requests = f.calls.length, routes = f.messages.length;
  await p.refreshPreview(); p.openChat();
  assert.equal(f.calls.length, requests);
  assert.equal(f.messages.length, routes);
});

test('unknown writes survive reentry and replay the same body/version/key, scoped to enterprise and employee', async () => {
  const f = fixture(), p = f.page(); await p.onShow();
  const pending = { path:'/miniprogram/construction/projects/9/contact',body:{ expectedVersion:4,stageKey:'utilities',staffIds:['2'],primaryStaffId:null },key:'same-operation',identityKey:'1:2' };
  p.setData({ pending }); f.values.set('construction:pending:1:2',pending);
  f.intercept(async () => { throw { statusCode:503 }; }); await p.sendPending();
  assert.equal(p.data.pending.key,'same-operation'); assert.ok(f.values.has('construction:pending:1:2'));
  f.intercept(async (url,method,body,options) => {
    if (method === 'POST') { assert.deepEqual(body,pending.body); assert.equal(options.headers['Idempotency-Key'],'same-operation'); return { data:{ id:'9',version:5 } }; }
    return { data:{ items:[],stages:[] } };
  });
  const reopened = f.page(); await reopened.onShow(); assert.equal(reopened.data.pending.key,'same-operation'); await reopened.sendPending();
  assert.equal(reopened.data.pending,null); assert.equal(f.values.has('construction:pending:1:2'),false);
  f.values.set('construction:pending:1:2',pending); f.app.globalData.token='session-b'; f.app.globalData.bootstrap.current.context.staffId='3';
  await reopened.onShow(); assert.equal(reopened.data.pending,null); assert.ok(f.values.has('construction:pending:1:2'));
});

test('hidden or switched sessions discard late project replies and confirmed failures keep editor input without retaining an unknown write', async () => {
  const f = fixture(), p = f.page(); await p.onShow();
  let finish; f.intercept(() => new Promise(resolve => { finish=resolve; })); const waiting = p.load(); p.onHide();
  finish({ data:{ items:[{ id:'foreign',name:'过时数据' }],stages:[] } }); await waiting; assert.deepEqual(p.data.items,[]);
  f.intercept(async () => ({ data:{ items:[],stages:[] } })); await p.onShow();
  const pending={path:'/miniprogram/construction/projects/9/progress',body:{expectedVersion:4},key:'old-version',identityKey:'1:2'};
  p.setData({pending,projectId:'9',sheet:'progress',note:'保留我的现场补充'}); f.values.set('construction:pending:1:2',pending);
  f.intercept(async (_url, method) => {
    if (method === 'POST') throw { statusCode:409,error:'version_conflict' };
    return { data:{ project:{id:'9',version:5},stages:[] } };
  }); await p.sendPending();
  assert.equal(p.data.pending,null); assert.equal(p.data.sheet,'progress'); assert.equal(p.data.note,'保留我的现场补充');
  assert.equal(p.data.detail.project.version,5);
  f.app.globalData.bootstrap.current.capabilities=[];
  assert.equal(p.current(),false); await p.onShow(); assert.equal(p.data.detail,null); assert.equal(p.data.sheet,'');
});

test('stage sheets preselect assigned employees and never select an arbitrary primary when several staff are assigned', async () => {
  const f=fixture(),p=f.page();await p.onShow();
  p.setData({detail:decorateDetail({manage:true,owner:false,project:{id:'9'},stages:[{key:'utilities',name:'水电'}],
    assignments:[{stage_key:'utilities',admin_id:'2',is_primary:true}],members:[{admin_id:'2',display_name:'王师傅',role:'worker',active:true,staff_status:'active'},{admin_id:'3',display_name:'李师傅',role:'worker',active:true,staff_status:'active'}]})});
  p.openAssignment({currentTarget:{dataset:{key:'utilities'}}});assert.equal(p.data.assignmentOptions[0].selected,true);assert.equal(p.data.primaryOptions[p.data.selectedPrimary].id,'2');
  p.onIds({detail:{value:['2','3']}});assert.equal(p.data.primaryOptions[p.data.selectedPrimary].id,'2');
  p.updatePrimaryOptions(['2','3']);assert.equal(p.data.selectedPrimary,0);
});

test('an old identity write receipt cannot clear the new identity pending operation', async () => {
  const f=fixture(),p=f.page();await p.onShow();
  const old={path:'/miniprogram/construction/projects/9/contact',body:{expectedVersion:4},key:'old',identityKey:'1:2'};
  f.values.set('construction:pending:1:2',old);p.setData({pending:old});
  let finish;f.intercept(async (_url,method)=>method==='POST'?new Promise(resolve=>{finish=resolve;}):{data:{items:[],stages:[]}});
  const sending=p.sendPending();
  const next={...old,key:'next',identityKey:'1:3'};
  f.values.set('construction:pending:1:3',next);f.app.globalData.token='session-b';f.app.globalData.bootstrap.current.context.staffId='3';
  await p.onShow();finish({data:{id:'9',version:5}});await sending;
  assert.equal(p.data.pending.key,'next');assert.equal(f.values.get('construction:pending:1:3').key,'next');
  assert.equal(f.values.get('construction:pending:1:2').key,'old');assert.ok(!f.messages.includes('工地资料已保存'));
});
