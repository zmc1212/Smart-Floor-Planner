const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { sortSchemesByFirstPublished } = require('../packages/business/customer-ai-schemes/customer-ai-schemes-model');

const root = path.join(__dirname, '..');
const pageRoot = path.join(root, 'packages', 'business', 'customer-ai-schemes');

test('customer AI schemes page is registered and capsule-safe', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const business = appJson.subPackages.find((item) => item.root === 'packages/business');
  assert.ok(business.pages.includes('customer-ai-schemes/customer-ai-schemes'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pageRoot, 'customer-ai-schemes.json'), 'utf8')), {
    navigationStyle: 'custom',
    usingComponents: {
      'scheme-share-poster': '/components/scheme-share-poster/scheme-share-poster',
    },
  });
  const navigation = fs.readFileSync(path.join(root, 'utils', 'identity-navigation.js'), 'utf8');
  assert.match(navigation, /customer-ai-schemes\/customer-ai-schemes': \['customer\.projects'/);
  assert.match(navigation, /customer-ai-schemes\/customer-ai-schemes': \[[^\]]*'account'/);
});

test('customer AI schemes folio is read-only and consumes publishedSchemes', () => {
  const page = fs.readFileSync(path.join(pageRoot, 'customer-ai-schemes.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(pageRoot, 'customer-ai-schemes.wxml'), 'utf8');
  assert.match(page, /\/miniprogram\/customer-projects\/\$\{encodeURIComponent\(this\.data\.leadId\)\}/);
  assert.match(page, /\/leads\/\$\{encodeURIComponent\(this\.data\.leadId\)\}/);
  assert.match(page, /sortSchemesByFirstPublished/);
  assert.match(page, /publishedSchemes/);
  assert.match(page, /scheme\.finalized/);
  assert.match(page, /wx\.previewImage/);
  assert.match(page, /require\('\.\.\/\.\.\/\.\.\/utils\/protectedImageCache'\)/);
  assert.match(page, /readCachedProtectedImage/);
  assert.match(page, /image\.imageUrl && \/\^https\?:/);
  assert.match(page, /imagePath: image\.imageUrl/);
  assert.match(page, /imageState: 'loaded'/);
  assert.doesNotMatch(wxml, /进入 AI 设计|继续出图|材质微调|导出方案包/);
  assert.doesNotMatch(page, /onOpenAIDesign|publishScheme|withdrawPublication|exportSchemePack/);
  assert.match(wxml, /\/images\/airy-v1\/project-delivery-xiao-k\.png/);
  assert.doesNotMatch(wxml, /xiao-k-mascot-3d\.png/);
  assert.doesNotMatch(wxml, /packages\/business\/assets\/customer-project-v1\/project-delivery-xiao-k\.png/);
  assert.match(wxml, /客户 AI 方案/);
  assert.match(wxml, /交付时间轴/);
  assert.match(wxml, /全屏预览/);
  assert.match(wxml, /保存\/分享当前方案/);
  assert.match(wxml, /scheme-share-poster/);
  assert.match(wxml, /bindtap="saveOrShareScheme"/);
  assert.doesNotMatch(wxml, /open-type="share"/);
  assert.doesNotMatch(page, /onShareAppMessage/);
  assert.match(page, /hideShareMenu/);
  assert.match(page, /showSchemePoster: true/);
  assert.match(page, /posterImagePath/);
  assert.match(page, /\/miniprogram\/published-scheme-folios\/\$\{encodeURIComponent\(this\.data\.leadId\)\}/);
  assert.match(page, /applyLoadedPayload\(shared\.data \|\| \{\}, 'share'\)/);
  assert.match(page, /showShareAction: audience === 'customer'/);
  assert.match(page, /navigateToRoleLanding/);
  assert.doesNotMatch(wxml, /🎨|✓|✅/);
});

test('scheme round chips stay ordered by first publication after later updates', () => {
  const ordered = sortSchemesByFirstPublished([
    {
      id: 'lighting',
      title: '灯光方案',
      firstPublishedAt: '2026-08-21T10:00:00.000Z',
      publishedAt: '2026-08-21T10:00:00.000Z',
    },
    {
      id: 'ai',
      title: 'AI 设计方案',
      firstPublishedAt: '2026-08-20T10:00:00.000Z',
      publishedAt: '2026-08-22T11:02:00.000Z',
    },
  ]);
  assert.deepEqual(ordered.map((scheme) => scheme.id), ['ai', 'lighting']);
});

test('lead detail and customer project deep-link into the schemes folio', () => {
  const leadDetail = fs.readFileSync(path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.js'), 'utf8');
  const leadWxml = fs.readFileSync(path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.wxml'), 'utf8');
  const customerProject = fs.readFileSync(path.join(root, 'packages', 'business', 'customer-project', 'customer-project.js'), 'utf8');
  const customerWxml = fs.readFileSync(path.join(root, 'packages', 'business', 'customer-project', 'customer-project.wxml'), 'utf8');
  assert.match(leadDetail, /customer-ai-schemes\/customer-ai-schemes\?leadId=/);
  assert.match(leadDetail, /scheme\.finalized/);
  assert.match(leadDetail, /mode=staff/);
  assert.match(leadDetail, /openAIDesignEntry/);
  assert.match(leadDetail, /canOpenAIDesignWorkbench/);
  assert.match(leadWxml, /查看全部方案/);
  assert.match(leadWxml, /进入 AI 设计/);
  assert.match(leadWxml, /publishedSchemes\.length > 0 \|\| canOpenAIDesign/);
  assert.match(customerProject, /customer-ai-schemes\/customer-ai-schemes\?/);
  assert.match(customerProject, /mode=customer/);
  assert.match(customerProject, /openAiSchemes/);
  assert.match(customerWxml, /查看全部方案/);
});
