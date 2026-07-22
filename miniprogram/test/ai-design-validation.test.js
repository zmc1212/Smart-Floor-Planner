const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTaskInput } = require('../utils/aiDesignValidation.js');

test('standalone reference recreate requires both source images', () => {
  assert.equal(validateTaskInput({ mode: 'reference_recreate', availableBalance: 100, price: 10 }).error, '请先上传我的空间图');
  assert.equal(validateTaskInput({ mode: 'reference_recreate', spaceAssetId: 'space', availableBalance: 100, price: 10 }).error, '请先上传参考图');
  assert.equal(validateTaskInput({ mode: 'reference_recreate', spaceAssetId: 'space', referenceAssetId: 'reference', availableBalance: 100, price: 10 }).valid, true);
});

test('plan-backed reference recreate uses the selected room control and only requires a reference image', () => {
  const planInput = {
    mode: 'reference_recreate',
    floorPlanId: 'plan',
    targetScope: 'single_room',
    roomId: 'bedroom',
    availableBalance: 100,
    price: 10,
  };
  assert.equal(validateTaskInput(planInput).error, '请先上传参考图');
  assert.equal(validateTaskInput({ ...planInput, referenceAssetId: 'reference' }).valid, true);
});

test('style transform requires style and enough enterprise credits', () => {
  assert.equal(validateTaskInput({ mode: 'style_transform', spaceAssetId: 'space', availableBalance: 100, price: 10 }).error, '请选择目标风格');
  const insufficient = validateTaskInput({ mode: 'style_transform', spaceAssetId: 'space', styleKey: 'modern', availableBalance: 9, price: 10 });
  assert.equal(insufficient.insufficient, true);
  assert.equal(validateTaskInput({ mode: 'style_transform', spaceAssetId: 'space', styleKey: 'modern', availableBalance: 10, price: 10 }).valid, true);
});

test('floor-plan rendering requires a formal plan context instead of a space photo', () => {
  assert.equal(validateTaskInput({ mode: 'floor_plan_render', styleKey: 'modern', availableBalance: 20, price: 10 }).error, '请先从客户户型进入，或选择正式户型');
  assert.equal(validateTaskInput({ mode: 'floor_plan_render', floorPlanId: 'plan', styleKey: 'modern', availableBalance: 20, price: 10 }).valid, true);
  assert.equal(validateTaskInput({ mode: 'floor_plan_render', floorPlanId: 'plan', targetScope: 'single_room', styleKey: 'modern', availableBalance: 20, price: 10 }).error, '单房间设计必须选择具体房间');
  assert.equal(validateTaskInput({ mode: 'floor_plan_render', floorPlanId: 'plan', targetScope: 'whole_floor_plan', roomId: 'living', styleKey: 'modern', availableBalance: 20, price: 10 }).error, '完整户型设计不能同时指定房间');
  assert.equal(validateTaskInput({ mode: 'floor_plan_render', floorPlanId: 'plan', targetScope: 'single_room', roomId: 'living', styleKey: 'modern', availableBalance: 20, price: 10 }).valid, true);
});

test('soft furnishing requires a baseline image and style', () => {
  assert.equal(validateTaskInput({ mode: 'soft_furnishing', styleKey: 'modern', availableBalance: 20, price: 10 }).error, '请先上传当前空间或基准效果图');
  assert.equal(validateTaskInput({ mode: 'soft_furnishing', spaceAssetId: 'space', availableBalance: 20, price: 10 }).error, '请选择目标风格');
  assert.equal(validateTaskInput({ mode: 'soft_furnishing', spaceAssetId: 'space', styleKey: 'modern', availableBalance: 20, price: 10 }).valid, true);
});
