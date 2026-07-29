const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decorateActions,
  buildWorkbenchActions,
  decorateSummaryCards,
  decorateTodos,
  buildDashboardSlices,
  getFloorPlanRoomCount
} = require('../pages/mine/mine-model.js');

test('Mine floor-plan room count uses closed version-4 survey spaces across floors', () => {
  const layoutData = {
    version: 4,
    measurementMode: 'surveying',
    surveyGraph: {
      kind: 'survey-wall-graph',
      floors: [
        {
          spaces: [
            { id: 'living', closed: true },
            { id: 'draft', closed: false }
          ]
        },
        {
          spaces: [
            { id: 'bedroom', closed: true },
            { id: 'bathroom', closed: true }
          ]
        }
      ]
    }
  };

  assert.equal(getFloorPlanRoomCount(layoutData), 3);
  assert.equal(getFloorPlanRoomCount(JSON.stringify(layoutData)), 3);
  assert.equal(getFloorPlanRoomCount({ rooms: [{ id: 'legacy' }] }), 0);
  assert.equal(getFloorPlanRoomCount('{invalid'), 0);
});

test('Mine dashboard exposes all summary cards and the first two decorated todos', () => {
  const cards = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  const todos = [
    { recordId: '1', dueLabel: '今天 10:00' },
    { recordId: '2', dueLabel: '明天 14:30' },
    { recordId: '3', dueLabel: '2026/07/31 09:00' }
  ];

  assert.deepEqual(buildDashboardSlices(cards, todos), {
    primaryTodo: todos[0],
    remainingTodos: todos.slice(1),
    summaryCards: decorateSummaryCards(cards),
    displayTodos: decorateTodos(todos).slice(0, 2),
    overviewCards: cards.slice(3)
  });
});

test('Mine todo decoration derives compact time labels and alternates local thumbnails', () => {
  assert.deepEqual(decorateTodos([
    { recordId: '1', dueLabel: '今天 10:00' },
    { recordId: '2', dueLabel: '2026/07/31 09:00' }
  ]), [
    {
      recordId: '1',
      dueLabel: '今天 10:00',
      dayLabel: '今天',
      timeLabel: '10:00',
      thumbnail: '/images/mine-v6/todo-room-1.jpg'
    },
    {
      recordId: '2',
      dueLabel: '2026/07/31 09:00',
      dayLabel: '07-31',
      timeLabel: '09:00',
      thumbnail: '/images/mine-v6/todo-room-2.jpg'
    }
  ]);
});

test('Mine quick actions receive semantic art and stable fallback accents', () => {
  const actions = Array.from({ length: 5 }, (_, index) => ({ key: String(index) }));
  assert.deepEqual(
    decorateActions(actions).map((item) => item.toneClass),
    ['tone-green', 'tone-blue', 'tone-purple', 'tone-green', 'tone-green']
  );

  assert.deepEqual(
    decorateActions([
      { key: 'customers', target: 'leads', icon: 'users' },
      { key: 'measure', target: 'measure', icon: 'wallet' }
    ]).map(({ toneClass, iconPath }) => ({ toneClass, iconPath })),
    [
      {
        toneClass: 'tone-blue',
        iconPath: '/images/mine-v6/tool-leads.jpg'
      },
      {
        toneClass: 'tone-green',
        iconPath: '/images/mine-v6/tool-measure.jpg'
      }
    ]
  );
});

test('Mine workbench places the real AI action in the reference third position', () => {
  const actions = [
    { key: 'first', label: '第一项', icon: 'home', target: 'createPromotion' },
    { key: 'second', label: '第二项', icon: 'users', target: 'leads' },
    { key: 'third', label: '第三项', icon: 'wallet', target: 'commissions' }
  ];

  const workbenchActions = buildWorkbenchActions(actions);

  assert.deepEqual(workbenchActions.map((item) => item.key), [
    'first',
    'second',
    'ai-design',
    'third'
  ]);
  assert.equal(workbenchActions[2].target, 'aiDesign');
  assert.equal(workbenchActions[2].iconPath, '/images/mine-v6/tool-ai.jpg');
});
