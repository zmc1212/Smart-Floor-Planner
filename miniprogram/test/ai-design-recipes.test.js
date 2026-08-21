const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('AI Design discovery renders real recipe browsing instead of the four-stage workbench', () => {
  const wxml = read('pages/ai-design/ai-design.wxml');
  const source = read('pages/ai-design/ai-design.js');
  const service = read('utils/aiDesignService.js');
  assert.match(wxml, /热门空间风格配方/);
  assert.match(wxml, /class="recipe-waterfall"/);
  assert.match(wxml, /class="featured-recipe-strip"/);
  assert.match(wxml, /class="create-scheme-hero"/);
  assert.match(wxml, /最近设计项目/);
  assert.doesNotMatch(wxml, />设计记录</);
  assert.doesNotMatch(wxml, /bindtap="openHistory"/);
  assert.match(service, /\/miniprogram\/ai\/history/);
  assert.match(wxml, /bindtap="openRecipeDetail"/);
  assert.doesNotMatch(wxml, /bindtap="switchRecipeInputMode"/);
  assert.doesNotMatch(wxml, /class="input-chevron"/);
  assert.match(wxml, /aria-disabled="true"/);
  assert.doesNotMatch(wxml, /project-hero-stage-rail/);
  assert.match(source, /loadRecipes\(\{ page: 1, limit: 24 \}\)/);
  assert.doesNotMatch(source, /visibleRecipes\.length \? visibleRecipes/);
  assert.match(source, /decorateVisibleRecipe/);
  assert.match(service, /\/miniprogram\/ai\/recipes/);
});

test('recipe flow contains detail, project, scope, photo, confirmation, and workflow-conflict states', () => {
  const detail = read('packages/ai-workflow/recipe-detail/recipe-detail.wxml');
  const project = read('packages/ai-workflow/recipe-project/recipe-project.wxml');
  const confirm = read('packages/ai-workflow/recipe-confirm/recipe-confirm.wxml');
  const confirmScript = read('packages/ai-workflow/recipe-confirm/recipe-confirm.js');
  assert.match(detail, /支持完整户型和单个房间/);
  assert.match(detail, /需要一张现场照片/);
  assert.match(project, /选择客户项目/);
  assert.match(project, /选择设计空间/);
  assert.match(project, /继续量房/);
  assert.match(confirm, /补充现场照片/);
  assert.match(confirm, /该客户已有成果/);
  assert.match(confirm, /失败自动释放/);
  assert.match(confirm, /选择要继续的客户方案/);
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
  const hero = fs.readFileSync(path.join(root, 'images', 'ai-recipe', 'recipe-atelier-hero.jpg'));
  assert.equal(hero.subarray(0, 2).toString('hex'), 'ffd8');
  assert.ok(hero.length <= 300 * 1024);
});
