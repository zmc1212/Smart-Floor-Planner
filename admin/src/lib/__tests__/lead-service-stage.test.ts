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
const postgresRange = '["2026-08-23 01:00:00+00","2026-08-23 03:00:00+00")';

test('parses appointment tstzrange bounds', () => {
  const bounds = parseAppointmentBounds(range);
  assert.equal(bounds?.startAt.toISOString(), '2026-08-19T01:00:00.000Z');
  assert.equal(bounds?.endAt.toISOString(), '2026-08-19T03:00:00.000Z');
});

test('parses postgres tstzrange literals that omit T and use +00 offsets', () => {
  const bounds = parseAppointmentBounds(postgresRange);
  assert.equal(bounds?.startAt.toISOString(), '2026-08-23T01:00:00.000Z');
  assert.equal(bounds?.endAt.toISOString(), '2026-08-23T03:00:00.000Z');
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
    appointment: { status: 'completed', timeRange: range },
    hasFormalFloorPlan: true,
  });
  assert.equal(stage.key, 'survey_completed');
  assert.equal(canRebookAppointment({
    leadStatus: 'designing',
    appointment: { status: 'expired', timeRange: range },
    hasFormalFloorPlan: true,
  }), false);
});

test('completed floor plan with a still-confirmed appointment is survey_ready', () => {
  const inProgress = resolveLeadServiceStage({
    leadStatus: 'measuring',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'confirmed', timeRange: range },
    hasFormalFloorPlan: true,
    now: new Date('2026-08-19T02:00:00.000Z'),
  });
  assert.equal(inProgress.key, 'survey_ready');
  assert.equal(inProgress.label, '待确认完成');

  const leftoverDesigning = resolveLeadServiceStage({
    leadStatus: 'designing',
    assignmentStatus: 'assigned',
    measurerId: '1',
    appointment: { status: 'confirmed', timeRange: range },
    hasFormalFloorPlan: true,
    now: new Date('2026-08-19T02:00:00.000Z'),
  });
  assert.equal(leftoverDesigning.key, 'survey_ready');
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

test('first send without survey is design_published and still allows makeup booking', () => {
  const stage = resolveLeadServiceStage({
    leadStatus: 'designing',
    assignmentStatus: 'assigned',
    measurerId: '1',
    publishedDesignCount: 1,
  });
  assert.equal(stage.key, 'design_published');
  assert.equal(canRebookAppointment({
    leadStatus: 'designing',
    assignmentStatus: 'assigned',
  }), true);
  const home = resolveCustomerHomeAction({
    leadStatus: 'designing',
    assignmentStatus: 'assigned',
    measurerId: '1',
    publishedDesignCount: 1,
  });
  assert.equal(home.kind, 'view_project');
  assert.equal(home.label, '我的服务档案');
  assert.equal(home.canRebook, true);
  assert.equal(home.appointmentSummary, '方案已发布，可在服务档案查看');
});

test('published unsurveyed leads keep visit time when a makeup appointment is confirmed', () => {
  const home = resolveCustomerHomeAction({
    leadStatus: 'designing',
    assignmentStatus: 'assigned',
    measurerId: '1',
    publishedDesignCount: 1,
    appointment: { status: 'confirmed', timeRange: range },
    now: new Date('2026-08-18T12:00:00.000Z'),
    customerRescheduleCutoffHours: 2,
  });
  assert.equal(home.stageKey, 'design_published');
  assert.equal(home.kind, 'view_project');
  assert.equal(home.canRebook, false);
  assert.equal(home.canReschedule, true);
  assert.equal(home.appointmentSummary, '8月19日 09:00 量房');
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
  assert.equal(canCustomerReschedule({
    appointment,
    customerRescheduleCutoffHours: 2,
    hasFormalFloorPlan: true,
    now: new Date('2026-08-18T22:00:00.000Z'),
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
    appointmentSummary: '8月19日 09:00 量房',
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
    label: '预约量房',
    stageKey: 'measurer_assigned',
    stageLabel: '已匹配家装现场顾问',
    nextAction: '预约上门量房时间',
    appointmentSummary: '已匹配家装设计顾问和家装现场顾问，可预约量房时间',
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
    nextAction: '服务匹配完成后即可预约量房',
    appointmentSummary: '正在为您匹配家装设计顾问和家装现场顾问',
    canReschedule: false,
    canRebook: false,
  });

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'new',
  }).appointmentSummary, '正在为您匹配家装设计顾问和家装现场顾问');

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'designing',
    hasFormalFloorPlan: true,
    appointment: { status: 'completed', timeRange: range },
  }).kind, 'view_project');

  assert.equal(CUSTOMER_HOME_ACTION_LABELS.view_project, '我的服务档案');
  assert.equal(CUSTOMER_HOME_ACTION_LABELS.none, '我的服务档案');

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'designing',
    hasFormalFloorPlan: true,
    appointment: { status: 'completed', timeRange: range },
  }).label, '我的服务档案');

  const pendingConfirm = resolveCustomerHomeAction({
    leadStatus: 'measuring',
    appointment: { status: 'confirmed', timeRange: range },
    hasFormalFloorPlan: true,
    now: new Date('2026-08-19T02:00:00.000Z'),
    customerRescheduleCutoffHours: 2,
  });
  assert.equal(pendingConfirm.stageKey, 'survey_ready');
  assert.equal(pendingConfirm.kind, 'view_project');
  assert.equal(pendingConfirm.canReschedule, false);
  assert.equal(pendingConfirm.canRebook, false);
  assert.equal(pendingConfirm.appointmentSummary, '家装现场顾问正在量房');
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

test('referrer withdrawal is a terminal customer stage with no CTA', () => {
  const stage = resolveLeadServiceStage({ leadStatus: 'closed', terminationType: 'referrer_withdrawn' });
  assert.equal(stage.key, 'referrer_withdrawn');
  assert.equal(stage.label, '推广人已撤销');
  const home = resolveCustomerHomeAction({ leadStatus: 'closed', terminationType: 'referrer_withdrawn' });
  assert.equal(home.kind, 'none');
  assert.equal(home.appointmentSummary, '本次推广服务记录已撤销，如需继续服务，请重新扫描有效服务码');
  assert.equal(home.canRebook, false);
});
