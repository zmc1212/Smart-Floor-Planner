import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessMiniProgramFloorPlan } from '@/lib/floor-plan-access';

const plan = {
  creatorId: 11n,
  staffId: 23n,
  enterpriseId: null,
};

test('standalone promoter can open the same staff-scoped formal plan listed on Home', () => {
  assert.equal(
    canAccessMiniProgramFloorPlan(plan, {
      user: { _id: '11' },
      staff: { _id: '23', role: 'salesperson' },
    }),
    true
  );
});

test('standalone promoter cannot open another staff member\'s formal plan', () => {
  assert.equal(
    canAccessMiniProgramFloorPlan(plan, {
      user: { _id: '11' },
      staff: { _id: '24', role: 'salesperson' },
    }),
    false
  );
});

test('enterprise administrators retain the enterprise boundary', () => {
  assert.equal(
    canAccessMiniProgramFloorPlan(
      { ...plan, enterpriseId: 7n },
      {
        user: { _id: '11' },
        enterpriseId: '7',
        staff: { _id: '24', enterpriseId: '7', role: 'enterprise_admin' },
      }
    ),
    true
  );
});

test('enterprise administrators cannot export a different tenant plan', () => {
  assert.equal(
    canAccessMiniProgramFloorPlan(
      { ...plan, enterpriseId: 7n },
      {
        user: { _id: '11' },
        enterpriseId: '8',
        staff: { _id: '24', enterpriseId: '8', role: 'enterprise_admin' },
      }
    ),
    false
  );
});
