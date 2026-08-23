import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessMiniProgramFloorPlan,
  canReadMiniProgramFloorPlan,
} from '@/lib/floor-plan-access';

const plan = {
  creatorId: 11n,
  staffId: 23n,
  enterpriseId: 7n,
};

const linkedLead = {
  enterpriseId: 7n,
  assignedTo: 99n,
  measurerId: 23n,
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

test('assigned designer can read a measurer-saved plan on the linked lead', () => {
  assert.equal(
    canAccessMiniProgramFloorPlan(plan, {
      user: { _id: '11' },
      enterpriseId: '7',
      staff: { _id: '99', enterpriseId: '7', role: 'designer' },
    }),
    false
  );
  assert.equal(
    canReadMiniProgramFloorPlan(
      plan,
      {
        user: { _id: '11' },
        enterpriseId: '7',
        staff: { _id: '99', enterpriseId: '7', role: 'designer' },
      },
      linkedLead
    ),
    true
  );
});

test('unassigned designer cannot read another lead\'s measurer-saved plan', () => {
  assert.equal(
    canReadMiniProgramFloorPlan(
      plan,
      {
        user: { _id: '11' },
        enterpriseId: '7',
        staff: { _id: '100', enterpriseId: '7', role: 'designer' },
      },
      linkedLead
    ),
    false
  );
});

test('reassigned measurer can read a plan originally saved by a previous measurer', () => {
  assert.equal(
    canReadMiniProgramFloorPlan(
      plan,
      {
        user: { _id: '11' },
        enterpriseId: '7',
        staff: { _id: '24', enterpriseId: '7', role: 'measurer' },
      },
      { ...linkedLead, measurerId: 24n }
    ),
    true
  );
});

test('assigned designer cannot read a plan linked to another enterprise lead', () => {
  assert.equal(
    canReadMiniProgramFloorPlan(
      plan,
      {
        user: { _id: '11' },
        enterpriseId: '7',
        staff: { _id: '99', enterpriseId: '7', role: 'designer' },
      },
      { ...linkedLead, enterpriseId: 8n }
    ),
    false
  );
});
