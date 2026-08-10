const test = require('node:test');
const assert = require('node:assert/strict');
const { groupFlatSources } = require('../utils/aiDesignService.js');

test('legacy flat room sources group into one selectable floor plan', () => {
  const plans = groupFlatSources([
    { floorPlanId: 'plan-1', floorPlanName: '张宅', leadId: 'lead-1', leadName: '张先生', roomId: 'living', roomName: '客厅', roomSize: '4.00 × 3.00 m', openingCount: 2 },
    { floorPlanId: 'plan-1', floorPlanName: '张宅', leadId: 'lead-1', leadName: '张先生', roomId: 'bedroom', roomName: '卧室', roomSize: '3.00 × 3.00 m', openingCount: 1 },
  ]);

  assert.equal(plans.length, 1);
  assert.equal(plans[0].closedRoomCount, 2);
  assert.equal(plans[0].projectTitle, '张先生');
  assert.equal(plans[0].projectSubtitle, '张先生');
  assert.deepEqual(plans[0].rooms.map((room) => room.roomId), ['living', 'bedroom']);
});
