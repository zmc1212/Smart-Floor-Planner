import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEAD_ARCHIVE_REASONS,
  canAccessLeadForActor,
  canPurgeLeads,
  getPurgeBlockers,
  isLeadArchiveReason,
  resolveDelegatedLeadArchiveCapability,
} from '@/lib/lead-lifecycle';
import {
  canDeleteLeadFloorPlan,
  canOperateLead,
  resolveLeadStatusAfterFloorPlan,
  resolveLeadStatusAfterAppointmentComplete,
  resolveLeadStatusAfterDesignPublished,
} from '@/lib/lead-status';

test('accepts only the fixed archive reasons', () => {
  assert.equal(Object.keys(LEAD_ARCHIVE_REASONS).length, 6);
  assert.equal(isLeadArchiveReason('duplicate'), true);
  assert.equal(isLeadArchiveReason('测试'), false);
  assert.equal(isLeadArchiveReason(undefined), false);
});

test('manager roles are fixed and delegated permissions use override precedence', () => {
  assert.equal(canPurgeLeads('enterprise_admin'), true);
  assert.equal(canPurgeLeads('designer'), false);
  assert.equal(resolveDelegatedLeadArchiveCapability({ role: 'designer', roleDefault: false, override: 'allow' }), true);
  assert.equal(resolveDelegatedLeadArchiveCapability({ role: 'designer', roleDefault: true, override: 'deny' }), false);
  assert.equal(resolveDelegatedLeadArchiveCapability({ role: 'measurer', roleDefault: true, override: 'inherit' }), true);
  assert.equal(resolveDelegatedLeadArchiveCapability({ role: 'salesperson', roleDefault: true, override: 'allow' }), false);
});

test('row access stays within manager or assigned/promoted ownership', () => {
  const actor = 7n;
  assert.equal(canAccessLeadForActor({ promoterId: 1n, assignedTo: 2n }, 'admin', actor), true);
  assert.equal(canAccessLeadForActor({ promoterId: actor, assignedTo: 2n }, 'designer', actor), true);
  assert.equal(canAccessLeadForActor({ promoterId: 1n, assignedTo: 2n }, 'designer', actor), false);
});

test('purge blockers cover every protected relationship', () => {
  const blockers = getPurgeBlockers({
    leadId: 1n,
    archived: true,
    floorPlanCount: 1,
    aiWorkflowCount: 1,
    aiGenerationCount: 2,
    inFlightAiCount: 1,
    followUpCount: 3,
    hasConversion: true,
    commissionCount: 4,
  });
  assert.equal(blockers.length, 7);
  assert.deepEqual(getPurgeBlockers({
    leadId: 1n,
    archived: true,
    floorPlanCount: 0,
    aiWorkflowCount: 0,
    aiGenerationCount: 0,
    inFlightAiCount: 0,
    followUpCount: 0,
    hasConversion: false,
    commissionCount: 0,
  }), []);
});

test('formal floor plans cannot be deleted once the lead has entered design or a later stage', () => {
  assert.equal(canDeleteLeadFloorPlan('new'), true);
  assert.equal(canDeleteLeadFloorPlan('measuring'), true);
  assert.equal(canDeleteLeadFloorPlan('designing'), false);
  assert.equal(canDeleteLeadFloorPlan('quoting'), false);
  assert.equal(canDeleteLeadFloorPlan('converted'), false);
  assert.equal(canDeleteLeadFloorPlan('closed'), false);
  assert.equal(resolveLeadStatusAfterFloorPlan('converted', 'completed', 'measured'), 'converted');
  assert.equal(resolveLeadStatusAfterFloorPlan('new', 'completed'), 'measuring');
  assert.equal(resolveLeadStatusAfterFloorPlan('measuring', 'completed'), 'measuring');
  assert.equal(resolveLeadStatusAfterAppointmentComplete('measuring'), 'designing');
  assert.equal(resolveLeadStatusAfterAppointmentComplete('new'), 'designing');
  assert.equal(resolveLeadStatusAfterAppointmentComplete('converted'), 'converted');
  assert.equal(resolveLeadStatusAfterDesignPublished('new'), 'designing');
  assert.equal(resolveLeadStatusAfterDesignPublished('measuring'), 'designing');
  assert.equal(resolveLeadStatusAfterDesignPublished('designing'), 'designing');
  assert.equal(resolveLeadStatusAfterDesignPublished('converted'), 'converted');
  assert.equal(resolveLeadStatusAfterDesignPublished('closed'), 'closed');
});

test('closed and archived leads cannot take operational Admin actions', () => {
  assert.equal(canOperateLead('new'), true);
  assert.equal(canOperateLead('designing'), true);
  assert.equal(canOperateLead('converted'), true);
  assert.equal(canOperateLead('closed'), false);
  assert.equal(canOperateLead('closed', null), false);
  assert.equal(canOperateLead('new', '2026-08-28T00:00:00.000Z'), false);
});
