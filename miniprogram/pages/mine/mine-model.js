const ACTION_TONES = ['tone-green', 'tone-blue', 'tone-purple', 'tone-green'];
const SUMMARY_ART = [
  '/images/mine-v6/stat-followup.png',
  '/images/mine-v6/stat-progress.png',
  '/images/mine-v6/stat-complete.png'
];

const ACTION_PRESENTATION = {
  leads: {
    toneClass: 'tone-blue',
    iconPath: '/images/mine-v6/tool-leads.jpg'
  },
  measure: {
    toneClass: 'tone-green',
    iconPath: '/images/mine-v6/tool-measure.jpg'
  },
  inspiration: {
    toneClass: 'tone-purple',
    iconPath: '/images/mine-v6/tool-floorplan.jpg'
  }
};

const ROLE_LABELS = {
  customer: '个人用户',
  referrer: '推广人',
  designer: '家装设计顾问',
  measurer: '家装现场顾问',
  salesperson: '渠道地推',
  enterprise_admin: '企业负责人',
  platform_admin: '平台管理员',
  admin: '平台管理员',
  super_admin: '平台管理员'
};

function canShowPlatformRegistrationCode(role, bootstrap) {
  if (role !== 'platform_admin') return false;
  const capabilities = (bootstrap && bootstrap.current && bootstrap.current.capabilities) || [];
  return !capabilities.length || capabilities.includes('platform.review');
}

function profileForIdentity(userInfo, role) {
  const info = userInfo || {};
  const activeRole = role || info.staffRole || (info.mode === 'referrer' ? 'referrer' : 'customer');
  return {
    name: info.nickname || info.name || '微信用户',
    avatar: info.avatar || info.avatarUrl || '',
    enterpriseName: info.enterpriseName || info.communityName || '',
    phoneMasked: info.phoneMasked || '',
    role: activeRole,
    roleLabel: ROLE_LABELS[activeRole] || '个人用户'
  };
}

function decorateActions(actions) {
  return (actions || []).map((item, index) => {
    const presentation =
      ACTION_PRESENTATION[item.target] ||
      (item.icon === 'users' ? ACTION_PRESENTATION.leads : null);

    return {
      ...item,
      toneClass: presentation
        ? presentation.toneClass
        : ACTION_TONES[index % ACTION_TONES.length],
      iconPath: presentation
        ? presentation.iconPath
        : `/images/mine-icons/${item.icon}.png`
    };
  });
}

function buildWorkbenchActions(actions, includeAIDesign = true) {
  const decorated = decorateActions(actions);
  const aiAction = {
    key: 'ai-design',
    label: 'AI 设计',
    sublabel: '智能设计创作',
    icon: 'bulb',
    iconPath: '/images/mine-v6/tool-ai.jpg',
    target: 'aiDesign',
    toneClass: 'tone-orange'
  };

  return includeAIDesign
    ? [...decorated.slice(0, 2), aiAction, ...decorated.slice(2)]
    : decorated;
}

function decorateSummaryCards(cards) {
  return (cards || []).map((item, index) => ({
    ...item,
    illustration: SUMMARY_ART[Math.min(index, SUMMARY_ART.length - 1)]
  }));
}

function buildDashboardSlices(workbenchCards, todos) {
  const safeCards = workbenchCards || [];
  const safeTodos = todos || [];

  return {
    primaryTodo: safeTodos[0] || null,
    remainingTodos: safeTodos.slice(1),
    summaryCards: decorateSummaryCards(safeCards),
    displayTodos: decorateTodos(safeTodos).slice(0, 2),
    overviewCards: safeCards.slice(3)
  };
}

function decorateTodos(todos) {
  return (todos || []).map((item, index) => {
    const dueLabel = String(item.dueLabel || '近期');
    const parts = dueLabel.split(/\s+/).filter(Boolean);
    const relativeDay = parts[0] === '今天' || parts[0] === '明天';
    const absoluteDate = dueLabel.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/);

    let dayLabel = '近期';
    let timeLabel = dueLabel;
    if (relativeDay) {
      dayLabel = parts[0];
      timeLabel = parts.slice(1).join(' ') || '待安排';
    } else if (absoluteDate) {
      dayLabel = `${String(absoluteDate[2]).padStart(2, '0')}-${String(absoluteDate[3]).padStart(2, '0')}`;
      timeLabel = absoluteDate[4] || '待安排';
    }

    return {
      ...item,
      dayLabel,
      timeLabel,
      thumbnail: `/images/mine-v6/todo-room-${(index % 2) + 1}.jpg`
    };
  });
}

function getFloorPlanRoomCount(layoutData) {
  if (!layoutData) return 0;
  try {
    const layout = typeof layoutData === 'string' ? JSON.parse(layoutData) : layoutData;
    const floors = layout && layout.surveyGraph && Array.isArray(layout.surveyGraph.floors)
      ? layout.surveyGraph.floors
      : [];
    return floors.reduce(
      (count, floor) =>
        count +
        (Array.isArray(floor.spaces)
          ? floor.spaces.filter((space) => space && space.closed).length
          : 0),
      0
    );
  } catch (e) {
    return 0;
  }
}

module.exports = {
  profileForIdentity,
  canShowPlatformRegistrationCode,
  decorateActions,
  buildWorkbenchActions,
  decorateSummaryCards,
  decorateTodos,
  buildDashboardSlices,
  getFloorPlanRoomCount
};
