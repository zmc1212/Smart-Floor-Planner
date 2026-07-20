function validateTaskInput(input) {
  if (!input || !['reference_recreate', 'style_transform', 'floor_plan_render', 'soft_furnishing'].includes(input.mode)) {
    return { valid: false, error: '不支持的 AI 生成模式' };
  }
  if (input.mode === 'floor_plan_render' && !input.floorPlanId) {
    return { valid: false, error: '请先从客户户型进入，或选择正式户型' };
  }
  if (input.mode !== 'floor_plan_render' && !input.spaceAssetId) {
    return { valid: false, error: input.mode === 'soft_furnishing' ? '请先上传当前空间或基准效果图' : '请先上传我的空间图' };
  }
  if (input.mode === 'reference_recreate' && !input.referenceAssetId) {
    return { valid: false, error: '请先上传参考图' };
  }
  if (input.mode !== 'reference_recreate' && !input.styleKey) {
    return { valid: false, error: '请选择目标风格' };
  }
  const available = Number(input.availableBalance || 0);
  const price = Number(input.price || 0);
  if (available < price) return { valid: false, error: 'AI 点数不足', insufficient: true };
  return { valid: true };
}

module.exports = { validateTaskInput };
