const STAGE_DEFINITIONS = [
  { key: 'baseline', label: '空间基准' },
  { key: 'style', label: '风格方案' },
  { key: 'furnishing', label: '软装完善' },
  { key: 'handoff', label: '提案深化' },
];

const MODE_COPY = {
  reference_recreate: {
    title: '参考图复刻',
    description: '把喜欢的参考图带进真实空间',
  },
  style_transform: {
    title: '拍照换风格',
    description: '上传当前空间照片，保留结构探索新的材质与色彩',
  },
  floor_plan_render: {
    title: '户型生成',
    description: '根据正式量房墙图生成全屋 3D 剖切模型',
  },
  soft_furnishing: {
    title: '软装搭配',
    description: '上传现场图或已有成果，保留硬装并优化家具、灯具与陈设',
  },
};

const SCENE_FOCUS = {
  reference_recreate: 'scene-focus-inspiration',
  style_transform: 'scene-focus-style',
  floor_plan_render: 'scene-focus-floor-plan',
  soft_furnishing: 'scene-focus-furnishing',
};

const ACTIVE_TASK_STATUSES = ['created', 'pending', 'processing'];
const PROJECT_GROUP_DEFINITIONS = [
  { key: 'in_progress', label: '进行中' },
  { key: 'ready', label: '可开始' },
  { key: 'needs_survey', label: '待完善量房' },
];

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeProgress(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function normalizeCredits(value, fallback = 10) {
  if (value === null || value === undefined || value === '') return fallback;
  const credits = Number(value);
  return Number.isFinite(credits) && credits >= 0 ? credits : fallback;
}

function decorateTask(task) {
  if (!task) return task;
  return {
    ...task,
    progress: normalizeProgress(task.progress),
  };
}

function decorateRecentResult(result) {
  const status = result && result.status;
  const progress = normalizeProgress(result && result.progress);
  const isProcessing = ACTIVE_TASK_STATUSES.includes(status);
  const statusLabel = status === 'succeeded'
    ? '已完成'
    : status === 'failed'
      ? '生成失败'
      : status === 'cancelled'
        ? '已取消'
        : `生成中 ${progress}%`;

  return {
    ...(result || {}),
    progress,
    isProcessing,
    displayImageUrl: result && (
      result.resultImageUrl
      || result.spaceImageUrl
      || result.controlImageUrl
      || ''
    ),
    statusClass: isProcessing
      ? 'processing'
      : status === 'failed'
        ? 'failed'
        : status === 'cancelled'
          ? 'cancelled'
          : 'succeeded',
    statusLabel,
  };
}

function buildHeroSlides(recent, selectedSource) {
  // A carousel belongs to an explicitly selected customer plan. Never surface
  // another lead's result merely because the current employee generated it.
  if (!selectedSource || !selectedSource.floorPlanId) return [];

  const slides = [];
  const seen = new Set();
  const selectedFloorPlanId = selectedSource && selectedSource.floorPlanId;
  const selectedPlanUpdatedAt = Date.parse(selectedSource.updatedAt || '');
  const addSlide = (task, overrides = {}) => {
    const imageUrl = overrides.imageUrl || (task && task.resultImageUrl);
    const id = overrides.id || (task && task.id);
    if (!imageUrl || !id || seen.has(id)) return;
    seen.add(id);
    slides.push({
      id,
      imageUrl,
      title: overrides.title || (task && task.targetLabel) || 'AI 户型导览图',
      meta: overrides.meta || '轻触查看设计成果',
    });
  };

  (recent || []).forEach((result) => {
    if (result.status !== 'succeeded' || result.mode !== 'floor_plan_render') return;
    if (result.floorPlanId !== selectedFloorPlanId || result.targetScope !== 'whole_floor_plan') return;
    const createdAt = Date.parse(result.createdAt || '');
    if (Number.isFinite(selectedPlanUpdatedAt) && Number.isFinite(createdAt) && createdAt < selectedPlanUpdatedAt) return;
    addSlide(result, { title: result.targetLabel || 'AI 户型导览图' });
  });

  return slides.slice(0, 5);
}

function hasActiveTasks(results) {
  return (results || []).some((item) => (
    item && (item.isProcessing || ACTIVE_TASK_STATUSES.includes(item.status))
  ));
}

function decorateNavigator(navigator) {
  if (!navigator || !Array.isArray(navigator.walls)) {
    return { aspectRatio: 1, walls: [], rooms: [] };
  }

  return {
    aspectRatio: Number(navigator.aspectRatio || 1),
    walls: navigator.walls.map((wall, index) => ({
      ...wall,
      id: wall.id || `wall-${index}`,
      style: [
        `left:${round(wall.left)}%`,
        `top:${round(wall.top)}%`,
        `width:${round(wall.width)}%`,
        `transform:rotate(${round(wall.angle)}deg)`,
      ].join(';'),
    })),
    rooms: (navigator.rooms || []).map((room, index) => {
      const polygon = (room.polygon || [])
        .map((point) => `${round(point.x)}% ${round(point.y)}%`)
        .join(',');
      return {
        ...room,
        id: room.id || `room-${index}`,
        name: room.name || `空间 ${index + 1}`,
        fillStyle: [
          `left:${round(room.left)}%`,
          `top:${round(room.top)}%`,
          `width:${round(room.width)}%`,
          `height:${round(room.height)}%`,
          polygon ? `clip-path:polygon(${polygon})` : '',
        ].filter(Boolean).join(';'),
        labelStyle: `left:${round(room.centerX)}%;top:${round(room.centerY)}%`,
      };
    }),
  };
}

function decorateSourcePlan(plan) {
  const navigationPreview = (plan && plan.navigationPreview) || { state: 'missing' };
  const eligibility = (plan && plan.eligibility) || { eligible: true };
  const projectGroup = (plan && plan.projectGroup)
    || (eligibility.eligible ? 'ready' : 'needs_survey');
  const uiState = (plan && plan.uiState)
    || (projectGroup === 'ready' ? 'ready' : 'needs_survey');
  return {
    ...plan,
    projectTitle: plan.projectTitle || plan.communityName || plan.leadName || plan.floorPlanName || '正式户型',
    projectSubtitle: plan.projectSubtitle || plan.leadName || '量房记录',
    eligibility,
    projectGroup,
    uiState,
    statusLabel: plan.statusLabel
      || eligibility.reasonLabel
      || (uiState === 'ready' ? '正式量房已就绪' : '量房信息待完善'),
    actionLabel: plan.actionLabel
      || (uiState === 'needs_survey' ? '继续量房' : '开始设计'),
    statusClass: uiState.replace('_', '-'),
    navigationPreview: {
      ...navigationPreview,
      task: decorateTask(navigationPreview.task),
      readyTask: decorateTask(navigationPreview.readyTask),
    },
    navigatorView: decorateNavigator(plan && plan.navigator),
  };
}

function buildProjectPickerView(projects, activeGroup = 'in_progress', search = '') {
  const query = String(search || '').trim().toLocaleLowerCase();
  const groups = PROJECT_GROUP_DEFINITIONS.map((definition) => ({
    ...definition,
    count: (projects || []).filter((item) => item.projectGroup === definition.key).length,
    active: definition.key === activeGroup,
  }));
  const filteredProjects = (projects || []).filter((item) => {
    if (item.projectGroup !== activeGroup) return false;
    if (!query) return true;
    return [item.projectTitle, item.projectSubtitle, item.leadName, item.communityName, item.floorPlanName]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
  const emptyCopy = query
    ? '没有找到匹配的客户设计项目'
    : activeGroup === 'in_progress'
      ? '当前没有进行中的设计项目'
      : activeGroup === 'ready'
        ? '当前没有可开始设计的正式量房'
        : '当前没有待完善的量房项目';
  return { projectGroups: groups, filteredProjects, projectEmptyCopy: emptyCopy };
}

function chooseDefaultProjectGroup(projects, selectedFloorPlanId) {
  const selected = (projects || []).find((item) => item.floorPlanId === selectedFloorPlanId);
  if (selected) return selected.projectGroup;
  if ((projects || []).some((item) => item.projectGroup === 'in_progress')) return 'in_progress';
  if ((projects || []).some((item) => item.projectGroup === 'ready')) return 'ready';
  return 'needs_survey';
}

function resolveStageIndex(workflow) {
  if (!workflow) return 0;
  if (['proposal_pack', 'lighting', 'tour_board', 'premium_board', 'cad_detail'].includes(workflow.currentStageKey)) return 3;
  if (workflow.currentStageKey === 'soft_furnishing') return 2;
  if (['base_render', 'perspective_upgrade'].includes(workflow.currentStageKey)) return 1;
  return 0;
}

function buildStageRail(workflow) {
  const currentIndex = resolveStageIndex(workflow);
  return STAGE_DEFINITIONS.map((stage, index) => ({
    ...stage,
    status: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

function findWorkflowMode(workflows, mode) {
  return (workflows || []).find((item) => item.key === mode);
}

function modeAction(workflows, mode, overrides = {}) {
  const workflow = findWorkflowMode(workflows, mode) || {};
  const copy = MODE_COPY[mode] || MODE_COPY.reference_recreate;
  return {
    actionType: 'mode',
    mode,
    title: overrides.title || copy.title,
    description: overrides.description || copy.description,
    buttonLabel: overrides.buttonLabel || '开始探索',
    credits: normalizeCredits(workflow.credits),
    enabled: workflow.enabled !== false,
    targetScope: overrides.targetScope || '',
    sourceResultTaskId: overrides.sourceResultTaskId || '',
  };
}

function buildSceneNavigation(workflows, mode = 'reference_recreate') {
  const buttonLabels = {
    reference_recreate: '上传参考图',
    style_transform: '拍照开始',
    floor_plan_render: '选择户型',
    soft_furnishing: '上传空间图',
  };
  const action = modeAction(workflows, mode, {
    buttonLabel: buttonLabels[mode] || '开始设计',
  });
  return {
    ...action,
    focusClass: SCENE_FOCUS[mode] || SCENE_FOCUS.reference_recreate,
  };
}

function buildPrimaryAction({ workflows, selectedSource, selectedWorkflow }) {
  if (!selectedSource) {
    return modeAction(workflows, 'reference_recreate', {
      buttonLabel: '开始探索',
    });
  }

  const preview = selectedSource.navigationPreview || {};
  const targetContext = selectedWorkflow && selectedWorkflow.targetContext;
  const targetLabel = selectedSource.targetLabel || '当前空间';
  const projectTask = selectedSource.latestGeneration;

  if (selectedSource.uiState === 'generating' && projectTask) {
    return {
      actionType: 'result',
      taskId: projectTask.id,
      title: `${targetLabel}正在生成`,
      description: `已完成 ${Number(projectTask.progress || 0)}%，切换项目不会取消后台任务`,
      buttonLabel: '查看生成进度',
      credits: 0,
      enabled: true,
    };
  }
  if (selectedSource.uiState === 'retry' && projectTask) {
    return {
      actionType: 'result',
      taskId: projectTask.id,
      title: '上次生成没有完成',
      description: projectTask.error || '打开任务查看失败原因并决定是否重试',
      buttonLabel: '进入处理',
      credits: 0,
      enabled: true,
    };
  }
  if (selectedSource.uiState === 'stale') {
    return modeAction(workflows, 'floor_plan_render', {
      title: '量房已更新，重建空间基准',
      description: '旧成果会保留，但不会继续作为当前正式户型的设计基准',
      buttonLabel: '重建基准',
      targetScope: selectedSource.targetScope || 'whole_floor_plan',
    });
  }
  if (selectedSource.uiState === 'continue' && projectTask && projectTask.status === 'succeeded') {
    const nextStageKey = projectTask.nextStageKey
      || (selectedSource.activeWorkflow && selectedSource.activeWorkflow.currentStageKey);
    const nextMode = nextStageKey === 'soft_furnishing'
      ? 'soft_furnishing'
      : nextStageKey === 'base_render'
        ? 'style_transform'
        : '';
    if (nextMode) {
      return modeAction(workflows, nextMode, {
        title: nextMode === 'soft_furnishing' ? '继续深化当前软装' : '继续完善当前风格方案',
        description: '沿用当前项目的最近成功成果继续设计',
        buttonLabel: '继续设计',
        sourceResultTaskId: projectTask.id,
      });
    }
  }

  if (targetContext && targetContext.activeTask) {
    return {
      actionType: 'result',
      taskId: targetContext.activeTask.id,
      title: `${targetLabel}正在生成`,
      description: `已完成 ${Number(targetContext.activeTask.progress || 0)}%，完成后可继续当前空间设计`,
      buttonLabel: '查看生成进度',
      credits: 0,
      enabled: true,
    };
  }
  if (targetContext && targetContext.busyByOther) {
    return {
      actionType: 'busy',
      title: `${targetLabel}正在由其他成员生成`,
      description: '生成完成后即可继续当前空间设计',
      buttonLabel: '生成中',
      credits: 0,
      enabled: false,
    };
  }
  if (targetContext && targetContext.status === 'ready' && targetContext.sourceTask
    && targetContext.recommendedMiniMode) {
    const mode = targetContext.recommendedMiniMode;
    return modeAction(workflows, mode, {
      title: mode === 'style_transform'
        ? `为${targetLabel}试一种新风格`
        : `继续完善${targetLabel}软装`,
      description: mode === 'style_transform'
        ? '使用当前房间方案基准图探索新的材质、家具与氛围'
        : '沿用当前房间成果继续优化家具、灯具与陈设',
      buttonLabel: '继续设计',
      sourceResultTaskId: targetContext.sourceTask.id,
    });
  }
  if (targetContext && targetContext.status === 'admin_handoff') {
    return {
      actionType: targetContext.sourceTask && targetContext.sourceTask.ownedByCurrentOperator ? 'result' : 'handoff',
      taskId: targetContext.sourceTask && targetContext.sourceTask.id,
      title: `${targetLabel}已完成当前小程序阶段`,
      description: '后续提案与灯光深化请在后台 AI 设计工作台继续',
      buttonLabel: targetContext.sourceTask && targetContext.sourceTask.ownedByCurrentOperator ? '查看当前成果' : '后台继续',
      credits: 0,
      enabled: true,
    };
  }
  if (targetContext && ['missing', 'stale'].includes(targetContext.status)) {
    return modeAction(workflows, 'floor_plan_render', {
      title: targetContext.status === 'stale' ? `重新生成${targetLabel}概念图` : `生成${targetLabel}概念图`,
      description: targetContext.status === 'stale'
        ? '户型已更新，旧成果不会继续作为当前空间基准'
        : `先根据正式量房数据建立${targetLabel}的可续接设计基准`,
      buttonLabel: '生成概念图',
      targetScope: selectedSource.targetScope,
    });
  }

  if (selectedSource.targetScope === 'single_room') {
    return modeAction(workflows, 'floor_plan_render', {
      title: `生成${targetLabel}概念图`,
      description: `先根据正式量房数据建立${targetLabel}的可续接设计基准`,
      buttonLabel: '生成概念图',
      targetScope: 'single_room',
    });
  }

  if (preview.state === 'processing' && preview.task) {
    return {
      actionType: 'result',
      taskId: preview.task.id,
      title: '3D 户型导览图正在生成',
      description: `已完成 ${Number(preview.task.progress || 0)}%，完成后自动出现在这里`,
      buttonLabel: '查看生成进度',
      credits: 0,
      enabled: true,
    };
  }
  if (preview.state !== 'ready') {
    return modeAction(workflows, 'floor_plan_render', {
      title: preview.state === 'stale' ? '重新生成 3D 户型导览图' : '生成 3D 户型导览图',
      description: preview.state === 'stale'
        ? '户型已更新，旧导览图不再作为当前户型展示'
        : MODE_COPY.floor_plan_render.description,
      buttonLabel: '生成导览图',
      targetScope: 'whole_floor_plan',
    });
  }
  if (preview.task) {
    return {
      actionType: 'result',
      taskId: preview.task.id,
      title: '3D 户型导览图已就绪',
      description: '从完整户型继续进入风格与软装设计',
      buttonLabel: '查看全屋方案',
      credits: 0,
      enabled: true,
    };
  }

  return modeAction(workflows, 'reference_recreate');
}

function buildSecondaryActions(workflows, primaryAction) {
  const labels = {
    reference_recreate: '参考复刻',
    style_transform: '拍照换风格',
    floor_plan_render: '户型生成',
    soft_furnishing: '软装搭配',
  };
  return (workflows || [])
    .filter((item) => item.key !== primaryAction.mode)
    .map((item) => ({
      ...item,
      shortTitle: labels[item.key] || item.title,
    }));
}

function buildExperienceState(data) {
  const targetStageKey = data.selectedWorkflow
    && data.selectedWorkflow.targetContext
    && data.selectedWorkflow.targetContext.stageKey;
  const stageRail = buildStageRail(targetStageKey
    ? { currentStageKey: targetStageKey }
    : data.selectedWorkflow);
  const primaryAction = buildPrimaryAction(data);
  return {
    stageRail,
    primaryAction,
    secondaryActions: buildSecondaryActions(data.workflows, primaryAction),
    sceneNavigation: buildSceneNavigation(data.workflows, data.activeSceneMode),
  };
}

module.exports = {
  STAGE_DEFINITIONS,
  MODE_COPY,
  ACTIVE_TASK_STATUSES,
  PROJECT_GROUP_DEFINITIONS,
  normalizeProgress,
  normalizeCredits,
  decorateRecentResult,
  buildHeroSlides,
  hasActiveTasks,
  decorateNavigator,
  decorateSourcePlan,
  buildProjectPickerView,
  chooseDefaultProjectGroup,
  buildStageRail,
  buildPrimaryAction,
  buildSecondaryActions,
  buildSceneNavigation,
  buildExperienceState,
};
