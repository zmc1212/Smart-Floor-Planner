function validateTaskInput(input) {
  if (!input || !['reference_recreate', 'style_transform', 'floor_plan_render', 'soft_furnishing'].includes(input.mode)) {
    return { valid: false, error: '不支持的 AI 生成模式' };
  }
  if (input.mode === 'floor_plan_render' && !input.floorPlanId) {
    return { valid: false, error: '请先从客户户型进入，或选择正式户型' };
  }
  if (!input.floorPlanId && (input.roomId || input.targetScope)) {
    return { valid: false, error: '设计范围必须关联正式户型' };
  }
  if (input.floorPlanId) {
    const targetScope = input.targetScope || (input.roomId ? 'single_room' : 'whole_floor_plan');
    if (!['whole_floor_plan', 'single_room'].includes(targetScope)) {
      return { valid: false, error: '不支持的户型设计范围' };
    }
    if (targetScope === 'single_room' && !input.roomId) {
      return { valid: false, error: '单房间设计必须选择具体房间' };
    }
    if (targetScope === 'whole_floor_plan' && input.roomId) {
      return { valid: false, error: '完整户型设计不能同时指定房间' };
    }
  }
  const usesReferenceFloorPlanControl = input.mode === 'reference_recreate' && Boolean(input.floorPlanId);
  if (input.spaceAssetId && input.sourceResultTaskId) {
    return { valid: false, error: '空间图片和方案成果不能同时作为输入' };
  }
  if (input.sourceResultTaskId && !input.floorPlanId) {
    return { valid: false, error: '续接方案成果必须关联正式户型和设计范围' };
  }
  if (input.sourceResultTaskId && !['style_transform', 'soft_furnishing'].includes(input.mode)) {
    return { valid: false, error: '当前生成模式不能使用方案成果作为空间输入' };
  }
  if (input.mode !== 'floor_plan_render' && !usesReferenceFloorPlanControl
    && !input.spaceAssetId && !input.sourceResultTaskId) {
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
