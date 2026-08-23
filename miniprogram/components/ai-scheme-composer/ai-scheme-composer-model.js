function maxUserReferenceImages(maxReferenceImages) {
  return Math.max(0, Math.trunc(Number(maxReferenceImages) || 0) - 1);
}

function findModel(bootstrap, modelProfileId) {
  return (bootstrap?.models || []).find((item) => item.id === modelProfileId) || null;
}

function getUnitPrice(model, resolutionTier) {
  const price = (model?.prices || []).find((item) => item.resolutionTier === resolutionTier);
  return Number(price?.credits || 0);
}

const WHOLE_FLOOR_SCOPE_KEY = 'whole_floor_plan';
const SCOPE_APPLY_NOTE = '只应用到当前选择，不会自动为其他房间生成，也不会产生额外扣点。';
const COMPOSER_TOOL_ICONS = {
  scope: '/images/ai-design-icons/floor-plan.png',
  model: '/images/mine-icons/tab-ai.png',
  template: '/images/ai-design-icons/palette.png',
  settings: '/images/mine-v6/settings.png',
};

function pickDefaultModel(bootstrap) {
  const models = bootstrap?.models || [];
  const mapped = String(bootstrap?.provider?.defaultRemoteModel || '').trim();
  if (mapped) {
    const match = models.find((item) => item.remoteModel === mapped);
    if (match) return match;
  }
  return models.find((item) => item.isDefault) || models[0] || null;
}

function createDefaultDraft(bootstrap) {
  const model = pickDefaultModel(bootstrap);
  return {
    prompt: '',
    negativePrompt: '',
    modelProfileId: model?.id || '',
    aspectRatio: model?.defaults?.aspectRatio || '1:1',
    resolutionTier: model?.defaults?.resolutionTier || '1K',
    count: 1,
    templateId: '',
    templateName: '',
    referenceAssets: [],
    targetScope: WHOLE_FLOOR_SCOPE_KEY,
    roomId: '',
  };
}

function applyScopeToDraft(draft, scope) {
  const targetScope = scope && scope.targetScope === 'single_room' ? 'single_room' : WHOLE_FLOOR_SCOPE_KEY;
  return {
    ...(draft || {}),
    targetScope,
    roomId: targetScope === 'single_room' ? String(scope.roomId || '').trim() : '',
  };
}

function resolveDraftScope(scopes, draft) {
  const list = Array.isArray(scopes) ? scopes : [];
  if (draft && draft.targetScope === 'single_room' && draft.roomId) {
    const found = list.find((item) => item && item.roomId === draft.roomId);
    if (found) return found;
  }
  return list.find((item) => item && item.targetScope === WHOLE_FLOOR_SCOPE_KEY) || list[0] || null;
}

function buildScopePickerOptions(scopes, draft) {
  const selected = resolveDraftScope(scopes, draft);
  return (Array.isArray(scopes) ? scopes : []).map((item) => ({
    value: item.key,
    label: item.name,
    subtitle: item.targetScope === 'single_room'
      ? (item.meta || '只应用到当前房间')
      : SCOPE_APPLY_NOTE,
    icon: COMPOSER_TOOL_ICONS.scope,
    active: Boolean(selected && item.key === selected.key),
    targetScope: item.targetScope,
    roomId: item.roomId || '',
  }));
}

function buildComposerToolbarItems(view) {
  const items = [];
  if (view && view.hasScopePicker) {
    items.push({
      key: 'scope',
      type: 'scope',
      label: '户型',
      icon: COMPOSER_TOOL_ICONS.scope,
    });
  }
  items.push(
    {
      key: 'model',
      type: 'model',
      label: '模型',
      icon: COMPOSER_TOOL_ICONS.model,
    },
    {
      key: 'template',
      type: 'template',
      label: '模板',
      icon: COMPOSER_TOOL_ICONS.template,
    },
    {
      key: 'settings',
      type: 'settings',
      label: '设置',
      icon: COMPOSER_TOOL_ICONS.settings,
    },
  );
  return items;
}

function buildComposerPickerTitle(type) {
  if (type === 'model') return '选择模型';
  if (type === 'aspect') return '选择比例';
  if (type === 'resolution') return '选择分辨率';
  if (type === 'count') return '出图张数';
  if (type === 'scope') return '应用到哪里';
  return '';
}

function buildComposerPickerOptions(type, view) {
  if (!view || !type) return [];
  if (type === 'model') {
    return (view.modelOptions || []).map((item) => ({
      value: item.id,
      label: item.name,
      subtitle: item.subtitle || '',
      icon: COMPOSER_TOOL_ICONS.model,
      active: Boolean(item.active),
    }));
  }
  if (type === 'scope') return view.scopePickerOptions || [];
  if (type === 'aspect') return view.aspectOptions || [];
  if (type === 'resolution') return view.resolutionOptions || [];
  if (type === 'count') return view.countOptions || [];
  return [];
}

