const ACTION_TONES = ['tone-green', 'tone-blue', 'tone-yellow', 'tone-pink'];

function decorateActions(actions) {
  return (actions || []).map((item, index) => ({
    ...item,
    toneClass: ACTION_TONES[index % ACTION_TONES.length]
  }));
}

function buildDashboardSlices(workbenchCards, todos) {
  const safeCards = workbenchCards || [];
  const safeTodos = todos || [];

  return {
    primaryTodo: safeTodos[0] || null,
    remainingTodos: safeTodos.slice(1),
    focusCards: safeCards.slice(0, 2),
    overviewCards: safeCards.slice(2)
  };
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
  buildDashboardSlices,
  getFloorPlanRoomCount
};
