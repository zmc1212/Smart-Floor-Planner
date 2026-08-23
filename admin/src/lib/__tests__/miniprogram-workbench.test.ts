import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDesignerWechatProfileTodo,
  buildEnterpriseExpiredExceptionItem,
  buildEnterpriseOverviewSummary,
  buildEnterprisePendingExceptionItem,
  buildEnterpriseStaffRosterItem,
  buildEnterpriseStaffingExceptionItem,
  buildOpsDashboardCards,
  parseEnterpriseStaffRosterRoles,
  buildOpsDashboardSubtitle,
  buildStaffingGapItems,
  buildStaffLoadQuickNav,
  buildWorkbenchAppointmentItem,
  buildWorkbenchLeadItem,
  compareDesignerWorkbenchItems,
  computeSigningRate,
  formatGrowthDetail,
  formatSigningRateDetail,
  isAssignmentEligibleStaff,
  isMeasurerWorkbenchSurveyLead,
  previousComparablePeriodRange,
  resolveWorkbenchPeriod,
  selectMeasurerWorkbenchAppointments,
  shouldIncludeMeasurerWorkbenchAppointment,
  shanghaiWeekRange,
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

test('designer workbench surfaces a profile todo when WeChat contact is incomplete', () => {
  assert.equal(buildDesignerWechatProfileTodo({
    wechatId: 'wx-lin',
    wechatQrAssetId: 9n,
  }), null);
  const missingBoth = buildDesignerWechatProfileTodo({
    wechatId: '  ',
    wechatQrAssetId: null,
  });
  assert.ok(missingBoth);
  assert.equal(missingBoth!.action, 'profile');
  assert.equal(missingBoth!.id, 'designer-wechat-profile');
  assert.match(missingBoth!.subtitle, /微信号/);
  assert.match(missingBoth!.subtitle, /个人二维码/);
  const missingQr = buildDesignerWechatProfileTodo({
    wechatId: 'wx-lin',
    wechatQrAssetId: null,
  });
  assert.ok(missingQr);
  assert.match(missingQr!.subtitle, /个人二维码/);
  assert.doesNotMatch(missingQr!.subtitle, /微信号和/);
  const missingId = buildDesignerWechatProfileTodo({
    wechatId: '',
    wechatQrAssetId: 9n,
  });
  assert.ok(missingId);
  assert.match(missingId!.subtitle, /微信号/);
  assert.doesNotMatch(missingId!.subtitle, /个人二维码/);
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

test('survey cards with a locked measurer but pending designer do not show 待派单 beside 待量房', () => {
  const item = buildWorkbenchLeadItem(surveyLead({
    status: 'new',
    assignmentStatus: 'assignment_pending',
    assignmentErrorCode: 'designer_unavailable',
    measurerId: 7n,
  }), 'survey');
  assert.equal(item.serviceStage, 'assignment_pending');
  assert.equal(item.statusBadge, '待量房');
  assert.equal(item.metaLabel, '未预约上门');
  assert.equal(item.canSurveyNow, true);
  assert.equal(item.canBookAppointment, false);
  assert.equal(item.actionLabel, '立即量房');
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
  assert.equal(item.serviceStage, 'survey_ready');
  assert.equal(item.statusBadge, '待确认完成');
});

test('published designs show a published badge on designer workbench items', () => {
  const item = buildWorkbenchLeadItem(surveyLead({
    primaryFloorPlanRecord: { id: 88n, status: 'completed', updatedAt: new Date('2026-08-19T16:00:00.000Z') },
    floorPlanRecords: [{ id: 88n, status: 'completed', updatedAt: new Date('2026-08-19T16:00:00.000Z') }],
    status: 'designing',
    publishedDesignCount: 3,
  }), 'lead');
  assert.equal(item.serviceStage, 'design_published');
  assert.equal(item.statusBadge, '方案已发布');
  assert.equal(item.nextAction, '沟通确认或标记签约');
});

test('designer workbench prioritizes unpublished survey work ahead of published follow-ups', () => {
  const sorted = [
    { serviceStage: 'design_published', updatedAt: new Date('2026-08-20T12:00:00.000Z') },
    { serviceStage: 'survey_completed', updatedAt: new Date('2026-08-19T12:00:00.000Z') },
  ].sort(compareDesignerWorkbenchItems);
  assert.equal(sorted[0].serviceStage, 'survey_completed');
  assert.equal(sorted[1].serviceStage, 'design_published');
});

test('a draft floor plan still lets the measurer continue or start another survey', () => {
  const item = buildWorkbenchLeadItem(surveyLead({
    primaryFloorPlanRecord: { id: 91n, status: 'draft', updatedAt: new Date('2026-08-19T16:00:00.000Z') },
    floorPlanRecords: [{ id: 91n, status: 'draft', updatedAt: new Date('2026-08-19T16:00:00.000Z') }],
  }), 'survey');
  assert.equal(item.canBookAppointment, false);
  assert.equal(item.canContinueSurvey, true);
  assert.equal(item.canStartNewSurvey, true);
  assert.equal(item.canCompleteSurvey, false);
  assert.equal(item.actionLabel, '继续量房');
  assert.equal(item.statusBadge, '量房中');
});

test('measurer workbench pending survey keeps survey_ready tasks until the visit is confirmed', () => {
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({ status: 'new' }), new Set()), true);
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    primaryFloorPlanRecord: { id: 91n, status: 'draft' },
    floorPlanRecords: [{ id: 91n, status: 'draft' }],
  }), new Set()), true, 'draft plans remain continue-survey work');
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    status: 'measuring',
    primaryFloorPlanRecord: { id: 88n, status: 'completed' },
    floorPlanRecords: [{ id: 88n, status: 'completed' }],
    appointment: { status: 'confirmed', timeRange: '["2026-08-19T01:00:00.000Z","2026-08-19T03:00:00.000Z")' },
  }), new Set()), true, 'submitted floor plans stay until the visit is confirmed');
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    status: 'designing',
    primaryFloorPlanRecord: { id: 88n, status: 'completed' },
    floorPlanRecords: [{ id: 88n, status: 'completed' }],
    appointment: { status: 'completed', timeRange: '["2026-08-19T01:00:00.000Z","2026-08-19T03:00:00.000Z")' },
  }), new Set()), false, 'confirmed visits leave the pending queue');
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    status: 'designing',
    primaryFloorPlanRecord: { id: 88n, status: 'completed' },
    floorPlanRecords: [{ id: 88n, status: 'completed' }],
  }), new Set(['11'])), false);
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({ status: 'converted' }), new Set()), false);
});