function buildScopeSubmitPayload(draft) {
  const targetScope = draft && draft.targetScope === 'single_room' ? 'single_room' : WHOLE_FLOOR_SCOPE_KEY;
  const roomId = targetScope === 'single_room' ? String(draft && draft.roomId || '').trim() : '';
  return {
    targetScope,
    ...(roomId ? { roomId } : {}),
  };
}

function applyModelDefaults(draft, model) {
  if (!model) return draft;
  const resolutionTier = (model.resolutionTiers || []).includes(model.defaults?.resolutionTier)
    ? model.defaults.resolutionTier
    : (model.resolutionTiers?.[0] || model.defaults?.resolutionTier || '1K');
  return {
    ...draft,
    modelProfileId: model.id,
    aspectRatio: model.defaults?.aspectRatio || draft.aspectRatio || '1:1',
    resolutionTier,
  };
}

function buildDraftFromBatch(batch, bootstrap) {
  if (!batch || String(batch.id).startsWith('legacy-')) {
    return {
      ...createDefaultDraft(bootstrap),
      prompt: batch?.prompt || '',
    };
  }
  const parameterSnapshot = batch.parameterSnapshot || {};
  const referenceAssets = (batch.referenceAssetIds || [])
    .map((id) => ({ id, previewUrl: '' }))
    .filter((item) => item.id);
  const targetScope = parameterSnapshot.targetScope === 'single_room' ? 'single_room' : WHOLE_FLOOR_SCOPE_KEY;
  return {
    prompt: batch.prompt || '',
    negativePrompt: batch.negativePrompt || '',
    modelProfileId: batch.modelProfileId || pickDefaultModel(bootstrap)?.id || '',
    aspectRatio: parameterSnapshot.aspectRatio || '1:1',
    resolutionTier: parameterSnapshot.resolutionTier || '1K',
    count: Number(batch.requestedCount || 1),
    templateId: parameterSnapshot.templateId || '',
    templateName: '',
    referenceAssets,
    targetScope,
    roomId: targetScope === 'single_room' ? String(parameterSnapshot.roomId || '') : '',
  };
}

function estimateCredits(draft, bootstrap) {
  const model = findModel(bootstrap, draft.modelProfileId);
  return getUnitPrice(model, draft.resolutionTier) * Math.max(1, Number(draft.count || 1));
}

