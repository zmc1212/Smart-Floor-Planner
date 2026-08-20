import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStaffingGapItems,
  buildWorkbenchAppointmentItem,
  buildWorkbenchLeadItem,
  isAssignmentEligibleStaff,
  isMeasurerWorkbenchSurveyLead,
} from '@/lib/miniprogram-workbench';

function surveyLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 11n,
    name: 'grh',
    communityName: null,
    status: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: 7n,
    appointment: null,
    primaryFloorPlanRecord: null,
    floorPlanRecords: [],
    updatedAt: new Date('2026-08-19T12:00:00.000Z'),
    ...overrides,
  };
}

test('designers need an active wechat profile and measurers only need to stay assignable', () => {
  assert.equal(isAssignmentEligibleStaff({
    role: 'designer',
    status: 'active',
    assignmentPaused: false,
    wechatId: 'wx-designer',
    wechatQrAssetId: '12',
  }), true);
  assert.equal(isAssignmentEligibleStaff({
    role: 'designer',
    status: 'active',
    assignmentPaused: false,
    wechatId: '  ',
    wechatQrAssetId: '12',
  }), false);
  assert.equal(isAssignmentEligibleStaff({
    role: 'measurer',
    status: 'active',
    assignmentPaused: false,
  }), true);
  assert.equal(isAssignmentEligibleStaff({
    role: 'measurer',
    status: 'active',
    assignmentPaused: true,
  }), false);
});

test('enterprise operations expose missing designer and measurer staffing as exceptions', () => {
  assert.deepEqual(buildStaffingGapItems({ eligibleDesignerCount: 0, eligibleMeasurerCount: 2 }).map((item) => item.id), [
    'staffing-designer',
  ]);
  assert.deepEqual(buildStaffingGapItems({ eligibleDesignerCount: 1, eligibleMeasurerCount: 0 }).map((item) => ({
    id: item.id,
    metaLabel: item.metaLabel,
    action: item.action,
    serviceStage: item.serviceStage,
  })), [{
    id: 'staffing-measurer',
    metaLabel: '人员缺口',
    action: 'staffing',
    serviceStage: 'assignment_pending',
  }]);
  assert.deepEqual(buildStaffingGapItems({ eligibleDesignerCount: 1, eligibleMeasurerCount: 1 }), []);
});

test('unscheduled survey tasks without a floor plan can start measuring or book a visit', () => {
  const item = buildWorkbenchLeadItem(surveyLead({ status: 'new' }), 'survey');
  assert.equal(item.canSurveyNow, true);
  assert.equal(item.canBookAppointment, true);
  assert.equal(item.canContinueSurvey, false);
  assert.equal(item.canStartNewSurvey, false);
  assert.equal(item.floorPlanId, '');
  assert.equal(item.actionLabel, '立即量房');
  assert.equal(item.statusBadge, '待量房');
});

test('a linked floor plan hides booking and reopens the existing plan instead of a blank canvas', () => {
  const item = buildWorkbenchLeadItem(surveyLead({
    primaryFloorPlanRecord: { id: 88n, status: 'completed', updatedAt: new Date('2026-08-19T16:00:00.000Z') },
    floorPlanRecords: [{ id: 88n, status: 'completed', updatedAt: new Date('2026-08-19T16:00:00.000Z') }],
    status: 'designing',
  }), 'survey');
  assert.equal(item.canBookAppointment, false);
  assert.equal(item.canContinueSurvey, true);
  assert.equal(item.canStartNewSurvey, true);
  assert.equal(item.canSurveyNow, true);
  assert.equal(item.floorPlanId, '88');
  assert.equal(item.actionLabel, '继续量房');
  assert.equal(item.statusBadge, '户型已就绪');
});

test('a draft floor plan still lets the measurer continue or start another survey', () => {
  const item = buildWorkbenchLeadItem(surveyLead({
    primaryFloorPlanRecord: { id: 91n, status: 'draft', updatedAt: new Date('2026-08-19T16:00:00.000Z') },
    floorPlanRecords: [{ id: 91n, status: 'draft', updatedAt: new Date('2026-08-19T16:00:00.000Z') }],
  }), 'survey');
  assert.equal(item.canBookAppointment, false);
  assert.equal(item.canContinueSurvey, true);
  assert.equal(item.canStartNewSurvey, true);
  assert.equal(item.actionLabel, '继续量房');
  assert.equal(item.statusBadge, '量房中');
});

test('measurer workbench pending survey excludes completed floor plans after the visit is done', () => {
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({ status: 'new' }), new Set()), true);
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    primaryFloorPlanRecord: { id: 91n, status: 'draft' },
    floorPlanRecords: [{ id: 91n, status: 'draft' }],
  }), new Set()), true, 'draft plans remain continue-survey work');
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    status: 'designing',
    primaryFloorPlanRecord: { id: 88n, status: 'completed' },
    floorPlanRecords: [{ id: 88n, status: 'completed' }],
  }), new Set()), false, 'completed v4 surveys leave the pending queue');
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    status: 'measuring',
    primaryFloorPlanRecord: { id: 88n, status: 'completed' },
    floorPlanRecords: [{ id: 88n, status: 'completed' }],
  }), new Set()), false, 'formal completion outranks a leftover measuring status');
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    status: 'designing',
    primaryFloorPlanRecord: { id: 88n, status: 'completed' },
    floorPlanRecords: [{ id: 88n, status: 'completed' }],
  }), new Set(['11'])), false);
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({ status: 'converted' }), new Set()), false);
});

test('confirmed appointments with a completed floor plan reopen that plan instead of a blank survey', () => {
  const item = buildWorkbenchAppointmentItem({
    id: 55n,
    leadId: 923n,
    address: '111',
    timeRange: '["2026-08-19T02:00:00.000Z","2026-08-19T03:00:00.000Z"]',
    status: 'confirmed',
  }, surveyLead({
    id: 923n,
    name: '微信客户',
    status: 'designing',
    primaryFloorPlanRecord: { id: 237n, status: 'completed' },
    floorPlanRecords: [{ id: 237n, status: 'completed' }],
  }));
  assert.equal(item.action, 'appointment');
  assert.equal(item.floorPlanId, '237');
  assert.equal(item.canContinueSurvey, true);
  assert.equal(item.canStartNewSurvey, true);
  assert.equal(item.canSurveyNow, false);
  assert.equal(item.statusBadge, '户型已就绪');
});
