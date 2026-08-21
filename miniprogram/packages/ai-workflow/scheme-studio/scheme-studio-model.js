function padTimePart(value) {
  return String(value).padStart(2, '0');
}

function formatBatchTime(value, nowValue = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date(nowValue);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const itemDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((dayStart - itemDayStart) / 86400000);
  const time = `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
  if (dayDifference === 0) return `今天 ${time}`;
  if (dayDifference === 1) return `昨天 ${time}`;
  return `${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())} ${time}`;
}

function summarizePrompt(prompt, maxLength = 96) {
  const text = String(prompt || '').trim();
  if (!text) return '历史出图';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function batchStatusLabel(status) {
  switch (status) {
    case 'pending':
    case 'processing':
      return '生成中';
    case 'failed':
      return '生成失败';
    case 'partial':
      return '部分成功';
    case 'succeeded':
      return '已完成';
    default:
      return '处理中';
  }
}

function generationStatusLabel(status, batchStatus) {
  if (status === 'succeeded') return '已完成';
  if (status === 'failed') return '生成失败';
  if (status === 'processing' || status === 'pending' || status === 'created') return '生成中';
  if (batchStatus === 'failed') return '生成失败';
  if (batchStatus === 'pending' || batchStatus === 'processing') return '生成中';
  return '处理中';
}

function buildConversationBatches(detail, task) {
  const publishedByGenerationId = new Map((detail?.generations || []).map((generation) => [
    String(generation.id),
    Boolean(generation.published),
  ]));
  const real = task && Array.isArray(task.batches)
    ? [...task.batches].sort((left, right) => left.sequence - right.sequence)
    : [];
  const claimed = new Set(real.flatMap((batch) => (batch.generations || []).map((generation) => String(generation.id))));
  const patchedReal = real.map((batch) => ({
    ...batch,
    generations: (batch.generations || []).map((generation) => ({
      ...generation,
      published: publishedByGenerationId.has(String(generation.id))
        ? publishedByGenerationId.get(String(generation.id))
        : false,
    })),
  }));
  const legacy = (detail?.generations || [])
    .filter((generation) => !claimed.has(String(generation.id)))
    .sort((left, right) => {
      const leftTime = String(left.createdAt || '');
      const rightTime = String(right.createdAt || '');
      return leftTime.localeCompare(rightTime) || String(left.id).localeCompare(String(right.id));
    })
    .map((generation) => ({
      id: `legacy-${generation.id}`,
      sequence: 0,
      prompt: generation.input?.userMessage || generation.input?.customPrompt || '历史出图',
      referenceAssetIds: [],
      modelProfileId: '',
      parameterSnapshot: { aspectRatio: '1:1' },
      requestedCount: 1,
      status: generation.status === 'succeeded'
        ? 'succeeded'
        : generation.status === 'failed'
          ? 'failed'
          : 'processing',
      creditsEstimate: 0,
      createdAt: generation.createdAt,
      generations: [{
        id: generation.id,
        status: generation.status,
        imageUrl: generation.imageUrl || generation.output?.imageUrl,
        published: Boolean(generation.published),
        error: generation.errorMessage || undefined,
        retryCount: 0,
        createdAt: generation.createdAt,
      }],
    }));
  return [
    ...legacy.map((batch, index) => ({ ...batch, sequence: index + 1 })),
    ...patchedReal.map((batch, index) => ({ ...batch, sequence: legacy.length + index + 1 })),
  ];
}

function decorateGenerationView(generation, batchStatus, index, batchId) {
  if (!generation) {
    const failed = batchStatus === 'failed';
    return {
      id: `pending-${batchId}-${index}`,
      placeholder: true,
      status: failed ? 'failed' : 'processing',
      statusLabel: failed ? '生成失败' : '生成中',
      statusClass: failed ? 'failed' : 'processing',
      imageUrl: '',
      published: false,
      showPublishedBadge: false,
    };
  }
  const statusClass = generation.status === 'succeeded'
    ? 'succeeded'
    : generation.status === 'failed'
      ? 'failed'
      : 'processing';
  return {
    ...generation,
    statusClass,
    statusLabel: generationStatusLabel(generation.status, batchStatus),
    showPublishedBadge: Boolean(generation.published),
  };
}

function decorateBatchView(batch) {
  const generationCount = batch.generations ? batch.generations.length : 0;
  const slotCount = Math.max(generationCount, Number(batch.requestedCount || 1), 1);
  const generations = Array.from({ length: slotCount }, (_, index) => decorateGenerationView(
    batch.generations && batch.generations[index] ? batch.generations[index] : null,
    batch.status,
    index,
    batch.id,
  ));
  const hasProcessing = batch.status === 'pending'
    || batch.status === 'processing'
    || generations.some((item) => item.statusClass === 'processing');
  return {
    ...batch,
    promptSummary: summarizePrompt(batch.prompt),
    timeLabel: formatBatchTime(batch.createdAt),
    statusLabel: batchStatusLabel(batch.status),
    isLegacy: String(batch.id).startsWith('legacy-'),
    generations,
    hasProcessing,
  };
}

function buildLeadSummary(lead, workflow) {
  const sourceFloorPlan = workflow?.sourceFloorPlan || {};
  const communityName = lead?.communityName || '';
  const leadName = lead?.name || '客户';
  const floorPlanName = sourceFloorPlan.name || workflow?.sourceFloorPlanName || '正式户型';
  return {
    leadName,
    communityName,
    floorPlanName,
    projectTitle: communityName || leadName,
    projectSubtitle: communityName ? leadName : floorPlanName,
  };
}

function buildStudioView(detail, task) {
  const workflow = detail?.workflow || {};
  const lead = detail?.lead || {};
  const publishedCount = Number(
    workflow.publishedCount ?? detail?.publishedScheme?.generationIds?.length ?? 0,
  );
  const batches = buildConversationBatches(detail, task).map(decorateBatchView);
  const leadSummary = buildLeadSummary(lead, workflow);
  return {
    workflow: {
      id: String(workflow.id || ''),
      title: workflow.title || 'AI 设计方案',
      generationCount: Number(workflow.generationCount || detail?.generations?.length || 0),
      publishedCount,
      floorPlanPreviewUrl: workflow.floorPlanPreviewUrl || '',
    },
    leadSummary,
    publishedScheme: detail?.publishedScheme || null,
    batches,
    hasBatches: batches.length > 0,
    shouldPoll: batches.some((batch) => batch.hasProcessing),
  };
}

function shouldPollStudioView(view) {
  return Boolean(view && view.shouldPoll);
}

function collectSucceededGenerations(view) {
  const items = [];
  (view?.batches || []).forEach((batch, batchIndex) => {
    (batch.generations || []).forEach((generation, generationIndex) => {
      if (generation.placeholder || generation.statusClass !== 'succeeded' || !generation.id) return;
      items.push({
        ...generation,
        batchIndex,
        generationIndex,
        batchId: batch.id,
        isLegacy: Boolean(batch.isLegacy),
      });
    });
  });
  return items;
}

function buildDefaultSendSelection(view) {
  return collectSucceededGenerations(view)
    .filter((generation) => !generation.published && !generation.showPublishedBadge)
    .map((generation) => String(generation.id));
}

function mergeSendSelection(previousView, nextView, currentIds) {
  const previousIds = new Set(collectSucceededGenerations(previousView).map((item) => String(item.id)));
  const nextGenerations = collectSucceededGenerations(nextView);
  const nextIdSet = new Set(nextGenerations.map((item) => String(item.id)));
  const nextUnpublished = nextGenerations
    .filter((item) => !item.published && !item.showPublishedBadge)
    .map((item) => String(item.id));
  const kept = (currentIds || []).filter((id) => nextIdSet.has(String(id)));
  const brandNew = nextUnpublished.filter((id) => !previousIds.has(id));
  return [...new Set([...kept, ...brandNew])];
}

function toggleGenerationSelection(selectedIds, generationId, checked) {
  const id = String(generationId);
  const current = Array.isArray(selectedIds) ? selectedIds.map(String) : [];
  if (checked) return [...new Set([...current.filter((item) => item !== id), id])];
  return current.filter((item) => item !== id);
}

function findGenerationTarget(view, batchIndex, generationIndex) {
  const batch = view?.batches?.[batchIndex];
  const generation = batch?.generations?.[generationIndex];
  if (!batch || !generation) return null;
  return {
    batch,
    generation,
    batchIndex,
    generationIndex,
    batchId: batch.id,
    generationId: generation.placeholder ? '' : String(generation.id),
    canSelect: generation.statusClass === 'succeeded' && !generation.placeholder && !generation.published,
    canDelete: Boolean(generation.id) && !generation.placeholder,
    canWithdraw: Boolean(generation.published || generation.showPublishedBadge) && Boolean(generation.id),
    canContinue: generation.statusClass === 'succeeded' && Boolean(generation.imageUrl),
    canSave: generation.statusClass === 'succeeded' && Boolean(generation.imageUrl),
  };
}

function canRetryBatch(batch, isLatest) {
  if (!batch || batch.isLegacy || !isLatest) return false;
  return batch.status === 'failed' || batch.status === 'partial';
}

function canRegenerateBatch(batch) {
  return Boolean(batch && !batch.isLegacy);
}

function applySelectionToView(view, selectedIds) {
  if (!view) return view;
  const selectedSet = new Set((selectedIds || []).map(String));
  return {
    ...view,
    batches: (view.batches || []).map((batch) => ({
      ...batch,
      generations: (batch.generations || []).map((generation) => ({
        ...generation,
        sendSelected: generation.statusClass === 'succeeded'
          && !generation.placeholder
          && !generation.published
          && selectedSet.has(String(generation.id)),
      })),
    })),
  };
}

function workflowIdentity(workflow) {
  return String(workflow?.id || workflow?._id || '');
}

function workflowFloorPlanId(workflow) {
  return String(
    workflow?.sourceFloorPlanId
    || workflow?.sourceFloorPlan?.id
    || '',
  );
}

/**
 * Prefer an explicit id, then same-floor-plan workflows with generations,
 * then most recently updated. Used when scheme-studio opens without a
 * workflowId so we reopen Admin-created schemes instead of minting empties.
 */
function pickPreferredStudioWorkflow(workflows, options = {}) {
  const list = Array.isArray(workflows) ? workflows.filter((item) => workflowIdentity(item)) : [];
  if (!list.length) return null;

  const floorPlanId = options.floorPlanId ? String(options.floorPlanId) : '';
  const preferredId = options.preferredWorkflowId ? String(options.preferredWorkflowId) : '';

  let candidates = list;
  if (floorPlanId) {
    const matched = list.filter((item) => workflowFloorPlanId(item) === floorPlanId);
    if (matched.length) candidates = matched;
  }

  if (preferredId) {
    const preferred = candidates.find((item) => workflowIdentity(item) === preferredId)
      || list.find((item) => workflowIdentity(item) === preferredId);
    if (preferred) return preferred;
  }

  return [...candidates].sort((left, right) => {
    const generationDiff = Number(right.generationCount || 0) - Number(left.generationCount || 0);
    if (generationDiff !== 0) return generationDiff;
    const leftTime = String(left.updatedAt || left.createdAt || '');
    const rightTime = String(right.updatedAt || right.createdAt || '');
    return rightTime.localeCompare(leftTime)
      || workflowIdentity(right).localeCompare(workflowIdentity(left));
  })[0] || null;
}

function buildWorkflowSwitcherOptions(workflows, currentWorkflowId) {
  const currentId = currentWorkflowId ? String(currentWorkflowId) : '';
  return (Array.isArray(workflows) ? workflows : [])
    .map((workflow) => {
      const id = workflowIdentity(workflow);
      if (!id) return null;
      const generationCount = Number(workflow.generationCount || 0);
      const publishedCount = Number(workflow.publishedCount || 0);
      const title = String(workflow.title || 'AI 设计方案').trim() || 'AI 设计方案';
      return {
        id,
        title,
        generationCount,
        publishedCount,
        current: id === currentId,
        label: `${title} · ${generationCount} 张${publishedCount ? ` · 已确认 ${publishedCount}` : ''}${id === currentId ? '（当前）' : ''}`,
      };
    })
    .filter(Boolean);
}

function resolveSendTitlePrefill(view) {
  const published = String(view?.publishedScheme?.title || '').trim();
  if (published) return published;
  return String(view?.workflow?.title || '设计方案').trim() || '设计方案';
}

function resolveSendTitle(view, sendTitle) {
  const typed = String(sendTitle || '').trim();
  if (typed) return typed;
  return resolveSendTitlePrefill(view);
}

function shouldRenameWorkflowOnSend(view, title) {
  const nextTitle = String(title || '').trim();
  if (!nextTitle) return false;
  return nextTitle !== String(view?.workflow?.title || '').trim();
}

module.exports = {
  applySelectionToView,
  batchStatusLabel,
  buildConversationBatches,
  buildDefaultSendSelection,
  buildLeadSummary,
  buildStudioView,
  buildWorkflowSwitcherOptions,
  canRegenerateBatch,
  canRetryBatch,
  collectSucceededGenerations,
  decorateBatchView,
  decorateGenerationView,
  findGenerationTarget,
  formatBatchTime,
  generationStatusLabel,
  mergeSendSelection,
  pickPreferredStudioWorkflow,
  resolveSendTitle,
  resolveSendTitlePrefill,
  shouldPollStudioView,
  shouldRenameWorkflowOnSend,
  summarizePrompt,
  toggleGenerationSelection,
  workflowFloorPlanId,
  workflowIdentity,
};