test('measurer unscheduled survey tasks drop after a scheme is published without a visit', () => {
  assert.equal(isMeasurerWorkbenchSurveyLead(surveyLead({
    status: 'designing',
    publishedDesignCount: 1,
  }), new Set()), false);
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(surveyLead({
    status: 'designing',
    publishedDesignCount: 1,
  }), { status: 'confirmed' }), true, 'makeup visits stay on the calendar until complete or expired');
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(surveyLead({
    status: 'designing',
    publishedDesignCount: 1,
  }), { status: 'expired' }), false);
});

test('measurer workbench keeps only the current appointment task for each lead', () => {
  const selected = selectMeasurerWorkbenchAppointments([
    { id: 41n, leadId: 11n, status: 'expired', timeRange: '["2026-08-10T01:00:00.000Z","2026-08-10T02:00:00.000Z")' },
    { id: 42n, leadId: 11n, status: 'confirmed', timeRange: '["2026-08-21T01:00:00.000Z","2026-08-21T02:00:00.000Z")' },
    { id: 43n, leadId: 12n, status: 'expired', timeRange: '["2026-08-11T01:00:00.000Z","2026-08-11T02:00:00.000Z")' },
    { id: 44n, leadId: 12n, status: 'expired', timeRange: '["2026-08-12T01:00:00.000Z","2026-08-12T02:00:00.000Z")' },
  ]);

  assert.deepEqual(selected.map((appointment) => [String(appointment.leadId), String(appointment.id), appointment.status]), [
    ['11', '42', 'confirmed'],
    ['12', '44', 'expired'],
  ]);
});

