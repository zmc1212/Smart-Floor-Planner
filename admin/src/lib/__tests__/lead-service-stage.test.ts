import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCustomerReschedule,
  canRebookAppointment,
  CUSTOMER_HOME_ACTION_LABELS,
  parseAppointmentBounds,
  resolveCustomerHomeAction,
  resolveLeadServiceStage,
  selectOperationalAppointment,
} from '@/lib/lead-service-stage';

const range = '[2026-08-19T01:00:00.000Z,2026-08-19T03:00:00.000Z)';

test('parses appointment tstzrange bounds', () => {
  const bounds = parseAppointmentBounds(range);
  assert.equal(bounds?.startAt.toISOString(), '2026-08-19T01:00:00.000Z');
  assert.equal(bounds?.endAt.toISOString(), '2026-08-19T03:00:00.000Z');
});

test('keeps canonical lead status and derives matching / booking / expiry stages', () => {
  assert.equal(resolveLeadServiceStage({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
  }).key, 'measurer_assigned');

  assert.equal(resolveLeadServiceStage({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-18T12:00:00.000Z'),
  }).key, 'appointment_confirmed');

  assert.equal(resolveLeadServiceStage({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-19T02:00:00.000Z'),
  }).key, 'appointment_in_progress');

  assert.equal(resolveLeadServiceStage({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-19T04:00:00.000Z'),
  }).key, 'appointment_expired');

  assert.equal(resolveLeadServiceStage({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'cancelled', timeRange: range },
  }).key, 'awaiting_rebooking');
});

test('survey completion outranks an expired appointment', () => {
  const stage = resolveLeadServiceStage({
    leadStatus: 'designing',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'expired', timeRange: range },
    hasFormalFloorPlan: true,
  });
  assert.equal(stage.key, 'survey_completed');
  assert.equal(canRebookAppointment({
    leadStatus: 'designing',
    appointment: { status: 'expired', timeRange: range },
    hasFormalFloorPlan: true,
  }), false);
});

test('published customer designs advance the service stage ahead of survey completion', () => {
  const stage = resolveLeadServiceStage({
    leadStatus: 'designing',
    assignmentStatus: 'assigned',
    measurerId: '1',
    hasFormalFloorPlan: true,
    publishedDesignCount: 2,
  });
  assert.equal(stage.key, 'design_published');
  assert.equal(stage.nextAction, '沟通确认或标记签约');
});

test('rebooking is allowed after expiry or cancel when survey is not done', () => {
  assert.equal(canRebookAppointment({
    leadStatus: 'measuring',
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-19T04:00:00.000Z'),
  }), true);
  assert.equal(canRebookAppointment({
    leadStatus: 'measuring',
    appointment: { status: 'cancelled', timeRange: range },
  }), true);
  assert.equal(canRebookAppointment({
    leadStatus: 'measuring',
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-18T12:00:00.000Z'),
  }), false);
  assert.equal(canRebookAppointment({
    leadStatus: 'new',
    assignmentStatus: 'assignment_pending',
  }), false, 'no rebooking when assignment is still pending');
  assert.equal(canRebookAppointment({
    leadStatus: 'new',
    assignmentStatus: 'assigned',
  }), true, 'rebooking allowed once assigned with no appointment');
});

test('customer reschedule stays inside the cutoff window and stops after the visit starts', () => {
  const appointment = { status: 'confirmed', timeRange: range };
  assert.equal(canCustomerReschedule({
    appointment,
    customerRescheduleCutoffHours: 2,
    now: new Date('2026-08-18T22:00:00.000Z'),
  }), true);
  assert.equal(canCustomerReschedule({
    appointment,
    customerRescheduleCutoffHours: 2,
    now: new Date('2026-08-18T23:30:00.000Z'),
  }), false);
  assert.equal(canCustomerReschedule({
    appointment,
    customerRescheduleCutoffHours: 2,
    now: new Date('2026-08-19T02:00:00.000Z'),
  }), false);
});

test('customer home exposes one next action from the shared service stage', () => {
  assert.deepEqual(resolveCustomerHomeAction({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-18T12:00:00.000Z'),
    customerRescheduleCutoffHours: 2,
  }), {
    kind: 'reschedule',
    label: '改期',
    stageKey: 'appointment_confirmed',
    stageLabel: '已预约上门量房',
    nextAction: '按预约上门，窗口内可改期',
    appointmentSummary: '8月19日 09:00 上门量房',
    canReschedule: true,
    canRebook: false,
  });

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'measuring',
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-19T04:00:00.000Z'),
  }).kind, 'rebook');

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
  }).kind, 'book');

  assert.deepEqual(resolveCustomerHomeAction({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
  }), {
    kind: 'book',
    label: '预约上门',
    stageKey: 'measurer_assigned',
    stageLabel: '已匹配测量员',
    nextAction: '预约上门量房时间',
    appointmentSummary: '已匹配设计师和测量员，请预约上门量房时间',
    canReschedule: false,
    canRebook: true,
  });

  assert.deepEqual(resolveCustomerHomeAction({
    leadStatus: 'new',
    assignmentStatus: 'assignment_pending',
  }), {
    kind: 'wait_designer',
    label: '等待派单',
    stageKey: 'assignment_pending',
    stageLabel: '待派单',
    nextAction: '服务匹配完成后即可预约上门',
    appointmentSummary: '正在为您匹配设计师和测量员',
    canReschedule: false,
    canRebook: false,
  });

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'new',
  }).appointmentSummary, '正在为您匹配设计师和测量员');

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'designing',
    hasFormalFloorPlan: true,
  }).kind, 'view_project');

  assert.equal(CUSTOMER_HOME_ACTION_LABELS.view_project, '我的服务档案');
  assert.equal(CUSTOMER_HOME_ACTION_LABELS.none, '我的服务档案');

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'designing',
    hasFormalFloorPlan: true,
  }).label, '我的服务档案');
});

test('operational appointment prefers an active confirmed rebooking over an older expired row', () => {
  const now = new Date('2026-08-19T14:30:00.000Z');
  const expired = {
    id: 1n,
    status: 'expired',
    timeRange: '[2026-08-19T01:00:00.000Z,2026-08-19T03:00:00.000Z)',
    createdAt: new Date('2026-08-19T01:00:00.000Z'),
  };
  const pastConfirmed = {
    id: 2n,
    status: 'confirmed',
    timeRange: '[2026-08-19T07:00:00.000Z,2026-08-19T09:00:00.000Z)',
    createdAt: new Date('2026-08-19T14:00:00.000Z'),
  };
  const rebooked = {
    id: 3n,
    status: 'confirmed',
    timeRange: '[2026-08-20T07:00:00.000Z,2026-08-20T09:00:00.000Z)',
    createdAt: new Date('2026-08-19T10:00:00.000Z'),
  };

  const selected = selectOperationalAppointment([expired, pastConfirmed, rebooked], now);
  assert.equal(selected?.id, 3n);
  assert.equal(resolveLeadServiceStage({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: selected,
    now,
  }).key, 'appointment_confirmed');
});
