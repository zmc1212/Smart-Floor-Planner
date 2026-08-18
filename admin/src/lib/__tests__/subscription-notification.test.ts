import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLeadAssignmentPayload,
  buildMeasurementAppointmentPayload,
  buildNewLeadPayload,
  buildWorkflowNotificationPayload,
  buildWorkflowTodoPayload,
  resolveWorkflowTemplateKind,
} from '@/lib/miniprogram-subscription-messages';
import {
  DEFAULT_SUBSCRIPTION_TEMPLATES,
  normalizePlatformNotificationConfig,
  validateDistinctTemplateIds,
} from '@/lib/platform-notification-config';

test('legacy single-template config normalizes to V2 while preserving the old ID', () => {
  const normalized = normalizePlatformNotificationConfig({
    miniprogramTemplateId: 'legacy_template_12345',
  });
  assert.equal(normalized.version, 2);
  assert.equal(normalized.legacyTemplateId, 'legacy_template_12345');
  assert.equal(
    normalized.templates.workflow_todo.templateId,
    DEFAULT_SUBSCRIPTION_TEMPLATES.workflow_todo.templateId
  );
  assert.equal(normalized.miniprogramTemplateId, normalized.templates.workflow_todo.templateId);
});

test('four subscription template IDs must remain distinct', () => {
  const normalized = normalizePlatformNotificationConfig();
  assert.doesNotThrow(() => validateDistinctTemplateIds(normalized.templates));
  normalized.templates.new_lead.templateId = normalized.templates.workflow_todo.templateId;
  assert.throws(
    () => validateDistinctTemplateIds(normalized.templates),
    /must be unique/
  );
});

test('workflow notification types select assignment or todo templates deterministically', () => {
  assert.equal(resolveWorkflowTemplateKind('measure_assigned'), 'lead_assignment');
  assert.equal(resolveWorkflowTemplateKind('design_assigned'), 'lead_assignment');
  assert.equal(resolveWorkflowTemplateKind('measure_overdue'), 'workflow_todo');
  assert.equal(resolveWorkflowTemplateKind('record_closed'), 'workflow_todo');
});

test('payload builders emit only the approved keyword keys', () => {
  const todo = buildWorkflowTodoPayload(DEFAULT_SUBSCRIPTION_TEMPLATES.workflow_todo, {
    projectName: '天福克拉广场36-14',
    owner: '周鑫',
    currentStatus: '待处理',
    todo: '订购橱柜、中央空调、地暖',
    note: '已完成',
  });
  assert.deepEqual(Object.keys(todo), ['thing4', 'thing11', 'phrase12', 'thing2', 'thing5']);

  const assignment = buildLeadAssignmentPayload(DEFAULT_SUBSCRIPTION_TEMPLATES.lead_assignment, {
    customerName: '胡彦斌',
    customerStatus: '跟进中',
    note: '客户比较基金请及时联系',
    assignedAt: '2026-08-12T07:00:00.000Z',
  });
  assert.deepEqual(Object.keys(assignment), ['thing1', 'phrase2', 'thing3', 'time4']);

  const newLead = buildNewLeadPayload(DEFAULT_SUBSCRIPTION_TEMPLATES.new_lead, {
    customerName: '张三',
    addedAt: '2026-08-12T07:00:00.000Z',
    owner: '小狄',
    phone: '13555555555',
    selectedAt: '2026-08-13T07:00:00.000Z',
  });
  assert.deepEqual(Object.keys(newLead), ['name1', 'date2', 'name3', 'phone_number4', 'time5']);
  assert.equal(newLead.time5.value, '2026-08-13 15:00:00');

  const appointment = buildMeasurementAppointmentPayload(DEFAULT_SUBSCRIPTION_TEMPLATES.measurement_appointment, {
    customerName: '张三',
    phone: '13555555555',
    community: '天福克拉广场36-14',
    measurementAt: '2026-08-13T07:00:00.000Z',
    reminder: '预约时间已更新',
  });
  assert.deepEqual(Object.keys(appointment), ['thing1', 'phone_number2', 'thing3', 'time6', 'thing7']);
  assert.equal(appointment.time6.value, '2026-08-13 15:00:00');
});

test('new-lead selected time falls back from assignment to creation time', () => {
  const payload = buildNewLeadPayload(DEFAULT_SUBSCRIPTION_TEMPLATES.new_lead, {
    customerName: '张三',
    addedAt: '2026-08-12T07:00:00.000Z',
    owner: '小狄',
    phone: '13555555555',
  });
  assert.equal(payload.date2.value, '2026-08-12 15:00:00');
  assert.equal(payload.time5.value, payload.date2.value);
});

test('workflow assignment and todo builders never emit the retired generic payload', () => {
  const assignment = buildWorkflowNotificationPayload({
    template: DEFAULT_SUBSCRIPTION_TEMPLATES.lead_assignment,
    notificationType: 'measure_assigned',
    record: { contactPerson: '张三', measureAssignedAt: '2026-08-12T07:00:00.000Z' },
    recipientName: '量房师',
  });
  assert.deepEqual(Object.keys(assignment), ['thing1', 'phrase2', 'thing3', 'time4']);

  const todo = buildWorkflowNotificationPayload({
    template: DEFAULT_SUBSCRIPTION_TEMPLATES.workflow_todo,
    notificationType: 'design_completed',
    record: { enterpriseName: '示例企业', contactPerson: '张三' },
    recipientName: '业务员',
    message: '设计已完成，请继续跟进报价',
  });
  assert.deepEqual(Object.keys(todo), ['thing4', 'thing11', 'phrase12', 'thing2', 'thing5']);
  assert.equal(Object.prototype.hasOwnProperty.call(todo, 'time2'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(todo, 'thing3'), false);
});