test('expired appointments stay on the measurer workbench while survey confirmation is pending', () => {
  const pendingLead = surveyLead({
    id: 923n,
    status: 'measuring',
    primaryFloorPlanRecord: { id: 237n, status: 'completed' },
    floorPlanRecords: [{ id: 237n, status: 'completed' }],
  });
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(pendingLead, { status: 'expired' }), true);
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(pendingLead, { status: 'confirmed' }), true);
  const completedLead = surveyLead({
    id: 923n,
    status: 'designing',
    appointment: { status: 'completed', timeRange: '["2026-08-19T01:00:00.000Z","2026-08-19T03:00:00.000Z")' },
    primaryFloorPlanRecord: { id: 237n, status: 'completed' },
    floorPlanRecords: [{ id: 237n, status: 'completed' }],
  });
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(completedLead, { status: 'expired' }), false);
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(surveyLead({
    primaryFloorPlanRecord: { id: 91n, status: 'draft' },
    floorPlanRecords: [{ id: 91n, status: 'draft' }],
  }), { status: 'expired' }), true);
});

test('converted leads leave the measurer workbench even with a confirmed appointment', () => {
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(surveyLead({ status: 'converted' }), { status: 'confirmed' }), false);
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(surveyLead({ status: 'closed' }), { status: 'expired' }), false);
});

test('converted designer follow-up items stay terminal without rebook or survey CTAs', () => {
  const item = buildWorkbenchLeadItem(surveyLead({
    id: 77n,
    name: '签约客户',
    status: 'converted',
    primaryFloorPlanRecord: { id: 9n, status: 'completed' },
    floorPlanRecords: [{ id: 9n, status: 'completed' }],
  }), 'lead');
  assert.equal(item.serviceStage, 'converted');
  assert.equal(item.statusBadge, '已签约');
  assert.equal(item.canSurveyNow, false);
  assert.equal(item.canRebook, false);
  assert.equal(item.canBookAppointment, false);
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
  assert.equal(item.canCompleteSurvey, true);
  assert.equal(item.actionLabel, '确认完成量房');
  assert.equal(item.serviceStage, 'survey_ready');
  assert.equal(item.statusBadge, '待确认完成');
});

test('expired appointments on converted leads stay terminal and never reopen booking', () => {
  const item = buildWorkbenchAppointmentItem({
    id: 88n,
    leadId: 501n,
    address: '火凤凰',
    timeRange: '["2026-08-20T05:00:00.000Z","2026-08-20T06:00:00.000Z")',
    status: 'expired',
  }, surveyLead({
    id: 501n,
    name: '高容海',
    status: 'converted',
  }), { allowRebook: true });
  assert.equal(item.serviceStage, 'converted');
  assert.equal(item.nextAction, '已签约，无需继续推进');
  assert.equal(item.metaLabel, '已签约');
  assert.equal(item.statusBadge, '已签约');
  assert.equal(item.action, 'appointment');
  assert.equal(item.canRebook, false);
  assert.equal(item.canBookAppointment, false);
  assert.equal(item.canContinueSurvey, false);
});

test('enterprise operations format growth and exception cards from real workbench facts', () => {
  assert.equal(formatGrowthDetail(128, 111), '↑ 15% 较上期');
  assert.equal(formatGrowthDetail(0, 0), '暂无环比');

  const pending = buildEnterprisePendingExceptionItem({
    id: 11n,
    name: '802',
    communityName: '万科 · 未来之光',
    status: 'new',
    assignmentErrorCode: '目标区域暂无可用测量员',
    updatedAt: new Date('2026-08-20T09:30:00.000Z'),
  });
  assert.match(pending.title, /自动派单失败 · 万科 · 未来之光 · 802/);
  assert.equal(pending.actionLabel, '去指派');
  assert.equal(pending.exceptionTone, 'red');

  const expired = buildEnterpriseExpiredExceptionItem({
    id: 12n,
    name: '301',
    communityName: '保利 · 天汇',
    status: 'measuring',
    updatedAt: new Date('2026-08-19T08:00:00.000Z'),
  }, { id: 99n, leadId: 12n });
  assert.match(expired.title, /预约过期未改期 · 保利 · 天汇 · 301/);
  assert.equal(expired.actionLabel, '查看详情');
  assert.equal(expired.exceptionTone, 'orange');

  const staffing = buildEnterpriseStaffingExceptionItem(buildStaffingGapItems({
    eligibleDesignerCount: 1,
    eligibleMeasurerCount: 0,
  })[0]);
  assert.equal(staffing.actionLabel, '查看详情');
  assert.equal(buildStaffLoadQuickNav({ eligibleDesignerCount: 1, eligibleMeasurerCount: 0 }).desc, '测量员紧缺 →');
});

