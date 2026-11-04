const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api');
const { FollowupController } = require('../packages/assistant/lib/followups');

function fixture() {
  let session = 'recipient', response, delay;
  const calls = [], quote = { available: true, title: '精艺施工标准', quote: '核对原工艺条件。', originalAvailable: true, sourceFile: { format: 'docx' } };
  const detail = { available: true, bindingId: '27', reportId: '98', revision: 2,
    projects: [{ id: '248', knowledgeSources: [{ sourceId: 'K55', title: quote.title }] }] };
  const controller = new FollowupController({ identity: () => session, emit() {}, headers: async () => ({ 'X-Assistant-Entry': 'signed-entry' }),
    client: { read: async (path, query, headers) => { calls.push({ path, query, headers }); if (delay) await delay;
      if (response instanceof Error) throw response; return response || quote; } }, schedule: () => 0, unschedule() {} });
  Object.assign(controller, { visible: true, session, selected: '27' }); controller.set({ followupDetail: detail });
  return { controller, calls, detail, quote, response(value) { response = value; }, wait(value) { delay = value; }, identity(value) { session = value; } };
}
test('report source uses the selected report revision/project catalog and signed entry', async () => {
  const f = fixture();
  await f.controller.readSource('248', 'K999'); await f.controller.readSource('999', 'K55'); assert.equal(f.calls.length, 0);
  await f.controller.readSource('248', 'K55');
  assert.deepEqual(f.calls[0], { path: '/followups/27/reports/98/projects/248/sources/K55', query: { revision: 2 }, headers: { 'X-Assistant-Entry': 'signed-entry' } });
  assert.equal(f.controller.state.reportSource.quote, f.quote.quote);
  assert.equal(f.controller.state.followupDetail, f.detail); assert.equal(f.controller.state.followupActive, false);
});
test('stage reminders show a short conditional checklist and keep the exact source behind its action', async () => {
  const f = fixture();
  const quote = '专业类型：施工工艺/检查\n实际阶段适用：furnishing\n依据：内测原稿；来源版本：SHA-256 abc\n\n'
    + '内部测试参考。适用条件：已收到家具或窗帘。\n核对事项：对照清单核对款色，发现破损或缺件时记录差异。';
  const project = { ...f.detail.projects[0], stageName: '软装',
    standards: [{ text: quote + '\n来源：内测原稿', citations: [{ sourceId: 'K55', quote }] }] };
  const report = { ...f.detail, kind: 'stage', ready: true, projects: [project] };
  f.controller.set({ followupActive: true, followupReports: [report] });
  assert.equal(f.controller.state.followupReports[0].projects[0].stageNote, '已收到家具或窗帘时，对照清单核对款色，发现破损或缺件时记录差异。');
  assert.equal(project.standards[0].citations[0].quote, quote);
  f.response({ ...f.quote, quote });
  await f.controller.readSource('248', 'K55', '98', 2);
  assert.equal(f.controller.state.reportSource.quote, quote);
  assert.equal(f.calls[0].path, '/followups/27/reports/98/projects/248/sources/K55');
});
test('stage cards retain short exact excerpts and hide long, unmatched or revoked content', () => {
  const f = fixture();
  const project = { ...f.detail.projects[0], stageName: '水电' };
  const stage = (quote, sourceId = 'K55', knowledgeSources = project.knowledgeSources, available = true) => {
    f.controller.set({ followupReports: [{ ...f.detail, kind: 'stage', ready: true, available,
      projects: [{ ...project, knowledgeSources, standards: [{ text: quote, citations: [{ sourceId, quote }] }] }] }] });
    return f.controller.state.followupReports[0].projects[0].stageNote;
  };
  assert.equal(stage('封槽前，先核对插座点位，记得留好管线照片。'), '封槽前，先核对插座点位，记得留好管线照片。');
  assert.equal(stage('封槽前，' + '核对全部插座点位。'.repeat(15)), '可查看本阶段的工艺核对要点。');
  assert.equal(stage('仅在房屋交接之后'), '可查看本阶段的工艺核对要点。');
  assert.equal(stage('封槽前，先核对插座点位。', 'K999'), '可查看本阶段的工艺核对要点。');
  assert.equal(stage('封槽前，先核对插座点位。', 'K55', []), '');
  assert.equal(stage('封槽前，先核对插座点位。', 'K55', project.knowledgeSources, false), undefined);
});
test('close, hide and identity changes fence late source replies', async () => {
  for (const action of ['close','hide','identity']) {
    const f = fixture(); let done; f.wait(new Promise(r => { done = r; }));
    const pending = f.controller.readSource('248', 'K55');
    if (action === 'close') f.controller.clearSource(); else if (action === 'hide') f.controller.hide(); else { f.identity('other'); f.controller.hide(); }
    done(); await pending; assert.equal(f.controller.state.reportSource, null);
  }
});
test('source failures clear quotes, retry the same locator and live report revocation fences replies', async () => {
  const f = fixture(); await f.controller.readSource('248', 'K55');
  f.response(Object.assign(Error('failed transport'), { statusCode: 503 })); await f.controller.loadSource();
  assert.equal(f.controller.state.reportSource, null); assert.ok(f.controller.state.reportSourceError);
  f.response(f.quote); await f.controller.loadSource(); assert.equal(f.controller.state.reportSource.quote, f.quote.quote);
  assert.deepEqual(f.calls[2], f.calls[0]);
  f.controller.set({ followupDetail: { ...f.detail, available: false, projects: [] } });
  assert.equal(f.controller.state.reportSource, null); assert.equal(f.controller.sourceRef, null);
  await f.controller.loadSource(); assert.equal(f.calls.length, 3);
});
test('original download rechecks the source, uses authentication and deletes its temporary file', async () => {
  const f = fixture(), oldDownload = api.downloadFile, previous = global.wx, opened = [], removed = [];
  api.downloadFile = async (url, options) => { assert.equal(url, '/miniprogram/assistant/followups/27/reports/98/projects/248/sources/K55/original?revision=2');
    assert.equal(options.headers['X-Assistant-Entry'], 'signed-entry'); return { tempFilePath: '/tmp/source.docx' }; };
  global.wx = { openDocument(options) { opened.push(options); options.success(); }, getFileSystemManager: () => ({ unlink(options) { removed.push(options.filePath); } }) };
  try {
    await f.controller.readSource('248', 'K55'); await f.controller.openSourceFile();
    assert.equal(f.calls.length, 2); assert.equal(opened[0].fileType, 'docx'); assert.equal(opened[0].showMenu, false);
    assert.deepEqual(removed, ['/tmp/source.docx']);
    f.response({ available: false }); await f.controller.openSourceFile(); assert.equal(opened.length, 1);
  } finally { api.downloadFile = oldDownload; global.wx = previous; }
});
test('a source closed during download is never opened and still releases its temporary file', async () => {
  const f = fixture(), oldDownload = api.downloadFile, previous = global.wx, removed = []; let finish, started;
  const downloading = new Promise(r => { started = r; });
  api.downloadFile = async () => { started(); return new Promise(r => { finish = r; }); };
  global.wx = { openDocument() { assert.fail('stale original must not open'); }, getFileSystemManager: () => ({ unlink: o => removed.push(o.filePath) }) };
  try {
    await f.controller.readSource('248', 'K55'); const pending = f.controller.openSourceFile(); await downloading;
    f.controller.clearSource(); finish({ tempFilePath: '/tmp/closed.docx' }); await pending;
    assert.deepEqual(removed, ['/tmp/closed.docx']); assert.equal(f.controller.state.reportSource, null);
  } finally { api.downloadFile = oldDownload; global.wx = previous; }
});
test('an unchanged background report refresh cannot cancel an original already downloading', async () => {
  const f = fixture(), oldDownload = api.downloadFile, previous = global.wx, opened = [];
  let finish, started; const downloading = new Promise(r => { started = r; });
  api.downloadFile = async () => { started(); return new Promise(r => { finish = r; }); };
  global.wx = { openDocument(options) { opened.push(options.fileType); options.success(); }, getFileSystemManager: () => ({ unlink() {} }) };
  try {
    await f.controller.readSource('248', 'K55'); const pending = f.controller.openSourceFile(); await downloading;
    f.controller.set({ followupDetail: { ...f.detail } }); await Promise.resolve();
    finish({ tempFilePath: '/tmp/authorized.pdf' }); await pending;
    assert.deepEqual(opened, ['docx']);
  } finally { api.downloadFile = oldDownload; global.wx = previous; }
});
