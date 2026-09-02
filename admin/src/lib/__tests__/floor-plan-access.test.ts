import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessMiniProgramFloorPlan,
  canMutateMiniProgramFloorPlan,
  canReadMiniProgramFloorPlan,
  canRecordMiniProgramFloorPlanMeasurement,
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

test('assigned collaborator can complete a plan saved by the other field role', () => {
  assert.equal(
    canMutateMiniProgramFloorPlan(
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
  assert.equal(
    canMutateMiniProgramFloorPlan(
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

test('assigned collaborators can record audits on a plan saved by the other role', () => {
  const assignedDesignerContext = {
    user: { _id: '11' },
    enterpriseId: '7',
    staff: { _id: '99', enterpriseId: '7', role: 'designer' },
  };
  const reassignedMeasurerContext = {
    user: { _id: '11' },
    enterpriseId: '7',
    staff: { _id: '24', enterpriseId: '7', role: 'measurer' },
  };

  assert.equal(
    canRecordMiniProgramFloorPlanMeasurement(
      plan,
      assignedDesignerContext,
      linkedLead
    ),
    true
  );
  assert.equal(
    canRecordMiniProgramFloorPlanMeasurement(
      { ...plan, staffId: 23n },
      reassignedMeasurerContext,
      { ...linkedLead, measurerId: 24n }
    ),
    true
  );
});

test('unassigned or cross-tenant staff cannot record floor-plan audits', () => {
  const context = {
    user: { _id: '11' },
    enterpriseId: '7',
    staff: { _id: '100', enterpriseId: '7', role: 'designer' },
  };

  assert.equal(
    canRecordMiniProgramFloorPlanMeasurement(plan, context, linkedLead),
    false
  );
  assert.equal(
    canRecordMiniProgramFloorPlanMeasurement(
      plan,
      { ...context, staff: { ...context.staff, _id: '99' } },
      { ...linkedLead, enterpriseId: 8n }
    ),
    false
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

test('linked-lead reads fail closed when either tenant id is missing', () => {
  assert.equal(
    canReadMiniProgramFloorPlan(
      plan,
      {
        user: { _id: '11' },
        enterpriseId: '7',
        staff: { _id: '99', enterpriseId: '7', role: 'designer' },
      },
      { ...linkedLead, enterpriseId: null }
    ),
    false
  );
  assert.equal(
    canReadMiniProgramFloorPlan(
      plan,
      {
        user: { _id: '11' },
        staff: { _id: '99', role: 'designer' },
      },
      linkedLead
    ),
    false
  );
});

test('enterprise administrators cannot use a linked lead to bypass a missing tenant id', () => {
  assert.equal(
    canReadMiniProgramFloorPlan(
      plan,
      {
        user: { _id: '11' },
        staff: { _id: '24', role: 'enterprise_admin' },
      },
      linkedLead
    ),
    false
  );
});