test('enterprise staff roster items expose assignment eligibility without Admin DTO fields', () => {
  const eligibleDesigner = buildEnterpriseStaffRosterItem({
    id: 21n,
    displayName: '林设计师',
    phone: '13800001111',
    role: 'designer',
    status: 'active',
    assignmentPaused: false,
    wechatId: 'wx-lin',
    wechatQrAssetId: 9n,
  });
  assert.deepEqual(eligibleDesigner, {
    id: '21',
    displayName: '林设计师',
    phone: '13800001111',
    role: 'designer',
    roleLabel: '设计师',
    assignmentPaused: false,
    assignmentEligible: true,
    ineligibleReason: null,
    statusLabel: '可派单',
    statusTone: 'green',
    action: 'pause',
    actionLabel: '暂停派单',
    helperText: '',
  });
  assert.equal('username' in eligibleDesigner, false);

  const pausedMeasurer = buildEnterpriseStaffRosterItem({
    id: 22,
    displayName: '周测量',
    phone: null,
    role: 'measurer',
    status: 'active',
    assignmentPaused: true,
  });
  assert.equal(pausedMeasurer.assignmentEligible, false);
  assert.equal(pausedMeasurer.ineligibleReason, 'paused');
  assert.equal(pausedMeasurer.statusLabel, '已暂停');
  assert.equal(pausedMeasurer.statusTone, 'orange');
  assert.equal(pausedMeasurer.action, 'resume');
  assert.equal(pausedMeasurer.actionLabel, '恢复派单');

  const incompleteDesigner = buildEnterpriseStaffRosterItem({
    id: '23',
    displayName: '待补设计师',
    role: 'designer',
    status: 'active',
    assignmentPaused: false,
    wechatId: '  ',
    wechatQrAssetId: null,
  });
  assert.equal(incompleteDesigner.ineligibleReason, 'designer_wechat_incomplete');
  assert.equal(incompleteDesigner.statusLabel, '待补微信资料');
  assert.equal(incompleteDesigner.action, null);
  assert.equal(incompleteDesigner.actionLabel, '');
  assert.match(incompleteDesigner.helperText, /我的/);

  const pausedIncompleteDesigner = buildEnterpriseStaffRosterItem({
    id: 24n,
    displayName: '双缺设计师',
    role: 'designer',
    status: 'active',
    assignmentPaused: true,
    wechatId: '',
  });
  assert.equal(pausedIncompleteDesigner.ineligibleReason, 'paused');
  assert.equal(pausedIncompleteDesigner.action, 'resume');
});

test('enterprise staff roster role query defaults to designer and measurer', () => {
  assert.deepEqual(parseEnterpriseStaffRosterRoles(null), ['designer', 'measurer']);
  assert.deepEqual(parseEnterpriseStaffRosterRoles('designer'), ['designer']);
  assert.deepEqual(parseEnterpriseStaffRosterRoles('measurer'), ['measurer']);
  assert.throws(() => parseEnterpriseStaffRosterRoles('salesperson'), /role/);
});

