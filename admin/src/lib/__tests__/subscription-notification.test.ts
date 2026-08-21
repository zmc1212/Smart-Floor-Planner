import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDesignPublishedPayload,
  buildEnterpriseJoinResultPayload,
  buildLeadAssignmentPayload,
  buildLeadConvertedPayload,
  buildMeasurementAppointmentPayload,
  buildNewLeadPayload,
  buildSigningCommissionPayload,
  buildWorkflowNotificationPayload,
  buildWorkflowTodoPayload,
  resolveWorkflowTemplateKind,
} from '@/lib/miniprogram-subscription-messages';
import {
  DEFAULT_SUBSCRIPTION_TEMPLATES,
  normalizePlatformNotificationConfig,
  SUBSCRIPTION_TEMPLATE_KINDS,
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

test('eight subscription template IDs must remain distinct', () => {
  const normalized = normalizePlatformNotificationConfig();
  assert.deepEqual(SUBSCRIPTION_TEMPLATE_KINDS, [
    'workflow_todo',
    'lead_assignment',
    'new_lead',
    'measurement_appointment',
    'design_published',
    'enterprise_join_result',
    'signing_commission',
    'lead_converted',
  ]);
  assert.equal(
    normalized.templates.design_published.templateId,
    'XEQFWwyaIQVotG3R6FKZxWLFExf9pS7_g85r-j3Vjag'
  );
  assert.equal(
    normalized.templates.enterprise_join_result.templateId,
    'wJ5K4XXpOOPnsHFcEOl5MJq7J0iG8bpxsyVLzd_G3Kk'
  );
  assert.equal(
    normalized.templates.signing_commission.templateId,
    'aY-4Rk78otCQuM-PQ6yKUt46XFWP60zP8m7QqrrX8xU'
  );
  assert.equal(
    normalized.templates.lead_converted.templateId,
    'WFQg70AyoRkLpHaNNK4oywE2gMS60nHuKelkLjkK3zo'
  );
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

  const published = buildDesignPublishedPayload(DEFAULT_SUBSCRIPTION_TEMPLATES.design_published, {
    content: '现代简约客厅方案',
    publishedAt: '2026-08-13T07:00:00.000Z',
    note: '请到项目页查看效果图',
  });
  assert.deepEqual(Object.keys(published), ['thing1', 'time2', 'thing3']);
  assert.equal(published.time2.value, '2026-08-13 15:00:00');

  const joinResult = buildEnterpriseJoinResultPayload(
    DEFAULT_SUBSCRIPTION_TEMPLATES.enterprise_join_result,
    {
      notifiedAt: '2026-08-21T08:00:00.000Z',
      result: '审核通过',
      contactPerson: '张三',
      appliedAt: '2026-08-20T07:00:00.000Z',
      storeName: '家客来装修',
    }
  );
  assert.deepEqual(Object.keys(joinResult), ['time1', 'phrase2', 'thing3', 'time4', 'thing5']);
  assert.equal(joinResult.phrase2.value, '审核通过');
  assert.equal(joinResult.time1.value, '2026-08-21 16:00:00');
  assert.equal(joinResult.time4.value, '2026-08-20 15:00:00');

  const signing = buildSigningCommissionPayload(
    DEFAULT_SUBSCRIPTION_TEMPLATES.signing_commission,
    {
      rewardType: '签单提成',
      note: '张三已签约',
      amount: '1280.5',
    }
  );
  assert.deepEqual(Object.keys(signing), ['thing1', 'thing2', 'amount4']);
  assert.equal(signing.amount4.value, '¥1280.50');

  const converted = buildLeadConvertedPayload(DEFAULT_SUBSCRIPTION_TEMPLATES.lead_converted, {
    notifiedAt: '2026-08-21T08:00:00.000Z',
    tip: '张三已签约',
  });
  assert.deepEqual(Object.keys(converted), ['time1', 'thing2']);
  assert.equal(converted.time1.value, '2026-08-21 16:00:00');
  assert.equal(converted.thing2.value, '张三已签约');
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
