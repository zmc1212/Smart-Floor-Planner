const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('AI Design discovery keeps the approved recipe discovery section inside the unified entry', () => {
  const wxml = read('pages/ai-design/ai-design.wxml');
  const source = read('pages/ai-design/ai-design.js');
  const service = read('utils/aiDesignService.js');
  assert.match(wxml, /热门空间风格配方/);
  assert.match(wxml, /class="recipe-waterfall"/);
  assert.match(wxml, /class="featured-recipe-strip"/);
  assert.match(wxml, /class="project-hero"/);
  assert.match(wxml, /看看配方效果/);
  assert.doesNotMatch(wxml, />设计记录</);
  assert.doesNotMatch(wxml, /bindtap="openHistory"/);
  assert.match(service, /\/miniprogram\/ai\/history/);
  assert.match(wxml, /bindtap="openRecipeBinding"/);
  assert.match(source, /\/recipe-project\/recipe-project\?recipeId=/);
  assert.doesNotMatch(wxml, /bindtap="switchRecipeInputMode"/);
  assert.doesNotMatch(wxml, /class="input-chevron"/);
  assert.doesNotMatch(wxml, /project-hero-stage-rail/);
  assert.match(source, /loadRecipes\(\{ page: 1, limit: 24 \}\)/);
  assert.doesNotMatch(source, /visibleRecipes\.length \? visibleRecipes/);
  assert.match(source, /decorateVisibleRecipe/);
  assert.match(service, /\/miniprogram\/ai\/recipes/);
});

test('recipe flow picks customer then scheme before confirmation', () => {
  const detail = read('packages/ai-workflow/recipe-detail/recipe-detail.wxml');
  const project = read('packages/ai-workflow/recipe-project/recipe-project.wxml');
  const projectScript = read('packages/ai-workflow/recipe-project/recipe-project.js');
  const confirm = read('packages/ai-workflow/recipe-confirm/recipe-confirm.wxml');
  const confirmScript = read('packages/ai-workflow/recipe-confirm/recipe-confirm.js');
  const service = read('utils/aiDesignService.js');
  assert.match(detail, /正在带入客户方案/);
  assert.doesNotMatch(detail, /detail-hero|recipe-facts|input-choice/);
  assert.match(project, /选择客户/);
  assert.match(project, /选择方案/);
  assert.match(project, /item\.actionLabel/);
  assert.match(project, /方案对话/);
  assert.match(project, /bindtap="createScheme"/);
  assert.doesNotMatch(project, /只展示当前账号可使用的正式量房/);
  assert.match(projectScript, /loadStudioLeads/);
  assert.match(projectScript, /onShow\(\)/);
  assert.match(projectScript, /reloadLeads/);
  assert.match(projectScript, /_surveyingLeadId/);
  assert.match(projectScript, /listStudioWorkflows/);
  assert.match(projectScript, /createStudioWorkflow/);
  assert.match(projectScript, /schemeId=/);
  assert.match(read('packages/ai-workflow/recipe-project/recipe-project-model.js'), /去量房/);
  assert.match(service, /\/miniprogram\/ai\/studio\/leads/);
  assert.match(confirm, /补充现场照片/);
  assert.match(confirm, /本户现场图/);
  assert.match(confirm, /该客户已有成果/);
  assert.match(confirm, /失败自动释放/);
  assert.match(confirm, /续接当前方案对话/);
  assert.match(confirm, /选择要继续的客户方案/);
  assert.match(confirmScript, /getStudioWorkflow/);
  assert.match(confirmScript, /chooseAiSource/);
  assert.match(confirmScript, /sitePhotoService/);
  assert.match(confirmScript, /spaceAssetId: photo\.assetId/);
  assert.doesNotMatch(confirmScript, /wx\.chooseMedia/);
  assert.doesNotMatch(confirmScript, /uploadAsset\(/);
  assert.match(confirmScript, /WORKFLOW_CONFLICT/);
  assert.match(confirmScript, /recipeId: this\.data\.recipeId/);
  assert.match(confirmScript, /redirectAfterRecipeTask/);
  assert.match(confirmScript, /shouldOpenSchemeStudio/);
  assert.match(confirmScript, /openSchemeStudio/);
  assert.match(confirmScript, /runTask\(task\.id\)/);
  assert.doesNotMatch(confirmScript, /ai-design-result\?id=\$\{task\.id\}&run=1/);
});

test('recipe identity stays visible in result and history without exposing prompts', () => {
  const result = read('packages/ai-workflow/result/ai-design-result.wxml');
  const history = read('packages/ai-workflow/history/ai-design-history.wxml');
  const files = [
    read('pages/ai-design/ai-design.wxml'),
    read('packages/ai-workflow/recipe-detail/recipe-detail.wxml'),
    read('packages/ai-workflow/recipe-project/recipe-project.wxml'),
    read('packages/ai-workflow/recipe-confirm/recipe-confirm.wxml'),
  ].join('\n');
  assert.match(result, /装修配方/);
  assert.match(result, /离开页面不会取消/);
  assert.match(history, />我的设计</);
  assert.match(history, /item\.recipeName/);
  assert.match(history, /item\.projectTitle/);
  assert.doesNotMatch(files, /提示词|prompt|模型|分辨率|workflowId/);
});

test('generated recipe artwork shipped to the Mini Program stays within the image budget', () => {
  const cover = fs.readFileSync(path.join(root, 'images', 'airy-v1', 'scheme-wood-cream-showcase.png'));
  assert.equal(cover.subarray(1, 4).toString(), 'PNG');
  assert.ok(cover.length <= 300 * 1024);
});