test('workbench period helpers resolve Shanghai week/month/year and custom inclusive ranges', () => {
  const now = new Date('2026-08-20T04:00:00.000Z'); // Shanghai 2026-08-20 12:00
  const month = resolveWorkbenchPeriod({ period: 'month', now });
  assert.equal(month.kind, 'month');
  assert.equal(month.label, '本月');
  assert.equal(month.start.toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(month.end.toISOString(), '2026-08-31T16:00:00.000Z');

  const week = shanghaiWeekRange(now);
  assert.equal(week.start.toISOString(), '2026-08-16T16:00:00.000Z'); // Monday 00:00 Shanghai
  assert.equal(week.end.toISOString(), '2026-08-23T16:00:00.000Z');

  const year = resolveWorkbenchPeriod({ period: 'year', now });
  assert.equal(year.start.toISOString(), '2025-12-31T16:00:00.000Z');
  assert.equal(year.end.toISOString(), '2026-12-31T16:00:00.000Z');

  const custom = resolveWorkbenchPeriod({
    period: 'custom',
    from: '2026-08-01',
    to: '2026-08-20',
    now,
  });
  assert.equal(custom.kind, 'custom');
  assert.equal(custom.fromDate, '2026-08-01');
  assert.equal(custom.toDate, '2026-08-20');
  assert.equal(custom.start.toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(custom.end.toISOString(), '2026-08-20T16:00:00.000Z');

  assert.throws(
    () => resolveWorkbenchPeriod({ period: 'custom', from: '2026-08-20', to: '2026-08-01' }),
    /起止日期/
  );

  const previousMonth = previousComparablePeriodRange(month);
  assert.equal(previousMonth.start.toISOString(), '2026-06-30T16:00:00.000Z');
  assert.equal(previousMonth.end.toISOString(), '2026-07-31T16:00:00.000Z');
});

test('signing rate uses same-window new leads and is null when the denominator is zero', () => {
  assert.equal(computeSigningRate(36, 128), 28.1);
  assert.equal(computeSigningRate(0, 0), null);
  assert.equal(computeSigningRate(5, 0), null);
  assert.equal(formatSigningRateDetail(5, 0), '暂无新增线索');
  assert.equal(formatSigningRateDetail(9, 42), '已签约 ÷ 新增线索');

  const emptyDenom = buildOpsDashboardCards({
    newLeadCount: 0,
    previousLeadCount: 0,
    completedSurveys: 0,
    draftFormalPlans: 0,
    schemeDeliveryRate: 0,
    schemeDeliveryDetail: '暂无交付用时',
    signedCount: 2,
    includeContractAmount: false,
  });
  assert.equal(emptyDenom.signingRate, null);
  assert.equal(emptyDenom.cards.find((card) => card.key === 'signingRate')?.value, '—');
  assert.equal(emptyDenom.cards.find((card) => card.key === 'signingRate')?.detail, '暂无新增线索');

  const withAmount = buildOpsDashboardCards({
    newLeadCount: 128,
    previousLeadCount: 111,
    completedSurveys: 94,
    draftFormalPlans: 1,
    schemeDeliveryRate: 88,
    schemeDeliveryDetail: '平均用时 1.2 天',
    signedCount: 36,
    contractAmountSum: 2860000,
    includeContractAmount: true,
  });
  assert.equal(withAmount.signingRate, 28.1);
  assert.equal(withAmount.cards.length, 5);
  assert.equal(withAmount.cards.find((card) => card.key === 'signedCount')?.detail, '签约金额 ¥286万');
  assert.equal(buildOpsDashboardSubtitle('enterprise', '本月'), '全店 · 本月');
  assert.equal(buildOpsDashboardSubtitle('personal', '本月'), '我的 · 本月');
  assert.equal(
    buildOpsDashboardSubtitle('enterprise', '2026-08-01 ~ 2026-08-20'),
    '全店 · 2026-08-01 ~ 2026-08-20'
  );
});

test('enterprise hero pending-delivery pill counts unpublished designing leads', () => {
  const summary = buildEnterpriseOverviewSummary({
    pendingAssignmentCount: 1,
    pendingSurveyCount: 2,
    pendingDeliveryCount: 7,
  });
  const pendingDelivery = summary.find((item) => item.key === 'pendingDelivery');
  assert.equal(pendingDelivery?.label, '待交付');
  assert.equal(pendingDelivery?.value, 7);
  assert.equal(pendingDelivery?.detail, '量房已完成，待发布方案');
  assert.equal(summary.find((item) => item.key === 'delivered'), undefined);
});
