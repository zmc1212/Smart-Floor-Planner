const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const componentJs = fs.readFileSync(
  path.join(miniRoot, 'components', 'lead-list', 'lead-list.js'),
  'utf8'
);
const componentWxml = fs.readFileSync(
  path.join(miniRoot, 'components', 'lead-list', 'lead-list.wxml'),
  'utf8'
);
const componentWxss = fs.readFileSync(
  path.join(miniRoot, 'components', 'lead-list', 'lead-list.less'),
  'utf8'
);
const pageWxss = fs.readFileSync(
  path.join(miniRoot, 'pages', 'leads-management', 'leads-management.less'),
  'utf8'
);
const leadsRoute = fs.readFileSync(
  path.join(miniRoot, '..', 'admin', 'src', 'app', 'api', 'leads', 'route.ts'),
  'utf8'
);
const appStyle = fs.readFileSync(path.join(miniRoot, 'app.less'), 'utf8');
const {
  buildFloorPlanPreview,
  createWallSegments
} = require('../components/lead-list/lead-list-model.js');

function createFormalLayout() {
  return {
    version: 4,
    measurementMode: 'surveying',
    surveyGraph: {
      kind: 'survey-wall-graph',
      activeFloorId: 'floor-1',
      floors: [{
        id: 'floor-1',
        nodes: [
          { id: 'a', xMm: 0, yMm: 0 },
          { id: 'b', xMm: 4200, yMm: 0 },
          { id: 'c', xMm: 4200, yMm: 3200 },
          { id: 'd', xMm: 0, yMm: 3200 }
        ],
        walls: [
          { id: 'w1', startNodeId: 'a', endNodeId: 'b' },
          { id: 'w2', startNodeId: 'b', endNodeId: 'c' },
          { id: 'w3', startNodeId: 'c', endNodeId: 'd' },
          { id: 'w4', startNodeId: 'd', endNodeId: 'a' }
        ],
        spaces: [{ id: 'space-1', closed: true }]
      }]
    }
  };
}

test('Leads management exposes the canonical lead stages', () => {
  for (const label of ['全部', '新线索', '量房中', '方案设计', '已签约', '已关闭']) {
    assert.match(componentJs, new RegExp(`label: '${label}'`));
  }
  assert.doesNotMatch(componentJs, /label: '已获客'/);
  assert.doesNotMatch(componentJs, /id: 'acquired'/);
  assert.match(componentJs, /\{ id: 'designing', query: 'designing', label: '方案设计' \}/);
});

test('Leads preserves the approved first-screen rhythm without legacy acquisition contact', () => {
  const pageWxml = fs.readFileSync(
    path.join(miniRoot, 'pages', 'leads-management', 'leads-management.wxml'),
    'utf8'
  );
  const pageJson = fs.readFileSync(
    path.join(miniRoot, 'pages', 'leads-management', 'leads-management.json'),
    'utf8'
  );
  assert.doesNotMatch(componentWxml, /designer-contact-card|designer-qr/);
  assert.doesNotMatch(pageWxml, /my-designer-entry|我的设计师|designer-contact-sheet/);
  assert.doesNotMatch(pageJson, /designer-contact-sheet/);
  const headerIndex = pageWxml.indexOf('class="page-header"');
  const summaryIndex = componentWxml.indexOf('class="lead-hero-card"');
  const workspaceIndex = componentWxml.indexOf('class="lead-workspace"');
  assert.ok(headerIndex >= 0 && summaryIndex >= 0 && workspaceIndex > summaryIndex);
});

