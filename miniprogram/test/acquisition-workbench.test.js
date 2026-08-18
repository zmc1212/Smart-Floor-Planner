const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(miniRoot, '..');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

const appJson = read(miniRoot, 'app.json');
const pageJs = read(miniRoot, 'packages', 'business', 'acquisition-center', 'acquisition-center.js');
const pageWxml = read(miniRoot, 'packages', 'business', 'acquisition-center', 'acquisition-center.wxml');
const pageWxss = read(miniRoot, 'packages', 'business', 'acquisition-center', 'acquisition-center.wxss');
const sheetJs = read(miniRoot, 'components', 'designer-contact-sheet', 'designer-contact-sheet.js');
const sheetWxml = read(miniRoot, 'components', 'designer-contact-sheet', 'designer-contact-sheet.wxml');
const sheetWxss = read(miniRoot, 'components', 'designer-contact-sheet', 'designer-contact-sheet.wxss');
const mineJs = read(miniRoot, 'pages', 'mine', 'mine.js');
const acquireRoute = read(projectRoot, 'admin', 'src', 'app', 'api', 'leads', '[id]', 'acquire', 'route.ts');
const taskRoute = read(projectRoot, 'admin', 'src', 'app', 'api', 'acquisition-tasks', 'route.ts');
const acquisitionRepository = read(projectRoot, 'admin', 'src', 'db', 'repositories', 'acquisition-repository.ts');

test('Acquisition collaboration is a role-aware subpackage workbench with truthful states', () => {
  assert.match(appJson, /acquisition-center\/acquisition-center/);
  for (const state of ['loading', 'errorMessage', 'pending_confirmation', 'confirmed', 'confirmingId']) {
    assert.match(pageJs, new RegExp(state));
  }
  assert.match(pageWxml, /确认已添加微信/);
  assert.match(pageWxml, /class="bound-designer-strip"/);
  assert.match(pageWxml, />我的设计师</);
  assert.match(pageWxml, />查看微信<\/button>/);
  assert.doesNotMatch(pageWxml, /查看设计师微信/);
  assert.doesNotMatch(pageWxml, /item\.designer\.wechatId/);
  assert.match(pageWxml, /获客交接已确认/);
  assert.match(pageWxml, /class="handoff-witness"/);
  assert.match(pageWxml, /padding-right: \{\{navigationRight\}\}px/);
  assert.match(pageWxss, /font-size: 24rpx/);
  assert.match(pageJs, /此操作不会改变客户线索的量房或设计进度/);
});

test('Acquisition collaboration supports pull-to-refresh and visible-page polling', () => {
  assert.match(pageWxml, /refresher-enabled/);
  assert.match(pageWxml, /refresher-triggered="\{\{refreshing\}\}"/);
  assert.match(pageWxml, /bindrefresherrefresh="onRefresh"/);
  assert.match(pageJs, /async onRefresh\(\)/);
  assert.match(pageJs, /setInterval\(/);
  assert.match(pageJs, /clearInterval\(/);
  assert.match(pageJs, /onHide\(\)/);
  assert.match(pageJs, /onUnload\(\)/);
  assert.match(pageJs, /30 \* 1000/);
});

test('The shared designer contact sheet is bottom anchored, read-only, and supports real QR states', () => {
  assert.match(sheetWxml, />设计师名片</);
  assert.match(sheetWxml, /show-menu-by-longpress="\{\{true\}\}"/);
  assert.match(sheetWxml, /二维码加载失败/);
  assert.match(sheetWxml, /暂未提供二维码/);
  assert.match(sheetWxml, />复制微信号<\/button>/);
  assert.match(sheetWxss, /bottom: 0;/);
  assert.match(sheetWxss, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(sheetWxml, /绑定设计师|换绑|编辑关系/);
  assert.match(sheetJs, /this\.triggerEvent\('retry'\)/);
  assert.match(sheetJs, /qrRefreshing: true/);
  assert.match(sheetWxml, /正在重新获取二维码/);
  assert.match(sheetJs, /setTimeout\(/);
  assert.match(sheetJs, /_qrRetry=\$\{Date\.now\(\)\}/);
  assert.match(sheetJs, /responseType: 'arraybuffer'/);
  assert.match(sheetJs, /wx\.getFileSystemManager\(\)\.writeFile/);
  assert.match(sheetWxml, /二维码资源暂时无法读取/);
  assert.doesNotMatch(sheetJs, /wx\.nextTick/);
});

test('Acquisition confirmation remains independent from lead lifecycle and is idempotent', () => {
  assert.doesNotMatch(acquireRoute, /set\(\{\s*status:\s*'acquired'/s);
  assert.match(acquireRoute, /isNull\(leads\.acquiredAt\)/);
  assert.match(acquireRoute, /inArray\(leads\.status, CONFIRMABLE_LEAD_STATUSES\)/);
  assert.match(acquireRoute, /notifyMeasurerOfAcquiredLead/);
  assert.match(acquireRoute, /acquisitionCommissionToDto/);
  assert.match(taskRoute, /role !== 'designer' && role !== 'measurer'/);
  assert.match(taskRoute, /pending_confirmation/);
  assert.match(taskRoute, /taskSummary/);
  assert.match(taskRoute, /designerProfile:/);
  assert.match(taskRoute, /findDesignerForMeasurer/);
  assert.doesNotMatch(taskRoute, /wechatId: designer\.wechatId/);
  assert.match(acquisitionRepository, /pendingSettlementAmount/);
});

test('Mine and notification flows deep-link to Acquisition Collaboration', () => {
  assert.match(mineJs, /acquisition-center\/acquisition-center/);
  assert.match(mineJs, /metadataPage/);
  assert.match(mineJs, /item\.metadata\.page/);
});
