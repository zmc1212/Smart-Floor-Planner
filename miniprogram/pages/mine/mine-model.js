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

function buildWorkbenchActions(actions) {
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

  return [...decorated.slice(0, 2), aiAction, ...decorated.slice(2)];
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
  decorateActions,
  buildWorkbenchActions,
  decorateSummaryCards,
  decorateTodos,
  buildDashboardSlices,
  getFloorPlanRoomCount
};