test('Measurer Customers tab shares the staff lead list instead of the workbench', () => {
  const pageWxml = fs.readFileSync(
    path.join(miniRoot, 'pages', 'leads-management', 'leads-management.wxml'),
    'utf8'
  );
  const pageJs = fs.readFileSync(
    path.join(miniRoot, 'pages', 'leads-management', 'leads-management.js'),
    'utf8'
  );
  const pageJson = fs.readFileSync(
    path.join(miniRoot, 'pages', 'leads-management', 'leads-management.json'),
    'utf8'
  );
  const tabBar = fs.readFileSync(
    path.join(miniRoot, 'custom-tab-bar', 'index.js'),
    'utf8'
  );
  assert.doesNotMatch(pageWxml, /role-workbench|roleWorkbenchRole/);
  assert.doesNotMatch(pageJs, /getRoleWorkbenchRole|roleWorkbenchRole/);
  assert.doesNotMatch(pageJson, /role-workbench/);
  assert.match(pageWxml, /<lead-list/);
  assert.match(pageJs, /canCreateLead = role === 'enterprise_admin'/);
  assert.match(tabBar, /measurer: \[[\s\S]*key: 'customers', capability: 'staff\.tasks'[\s\S]*leads-management/);
});

test('Leads list scroller receives the complete remaining page height', () => {
  const pageWxml = fs.readFileSync(
    path.join(miniRoot, 'pages', 'leads-management', 'leads-management.wxml'),
    'utf8'
  );
  assert.match(pageWxml, /<lead-list\s+class="lead-list-host"\s+style="display: flex; height: 100%; flex: 1; min-height: 0; flex-direction: column;"/);
  assert.match(pageWxss, /\.main-content\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*min-height:\s*0;/s);
  assert.match(pageWxss, /\.lead-list-host\s*\{[^}]*height:\s*100%;[^}]*flex:\s*1;[^}]*min-height:\s*0;/s);
  assert.match(componentWxss, /\.lead-list-container\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*height:\s*100%;/s);
  assert.match(componentWxss, /\.list-scroller\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;/s);
});

test('Leads management search and filter controls are functional', () => {
  assert.match(componentWxml, /bindinput="onSearchInput"/);
  assert.match(componentWxml, /bindtap="onFilterTap"/);
  assert.match(componentJs, /filterLeads\(leads, keyword\)/);
  assert.match(componentJs, /wx\.showActionSheet/);
  assert.doesNotMatch(componentJs, /筛选功能开发中/);
});

test('role workbench host has an explicit full-height contract', () => {
  assert.match(appStyle, /role-workbench\s*\{[\s\S]*display:\s*block;[\s\S]*height:\s*100%;/);
});

test('Leads list accepts bearer sessions without requiring a legacy OpenID', () => {
  assert.match(componentJs, /const app = getApp\(\);/);
  assert.match(componentJs, /app\.globalData\.token/);
  assert.doesNotMatch(componentJs, /if \(!openid\) return;/);
});

test('Leads visual assets exist and micro-icons stay within budget', () => {
  const assetDir = path.join(miniRoot, 'images', 'leads-v4');
  const icons = [
    'search.png',
    'filter.png',
    'plus-white.png',
    'phone.png',
    'map-pin.png',
    'chevron-right.png',
    'clock-blue.png',
    'ruler-green.png',
    'ruler-purple.png',
    'ruler-orange.png'
  ];

  for (const filename of icons) {
    const file = path.join(assetDir, filename);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(bytes.length <= 10 * 1024, `${filename} exceeds the 10KB icon budget`);
  }

  assert.ok(fs.statSync(
    path.join(miniRoot, 'images', 'leads-ip-v1', 'client-concierge-scene.png')
  ).size > 0);
  const transparentMeasure = fs.statSync(
    path.join(miniRoot, 'images', 'mine-icons', 'tab-measure-k.png')
  );
  assert.ok(transparentMeasure.size <= 10 * 1024, 'tab-measure-k.png exceeds the 10KB icon budget');
  const transparentPlus = fs.readFileSync(
    path.join(miniRoot, 'images', 'leads-ip-v1', 'plus-white.png')
  );
  assert.equal(transparentPlus.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.match(componentWxml, /\/images\/leads-ip-v1\/plus-white\.png/);
});

test('Leads IP v1 uses the dossier composition and data-backed floor-plan previews', () => {
  assert.match(componentJs, /remeasuring: '\/images\/leads-v4\/ruler-purple\.png'/);
  assert.match(componentJs, /buildFloorPlanPreview\(lead\)/);
  assert.doesNotMatch(componentJs, /SCENE_THUMBNAILS|lead-scene-/);
  assert.match(componentWxml, /item\.planPreview\.segments/);
  assert.match(componentWxml, /class="lead-hero-summary"/);
  assert.match(componentWxml, /class="lead-workspace"/);
  assert.match(componentWxml, /class="lead-card-back"/);
  assert.match(componentWxml, /class="tab-active-indicator"/);
  assert.doesNotMatch(componentWxml, /ellipsis\.png|class="more"/);
  assert.match(componentWxml, /class="card-bottom-row"/);
  assert.match(componentWxml, /class="lead-card-layer layer-\{\{item\.statusTone\}\}"/);
  assert.match(componentWxss, /\.lead-hero-card\s*\{[^}]*width:\s*310rpx;[^}]*height:\s*256rpx;/s);
  assert.match(componentWxss, /\.lead-workspace\s*\{[^}]*border-radius:\s*0 76rpx 0 0;/s);
  assert.match(componentWxss, /\.lead-card-layer\s*\{[^}]*width:\s*132rpx;[^}]*height:\s*51rpx;/s);
  assert.match(componentWxss, /\.lead-card\s*\{[^}]*min-height:\s*244rpx;/s);
  assert.match(componentWxml, /class="phone-row"/);
  assert.match(componentWxml, /class="location-row"/);
  assert.match(componentWxml, /class="location-text">\{\{item\.communityLabel\}\}/);
  assert.match(componentWxss, /\.location-text\s*\{[^}]*-webkit-line-clamp:\s*2;/s);
  assert.doesNotMatch(componentWxml, /class="contact-row"/);
  assert.match(componentWxss, /\.status-ribbon\s*\{[^}]*min-width:\s*104rpx;[^}]*height:\s*48rpx;/s);
  assert.match(componentWxss, /\.lead-plan-frame\s*\{[^}]*width:\s*220rpx;[^}]*height:\s*154rpx;/s);
});

