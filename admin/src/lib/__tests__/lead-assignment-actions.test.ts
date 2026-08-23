import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCanAssignLeadStaff,
  canAccessLeadForStaffAssign,
  getLeadAssignmentActions,
} from '@/lib/lead-assignment-actions';

function lead(input: Partial<{
  assignedTo: bigint | null;
  measurerId: bigint | null;
  archivedAt: Date | null;
  status: string;
}> = {}) {
  return {
    assignedTo: input.assignedTo ?? 8n,
    measurerId: input.measurerId ?? 9n,
    archivedAt: input.archivedAt ?? null,
    status: input.status ?? 'designing',
  };
}

test('enterprise managers and platform admins can assign both roles', () => {
  assert.deepEqual(getLeadAssignmentActions(lead(), 'enterprise_admin', 1n), {
    canAssignDesigner: true,
    canAssignMeasurer: true,
  });
  assert.deepEqual(getLeadAssignmentActions(lead(), 'admin', 1n), {
    canAssignDesigner: true,
    canAssignMeasurer: true,
  });
  assert.deepEqual(getLeadAssignmentActions(lead(), 'super_admin', 1n), {
    canAssignDesigner: true,
    canAssignMeasurer: true,
  });
});

test('assigned designers can change the measurer only', () => {
  assert.deepEqual(getLeadAssignmentActions(lead(), 'designer', 8n), {
    canAssignDesigner: false,
    canAssignMeasurer: true,
  });
  assert.deepEqual(getLeadAssignmentActions(lead(), 'designer', 99n), {
    canAssignDesigner: false,
    canAssignMeasurer: false,
  });
  assert.throws(
    () => assertCanAssignLeadStaff({
      lead: lead(),
      role: 'designer',
      actorId: 8n,
      designerId: 12n,
    }),
    /无权更换设计师/
  );
});

test('measurers and closed leads cannot reassign staff', () => {
  assert.deepEqual(getLeadAssignmentActions(lead(), 'measurer', 9n), {
    canAssignDesigner: false,
    canAssignMeasurer: false,
  });
  assert.equal(canAccessLeadForStaffAssign(lead(), 'measurer', 9n), true);
  assert.throws(
    () => assertCanAssignLeadStaff({
      lead: lead(),
      role: 'measurer',
      actorId: 9n,
      measurerId: 21n,
    }),
    /无权分配或更换测量员/
  );
  assert.deepEqual(
    getLeadAssignmentActions(lead({ archivedAt: new Date() }), 'enterprise_admin', 1n),
    { canAssignDesigner: false, canAssignMeasurer: false }
  );
  assert.deepEqual(
    getLeadAssignmentActions(lead({ status: 'closed' }), 'enterprise_admin', 1n),
    { canAssignDesigner: false, canAssignMeasurer: false }
  );
  assert.deepEqual(
    getLeadAssignmentActions(lead({ status: 'converted' }), 'enterprise_admin', 1n),
    { canAssignDesigner: true, canAssignMeasurer: true }
  );
});
