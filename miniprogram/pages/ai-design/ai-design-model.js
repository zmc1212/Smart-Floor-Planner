const STAGE_DEFINITIONS = [
  { key: 'concept', label: '初步构想' },
  { key: 'space', label: '空间表达' },
  { key: 'style', label: '风格定向' },
  { key: 'furnishing', label: '软装完善' },
];

const MODE_COPY = {
  reference_recreate: {
    title: '从灵感开始',
    description: '把喜欢的参考图带进真实空间',
  },
  style_transform: {
    title: '试一种新风格',
    description: '保留空间结构，探索新的材质与色彩',
  },
  floor_plan_render: {
    title: '生成 3D 户型导览图',
    description: '根据正式量房墙图生成全屋 3D 剖切模型',
  },
  soft_furnishing: {
    title: '继续软装完善',
    description: '保留硬装，优化家具、灯具与陈设',
  },
};

const SCENE_FOCUS = {
  reference_recreate: 'scene-focus-inspiration',
  style_transform: 'scene-focus-style',
  floor_plan_render: 'scene-focus-floor-plan',
  soft_furnishing: 'scene-focus-furnishing',
};

const ACTIVE_TASK_STATUSES = ['created', 'pending', 'processing'];

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
  return {
    ...plan,
    navigationPreview: {
      ...navigationPreview,
      task: decorateTask(navigationPreview.task),
      readyTask: decorateTask(navigationPreview.readyTask),
    },
    navigatorView: decorateNavigator(plan && plan.navigator),
  };
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
  const action = modeAction(workflows, mode, {
    buttonLabel: mode === 'floor_plan_render' ? '选择真实户型' : '进入这个方向',
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
    reference_recreate: '看灵感',
    style_transform: '试风格',
    floor_plan_render: '生成全屋',
    soft_furnishing: '做软装',
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
  normalizeProgress,
  normalizeCredits,
  decorateRecentResult,
  hasActiveTasks,
  decorateNavigator,
  decorateSourcePlan,
  buildStageRail,
  buildPrimaryAction,
  buildSecondaryActions,
  buildSceneNavigation,
  buildExperienceState,
};