test('Leads summary uses tenant-scoped server aggregates for every active stage', () => {
  for (const status of ['contacted', 'measured', 'designing', 'quoting']) {
    assert.match(leadsRoute, new RegExp(`'${status}'`));
    assert.match(componentJs, new RegExp(`stats\\.${status}`));
  }
  assert.match(leadsRoute, /todayNew: result\.todayNew/);
  assert.match(leadsRoute, /following,/);
  assert.match(leadsRoute, /createdSince: startOfChinaBusinessDay\(\)/);
});

test('Formal wall graphs are normalized into real thumbnail wall segments', () => {
  const segments = createWallSegments(createFormalLayout());
  assert.equal(segments.length, 4);
  assert.match(segments[0].style, /left:\d+\.\d+%;top:\d+\.\d+%;width:\d+\.\d+%/);

  const preview = buildFloorPlanPreview({
    primaryFloorPlanId: {
      _id: 'plan-1',
      layoutData: createFormalLayout()
    }
  });
  assert.equal(preview.type, 'graph');
  assert.equal(preview.planId, 'plan-1');
  assert.equal(preview.layoutLabel, '1个空间');
});

test('External preview images win and missing floor plans stay explicit', () => {
  const external = buildFloorPlanPreview({
    floorPlanIds: [{
      _id: 'plan-2',
      externalSource: {
        previewUrl: 'https://example.com/plan.png',
        layoutLabel: '三室两厅'
      }
    }]
  });
  assert.equal(external.type, 'image');
  assert.equal(external.layoutLabel, '三室两厅');

  const protectedPreview = buildFloorPlanPreview({
    _id: 'lead-1',
    primaryFloorPlanId: {
      _id: 'plan-3',
      previewUrl: '/api/floorplans/plan-3/preview?v=2',
      layoutData: createFormalLayout(),
    }
  });
  assert.equal(protectedPreview.type, 'protected');
  assert.equal(protectedPreview.previewEndpoint, '/floorplans/plan-3/preview?v=2');

  const empty = buildFloorPlanPreview({ floorPlanIds: [] });
  assert.equal(empty.type, 'empty');
  assert.equal(empty.segments.length, 0);
});

test('Leads list does not background-poll or re-enter pull-to-refresh', () => {
  const pageJs = fs.readFileSync(
    path.join(miniRoot, 'pages', 'leads-management', 'leads-management.js'),
    'utf8'
  );
  assert.match(componentJs, /if \(this\._fetching\)/);
  assert.match(componentJs, /observer\(newVal, oldVal\)/);
  assert.match(componentJs, /if \(newVal && newVal !== oldVal\)/);
  assert.match(componentJs, /this\._closingRefresher = true/);
  assert.match(componentJs, /if \(this\._fetching \|\| this\._closingRefresher\) return;/);
  assert.doesNotMatch(componentJs, /this\.setData\(\{ refreshing: true \}\)/);
  assert.match(pageJs, /if \(this\._listReady\)/);
  assert.match(pageJs, /leadList\.fetchLeads\(true\)/);
  assert.match(pageJs, /onLeadSuccess\(\)[\s\S]*leadList\.onRefresh\(\)/);
});
