const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FollowupController, reportForView } = require('../packages/assistant/lib/followups');
const api = require('../utils/api');

function fixture({ composed = true } = {}) {
  let identity = 'owner', response = { available: true, id: 'K404', quote: '已发布工艺原文', originalAvailable: true, sourceFile: { format: 'docx' } }, wait;
  const calls = [];
  const raw = { reportId: '101', revision: 2, available: true, kind: 'stage', state: 'facts_ready', contentStatus: composed ? 'composed' : 'facts_only',
    generationLabel: composed ? '' : '正文生成中，可先查看原记录。', periodStart: '2026-11-01T01:10:00Z', periodEnd: '2026-11-01T01:10:01Z', cutoffAt: '2026-11-01T01:10:01Z',
    facts: { projects: [{ id: '248', stageKey: 'water', name: '合成水电工地', records: [], issues: [], arrangements: [] }] },
    body: composed ? [{ projectId: '248', progress: [{ text: '这是现场进展，不是工艺' }], pending: [], arrangements: [],
      standards: [{ key: 'standards:0', text: '开槽前核对插座点位', basis: 'evidence' }], knowledgeSources: [{ sourceId: 'K404', title: '精艺29页' }] }] : [] };
  const context = { bindingId: '27', audience: 'customer', stages: [{ key: 'water', name: '水电' }, { key: 'paint', name: '油漆' }], projects: [{ id: '248', stageKey: 'paint', stageName: '油漆' }] };
  const c = new FollowupController({ identity: () => identity, emit() {}, headers: async () => ({ 'X-Assistant-Entry': 'entry' }),
    client: { read: async (path, query, headers) => { calls.push({ path, query, headers }); if (wait) await wait; if (response instanceof Error) throw response; return response; } }, schedule: () => 0, unschedule() {} });
  Object.assign(c, { visible: true, session: identity, selected: '27' });
  c.set({ followupActive: true, followupContext: context, followupReports: [reportForView(raw, context)] });
  return { c, raw, context, calls, response(v) { response = v; }, wait(v) { wait = v; }, identity(v) { identity = v; } };
}
const open = f => f.c.readSource('248','K404','101',2);

test('stage reminder uses the frozen stage and actual standards, not current-stage or progress highlights', () => {
  const f=fixture(),r=f.c.state.followupReports[0];
  assert.equal(r.cardTitle,'水电阶段开始了'); assert.equal(r.stageReminder,true); assert.equal(r.projects[0].stageKey,'water');
  assert.deepEqual(r.projects[0].standards,f.raw.body[0].standards);
  const empty=fixture({ composed: false }).c.state.followupReports[0];
  assert.equal(empty.projects[0].standards,undefined); assert.equal(empty.generationLabel,'正文生成中，可先查看原记录。');
  const daily=reportForView({...f.raw,kind:'daily'},f.context);f.c.set({followupReports:[daily]});assert.equal(f.c.state.followupReports[0].stageReminder,undefined);
});
test('direct stage source binds report/revision/project/catalog without mounting or acknowledging full detail', async () => {
  const f=fixture();
  for(const args of [['248','K404','101',1],['other','K404','101',2],['248','K999','101',2],['248','K404','999',2]])await f.c.readSource(...args);
  assert.equal(f.calls.length,0);await open(f);
  assert.deepEqual(f.calls,[{path:'/followups/27/reports/101/projects/248/sources/K404',query:{revision:2},headers:{'X-Assistant-Entry':'entry'}}]);
  assert.equal(f.c.state.followupDetail,null);assert.equal(f.c.state.followupReports[0].readAt,undefined);assert.equal(f.c.state.reportSource.id,'K404');
});
test('direct source keeps visible failure until explicit same-locator retry', async () => {
  const f=fixture();f.response(Object.assign(Error('offline'),{statusCode:503}));await open(f);
  assert.ok(f.c.state.reportSourceError);f.c.set({followupReports:[{...f.c.state.followupReports[0]}]});
  assert.equal(f.calls.length,1);f.response({available:true,id:'K404'});await f.c.loadSource();
  assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.c.state.reportSourceError,'');
});
test('stage catalog, revision, selected binding and permission changes fence pending source replies', async () => {
  for(const change of ['catalog','revision','binding','unavailable','close','hide','identity','leave','detail']) {
    const f=fixture();let finish;f.wait(new Promise(r=>{finish=r;}));const pending=open(f),r=f.c.state.followupReports[0];
    if(change==='catalog')f.c.set({followupReports:[{...r,projects:[{...r.projects[0],knowledgeSources:[]}]}]});
    if(change==='revision')f.c.set({followupReports:[{...r,revision:3}]});
    if(change==='binding'){f.c.selected='other';f.c.set({followupReports:[r]});}
    if(change==='unavailable')f.c.set({followupReports:[{...r,available:false}]});
    if(change==='close')f.c.clearSource();if(change==='hide')f.c.hide();if(change==='identity'){f.identity('other');f.c.hide();}
    if(change==='leave')f.c.leave();if(change==='detail')f.c.set({followupDetail:null});
    finish();await pending;assert.equal(f.c.state.reportSource,null,change);assert.equal(f.c.sourceRef,null,change);
  }
});
test('unchanged stage polling preserves an authenticated download; catalog revocation cancels it and deletes the file', async () => {
  const previous=global.wx,download=api.downloadFile;
  try{for(const revoke of [false,true]) {
    const f=fixture(),opened=[],deleted=[];let start,finish;const started=new Promise(r=>{start=r;});
    api.downloadFile=async()=>{start();return new Promise(r=>{finish=r;});};
    global.wx={openDocument(o){opened.push(o.fileType);o.success();},getFileSystemManager:()=>({unlink:o=>deleted.push(o.filePath)})};
    await open(f);const pending=f.c.openSourceFile();await started;
    const r=f.c.state.followupReports[0];f.c.set({followupReports:[revoke?{...r,projects:[]}:{...r}]});
    finish({tempFilePath:'/tmp/stage.docx'});await pending;
    assert.deepEqual(opened,revoke?[]:['docx']);assert.deepEqual(deleted,['/tmp/stage.docx']);
  }}finally{global.wx=previous;api.downloadFile=download;}
});
test('native source chooser cancellation and late selection preserve the current route and report', async () => {
  const previous=global.wx;
  try {
    const f=fixture(),page=require('../packages/assistant/chat/chat-definition')();let choose;const sheets=[];
    page.followups=f.c;page.openSheet=s=>sheets.push(s);
    f.c.state.followupReports[0].projects[0].knowledgeSources.push({sourceId:'K405',title:'第二份工艺'});
    global.wx={showActionSheet(o){choose=o;}};
    const e={currentTarget:{dataset:{report:'101',revision:2,project:'248'}}};
    page.openReportSource(e);assert.deepEqual(choose.itemList,['精艺29页','第二份工艺']);assert.deepEqual(sheets,[]);
    f.c.clearSource();f.c.set({followupReports:[]});choose.success({tapIndex:0});assert.deepEqual(sheets,[]);
    f.c.set({followupReports:[reportForView(f.raw,f.context)]});page.openReportSource(e);f.c.hide();choose.success({tapIndex:0});assert.deepEqual(sheets,[]);
    f.c.set({followupReports:[{reportId:'101',revision:2,available:false}]});assert.doesNotThrow(()=>page.openReportSource(e));
  }finally{global.wx=previous;}
});