function withFloorPlanPreviewRoom(url, targetScope, roomId) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  const room = targetScope === 'single_room' ? String(roomId || '').trim() : '';
  if (!room) return trimmed;
  const separator = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${separator}roomId=${encodeURIComponent(room)}`;
}

function buildComposerViewState(draft, bootstrap, options = {}) {
  const model = findModel(bootstrap, draft.modelProfileId);
  const maxRefs = maxUserReferenceImages(model?.maxReferenceImages || 0);
  const unitPrice = getUnitPrice(model, draft.resolutionTier);
  const estimatedCredits = unitPrice * Math.max(1, Number(draft.count || 1));
  const balance = Number(bootstrap?.account?.availableBalance || 0);
  const provider = bootstrap?.provider || {};
  const promptReady = Boolean(String(draft.prompt || '').trim());
  const modelReady = Boolean(draft.modelProfileId);
  const priceReady = unitPrice > 0;
  const creditsReady = balance >= estimatedCredits;
  const providerReady = Boolean(provider.actionEnabled);
  const referenceCount = (draft.referenceAssets || []).length;
  const editReady = !referenceCount || Boolean(provider.supportsEdit);
  const scopes = Array.isArray(options.scopes) ? options.scopes : [];
  const selectedScope = resolveDraftScope(scopes, draft);
  const scopeReady = !(draft.targetScope === 'single_room' && !String(draft.roomId || '').trim());
  const controlPreviewUrl = withFloorPlanPreviewRoom(
    options.floorPlanPreviewUrl,
    draft.targetScope,
    draft.roomId,
  );
  let blockedReason = '';
  if (!promptReady) blockedReason = '请输入提示词';
  else if (!modelReady) blockedReason = '请选择模型';
  else if (!scopeReady) blockedReason = '请先选择具体房间';
  else if (!priceReady) blockedReason = '当前分辨率不可用';
  else if (!providerReady) blockedReason = '当前企业未开放 AI 创作';
  else if (!editReady) blockedReason = '尚未配置图片编辑模型';
  else if (!creditsReady) blockedReason = `点数不足，需要 ${estimatedCredits} 点`;

  const aspectOptions = (model?.aspectRatios || ['1:1', '4:3', '3:4', '16:9', '9:16']).map((value) => ({
    value,
    label: value,
    active: draft.aspectRatio === value,
  }));
  const resolutionOptions = (model?.resolutionTiers || ['1K', '2K', '4K']).map((value) => ({
    value,
    label: value,
    active: draft.resolutionTier === value,
  }));
  const countOptions = [1, 2, 3, 4].map((value) => ({
    value,
    label: `${value} 张`,
    active: Number(draft.count) === value,
  }));
  const modelOptions = (bootstrap?.models || []).map((item) => {
    const price = getUnitPrice(item, draft.resolutionTier);
    const tier = draft.resolutionTier || item.defaults?.resolutionTier || '1K';
    return {
      id: item.id,
      name: item.name,
      active: item.id === draft.modelProfileId,
      subtitle: price > 0 ? `${tier} · ${price} 点/张` : `${tier} 出图`,
    };
  });

  return {
    draft,
    model,
    maxRefs,
    unitPrice,
    estimatedCredits,
    balance,
    canSubmit: !options.generating
      && !options.assisting
      && !options.uploading
      && promptReady
      && modelReady
      && scopeReady
      && priceReady
      && providerReady
      && editReady
      && creditsReady,
    blockedReason,
    hasScopePicker: scopes.length > 0,
    toolbarItems: buildComposerToolbarItems({ hasScopePicker: scopes.length > 0 }),
    scopeLabel: selectedScope ? selectedScope.name : '完整户型',
    scopeNote: SCOPE_APPLY_NOTE,
    scopePickerOptions: buildScopePickerOptions(scopes, draft),
    aspectOptions,
    resolutionOptions,
    countOptions,
    modelOptions,
    modelLabel: model?.name || '选择模型',
    aspectLabel: draft.aspectRatio || '1:1',
    resolutionLabel: draft.resolutionTier || '1K',
    countLabel: `${Math.max(1, Number(draft.count || 1))} 张`,
    referenceAssets: draft.referenceAssets || [],
    hasReferences: referenceCount > 0,
    canAddReference: referenceCount < maxRefs,
    hasControlPreview: Boolean(controlPreviewUrl),
    controlPreviewUrl,
    controlPreviewLabel: selectedScope && selectedScope.targetScope === 'single_room'
      ? `${selectedScope.name || '房间'}控制图`
      : '完整户型控制图',
    creditSummary: creditsReady
      ? `预计消耗 ${estimatedCredits} 点 · 可用 ${balance} 点`
      : `需要 ${estimatedCredits} 点 · 可用 ${balance} 点`,
  };
}

const PREFERRED_TEMPLATE_CATEGORY_NAME = '热门必备';
const TEMPLATE_PAGE_SIZE = 40;

function flattenPromptCategories(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const childrenByParent = new Map();
  for (const category of list) {
    const key = category.parentSourceId || 'root';
    const children = childrenByParent.get(key) || [];
    children.push(category);
    childrenByParent.set(key, children);
  }
  const result = [];
  const visit = (parentSourceId) => {
    for (const category of childrenByParent.get(parentSourceId) || []) {
      result.push(category);
      visit(category.sourceId);
    }
  };
  visit('root');
  return result;
}

function buildTemplateCategoryChips(categories, selectedCategoryId) {
  const flat = flattenPromptCategories(categories);
  const chips = [{
    id: '__all__',
    name: '全部',
    active: !selectedCategoryId,
  }];
  for (const category of flat) {
    chips.push({
      id: category.sourceId,
      name: category.name,
      level: category.level,
      active: selectedCategoryId === category.sourceId,
    });
  }
  return chips;
}

function resolvePreferredTemplateCategoryId(categories) {
  const flat = flattenPromptCategories(categories);
  const preferred = flat.find((item) => item.name === PREFERRED_TEMPLATE_CATEGORY_NAME);
  return preferred?.sourceId || '';
}

function buildTemplateListParams({
  categoryId = '',
  query = '',
  page = 1,
  limit = TEMPLATE_PAGE_SIZE,
} = {}) {
  const params = {
    page: Math.max(1, Number(page) || 1),
    limit: Math.min(100, Math.max(1, Number(limit) || TEMPLATE_PAGE_SIZE)),
  };
  const trimmedQuery = String(query || '').trim();
  if (trimmedQuery) params.q = trimmedQuery;
  if (categoryId && !trimmedQuery) params.categorySourceId = categoryId;
  return params;
}

function parseTemplateListPayload(payload) {
  const items = Array.isArray(payload?.items)
    ? payload.items
    : (Array.isArray(payload) ? payload : []);
  const total = Number(payload?.pagination?.total);
  return {
    items,
    total: Number.isFinite(total) ? total : items.length,
    page: Number(payload?.pagination?.page) || 1,
  };
}

module.exports = {
  COMPOSER_TOOL_ICONS,
  PREFERRED_TEMPLATE_CATEGORY_NAME,
  SCOPE_APPLY_NOTE,
  TEMPLATE_PAGE_SIZE,
  WHOLE_FLOOR_SCOPE_KEY,
  applyModelDefaults,
  applyScopeToDraft,
  buildComposerPickerOptions,
  buildComposerPickerTitle,
  buildComposerToolbarItems,
  buildComposerViewState,
  buildDraftFromBatch,
  buildScopePickerOptions,
  buildScopeSubmitPayload,
  buildTemplateCategoryChips,
  buildTemplateListParams,
  createDefaultDraft,
  estimateCredits,
  findModel,
  flattenPromptCategories,
  getUnitPrice,
  maxUserReferenceImages,
  parseTemplateListPayload,
  pickDefaultModel,
  resolveDraftScope,
  resolvePreferredTemplateCategoryId,
  withFloorPlanPreviewRoom,
};
