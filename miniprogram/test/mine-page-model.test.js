const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decorateActions,
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

test('Mine dashboard promotes only the first todo and first two workbench cards', () => {
  const cards = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  const todos = [{ recordId: '1' }, { recordId: '2' }, { recordId: '3' }];

  assert.deepEqual(buildDashboardSlices(cards, todos), {
    primaryTodo: todos[0],
    remainingTodos: todos.slice(1),
    focusCards: cards.slice(0, 2),
    overviewCards: cards.slice(2)
  });
});

test('Mine quick actions receive a stable repeating accent sequence', () => {
  const actions = Array.from({ length: 5 }, (_, index) => ({ key: String(index) }));
  assert.deepEqual(
    decorateActions(actions).map((item) => item.toneClass),
    ['tone-green', 'tone-blue', 'tone-yellow', 'tone-pink', 'tone-green']
  );
});
