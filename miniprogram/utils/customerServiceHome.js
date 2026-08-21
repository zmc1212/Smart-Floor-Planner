const URGENCY = {
  appointment_expired: 0,
  awaiting_rebooking: 1,
  appointment_in_progress: 2,
  appointment_confirmed: 3,
  survey_completed: 4,
  design_published: 5,
  measurer_assigned: 6,
  assignment_pending: 7,
  claimed: 8,
  converted: 9,
  closed: 10,
};

const PROGRESS_PILL_LABELS = {
  match: '匹配',
  book: '预约',
  survey: '量房',
  scheme: '方案',
};

const STAGE_INSET_HELPER = {
  // Pending match: CTA is「等待派单」— helper must not repeat that label.
  claimed: '匹配完成后可预约上门',
  assignment_pending: '匹配完成后可预约上门',
  measurer_assigned: '引导预约',
  appointment_confirmed: '日程提醒',
  appointment_expired: '协助重约',
  awaiting_rebooking: '协助重约',
  appointment_in_progress: '测量进行中',
  survey_completed: '展示户型',
  design_published: '成果交付',
  converted: '成果交付',
  closed: '说明已结束',
};

const STAGE_INSET_TITLES = {
  claimed: '服务匹配中',
  assignment_pending: '服务匹配中',
  measurer_assigned: '待预约上门量房',
  appointment_confirmed: '已预约上门量房',
  appointment_in_progress: '上门量房进行中',
  appointment_expired: '需重新预约量房',
  awaiting_rebooking: '需重新预约量房',
  survey_completed: '量房完成 · 可进服务档案',
  design_published: '方案已发布 · 我的服务档案',
  converted: '方案已发布 · 我的服务档案',
  closed: '服务已结束',
};

const KIND_LABELS = {
  book: '预约上门',
  rebook: '重新预约',
  reschedule: '改期',
  wait_designer: '等待派单',
  view_project: '我的服务档案',
  none: '我的服务档案',
};

const SECONDARY_CTA_KINDS = new Set(['book', 'rebook', 'reschedule', 'wait_designer']);

function rankCustomerProjects(projects) {
  return [...(projects || [])].sort(
    (left, right) => (URGENCY[left.serviceStage] ?? 20) - (URGENCY[right.serviceStage] ?? 20)
  );
}

function resolvePrimaryLabel(project) {
  const kind = project.nextActionKind;
  if (project.nextActionLabel && String(project.nextActionLabel).trim()) {
    return String(project.nextActionLabel).trim();
  }
  return KIND_LABELS[kind] ?? '我的服务档案';
}

function resolveMediaMode(project) {
  const hasPlan = Boolean(project.hasFormalFloorPlan);
  const hasScheme = Number(project.publishedDesignCount) > 0;
  if (hasPlan && hasScheme) {
    return 'dual';
  }
  if (hasPlan) {
    return 'floor_plan';
  }
  if (hasScheme) {
    return 'scheme';
  }
  return 'xiao_k';
}

function buildInsetTitle(project) {
  return STAGE_INSET_TITLES[project.serviceStage] || '服务进行中';
}

function resolveInsetHelper(serviceStage, subtitle, primaryLabel) {
  let insetHelper = STAGE_INSET_HELPER[serviceStage] || '';
  // CTA labels stay on the primary button only — never mirror them in the inset.
  if (insetHelper && primaryLabel && insetHelper === primaryLabel) {
    return '';
  }
  if (insetHelper && subtitle && insetHelper === subtitle) {
    const prefixed = `小K陪你推进：${STAGE_INSET_HELPER[serviceStage]}`;
    insetHelper = prefixed !== subtitle ? prefixed : '服务向导小K陪你推进当前阶段';
  }
  return insetHelper;
}

function buildEmptyCompanionState() {
  return {
    subtitle: '',
    insetTitle: '',
    insetHelper: '',
    leadId: null,
    nextActionKind: null,
    primaryCta: null,
    secondaryCta: null,
    showSecondaryCta: false,
    showSwitcher: false,
    switcherCount: 0,
    switcherProjects: [],
    mediaMode: 'xiao_k',
    xiaoKAction: '',
    isEmpty: true,
  };
}

function buildCompanionState({ projects = [], selectedLeadId } = {}) {
  const ranked = rankCustomerProjects(projects);
  if (!ranked.length) {
    return buildEmptyCompanionState();
  }

  const featured = selectedLeadId
    ? ranked.find((project) => project.leadId === selectedLeadId) || ranked[0]
    : ranked[0];

  const primaryKind = featured.nextActionKind || 'none';
  const primaryLabel = resolvePrimaryLabel(featured);
  const subtitle = featured.appointmentSummary || '';
  const insetHelper = resolveInsetHelper(featured.serviceStage, subtitle, primaryLabel);
  const insetTitle = buildInsetTitle(featured);
  const showSecondaryCta = SECONDARY_CTA_KINDS.has(primaryKind);

  return {
    subtitle,
    insetTitle,
    insetHelper,
    leadId: featured.leadId,
    nextActionKind: primaryKind,
    primaryCta: { label: primaryLabel, kind: primaryKind },
    secondaryCta: { label: '我的服务档案', kind: 'view_project' },
    showSecondaryCta,
    showSwitcher: ranked.length > 1,
    switcherCount: Math.max(0, ranked.length - 1),
    switcherProjects: ranked,
    mediaMode: resolveMediaMode(featured),
    xiaoKAction: insetHelper,
    isEmpty: false,
  };
}

function resolveProgressTones(serviceStage) {
  switch (serviceStage) {
    case 'claimed':
    case 'assignment_pending':
      return { match: 'current', book: 'upcoming', survey: 'upcoming', scheme: 'upcoming' };
    case 'measurer_assigned':
      return { match: 'done', book: 'current', survey: 'upcoming', scheme: 'upcoming' };
    case 'appointment_confirmed':
    case 'appointment_in_progress':
    case 'appointment_expired':
    case 'awaiting_rebooking':
      return { match: 'done', book: 'done', survey: 'current', scheme: 'upcoming' };
    case 'survey_completed':
      return { match: 'done', book: 'done', survey: 'done', scheme: 'current' };
    case 'design_published':
    case 'converted':
      return { match: 'done', book: 'done', survey: 'done', scheme: 'done' };
    case 'closed':
      return { match: 'done', book: 'upcoming', survey: 'upcoming', scheme: 'upcoming' };
    default:
      return { match: 'upcoming', book: 'upcoming', survey: 'upcoming', scheme: 'upcoming' };
  }
}

function buildProgressPills(serviceStage) {
  const tones = resolveProgressTones(serviceStage);
  return ['match', 'book', 'survey', 'scheme'].map((key) => ({
    key,
    label: PROGRESS_PILL_LABELS[key],
    tone: tones[key],
  }));
}

module.exports = {
  rankCustomerProjects,
  buildCompanionState,
  buildProgressPills,
  PROGRESS_PILL_LABELS,
};
