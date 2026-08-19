import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCustomerReschedule,
  canRebookAppointment,
  parseAppointmentBounds,
  resolveCustomerHomeAction,
  resolveLeadServiceStage,
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
  }).kind, 'wait_designer');

  assert.equal(resolveCustomerHomeAction({
    leadStatus: 'designing',
    hasFormalFloorPlan: true,
  }).kind, 'view_project');
});
