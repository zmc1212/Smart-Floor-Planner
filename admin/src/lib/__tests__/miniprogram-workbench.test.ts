import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildDesignerWechatProfileTodo,
  buildEnterpriseExpiredExceptionItem,
  buildEnterpriseOverviewSummary,
  buildEnterprisePendingExceptionItem,
  buildEnterpriseReferrerRosterItem,
  buildEnterpriseStaffRosterItem,
  buildEnterpriseStaffingExceptionItem,
  buildContractAmountTrend,
  buildOpsDashboardCards,
  parseEnterpriseReferrerRosterStatus,
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
  indexWorkbenchRowsById,
  isAssignmentEligibleStaff,
  isMeasurerWorkbenchSurveyLead,
  isTerminalWorkbenchLead,
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
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(surveyLead({
    archivedAt: new Date('2026-08-20T00:00:00.000Z'),
  }), { status: 'confirmed' }), false);
  assert.equal(shouldIncludeMeasurerWorkbenchAppointment(undefined, { status: 'expired' }), false);
  assert.equal(isTerminalWorkbenchLead(null), true);
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

test('archived or missing leads on the appointment schedule stay closed instead of looking bookable', () => {
  const archived = buildWorkbenchAppointmentItem({
    id: 99n,
    leadId: 11n,
    address: '西湖路32号',
    timeRange: '["2026-08-27T01:00:00.000Z","2026-08-27T03:00:00.000Z")',
    status: 'confirmed',
  }, surveyLead({
    name: '已归档客户',
    status: 'new',
    archivedAt: new Date('2026-08-20T00:00:00.000Z'),
  }));
  assert.equal(archived.title, '已归档客户');
  assert.equal(archived.serviceStage, 'closed');
  assert.equal(archived.statusBadge, '已关闭');
  assert.equal(archived.canRebook, false);
  assert.equal(archived.canBookAppointment, false);

  const missing = buildWorkbenchAppointmentItem({
    id: 100n,
    leadId: 77n,
    address: '西湖路32号',
    timeRange: '["2026-08-27T01:00:00.000Z","2026-08-27T03:00:00.000Z")',
    status: 'confirmed',
  }, null);
  assert.equal(missing.title, '客户量房');
  assert.equal(missing.serviceStage, 'closed');
  assert.equal(missing.nextAction, '该线索已关闭');
  assert.equal(missing.statusBadge, '已关闭');

  const byString = indexWorkbenchRowsById([{ id: 11n, name: 'joined' }]);
  assert.equal(byString.get('11')?.name, 'joined');
  assert.equal(byString.get(11 as unknown as string), undefined);
});

test('enterprise operations format growth and exception cards from real workbench facts', () => {
  assert.equal(formatGrowthDetail(128, 111), '↑ 15% 较上期');
  assert.equal(formatGrowthDetail(0, 0), '暂无环比');

  const pending = buildEnterprisePendingExceptionItem({
    id: 11n,
    name: '802',
    communityName: '万科 · 未来之光',
    status: 'new',
    assignmentErrorCode: '目标区域暂无可用家装现场顾问',
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
  assert.equal(buildStaffLoadQuickNav({ eligibleDesignerCount: 1, eligibleMeasurerCount: 0 }).desc, '家装现场顾问紧缺 →');
});

test('enterprise staff roster items expose assignment eligibility without Admin DTO fields', () => {
  const eligibleDesigner = buildEnterpriseStaffRosterItem({
    id: 21n,
    displayName: '林家装设计顾问',
    phone: '13800001111',
    role: 'designer',
    status: 'active',
    assignmentPaused: false,
    wechatId: 'wx-lin',
    wechatQrAssetId: 9n,
  });
  assert.deepEqual(eligibleDesigner, {
    id: '21',
    displayName: '林家装设计顾问',
    phone: '13800001111',
    role: 'designer',
    roleLabel: '家装设计顾问',
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
    displayName: '待补家装设计顾问',
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
    displayName: '双缺家装设计顾问',
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

test('enterprise referrer roster items expose disable action only while active', () => {
  const joinedAt = new Date('2026-08-01T02:00:00.000Z');
  const active = buildEnterpriseReferrerRosterItem({
    id: 31n,
    displayName: '王推荐',
    phone: '13900002222',
    status: 'active',
    joinedAt,
    hasActivePromotionCode: true,
  });
  assert.deepEqual({
    id: active.id,
    displayName: active.displayName,
    phone: active.phone,
    status: active.status,
    hasActivePromotionCode: active.hasActivePromotionCode,
    statusLabel: active.statusLabel,
    statusTone: active.statusTone,
    helperText: active.helperText,
    action: active.action,
    actionLabel: active.actionLabel,
  }, {
    id: '31',
    displayName: '王推荐',
    phone: '13900002222',
    status: 'active',
    hasActivePromotionCode: true,
    statusLabel: '活动',
    statusTone: 'green',
    helperText: '可出示活动推广码',
    action: 'disable',
    actionLabel: '停用后续扫码',
  });
  assert.equal(active.joinedAt, joinedAt);
  assert.match(active.joinedAtLabel, /2026/);

  const disabled = buildEnterpriseReferrerRosterItem({
    id: 32,
    displayName: '',
    phone: '13800003333',
    status: 'disabled',
    hasActivePromotionCode: false,
  });
  assert.equal(disabled.displayName, '13800003333');
  assert.equal(disabled.statusLabel, '已停用');
  assert.equal(disabled.statusTone, 'orange');
  assert.equal(disabled.action, null);
  assert.equal(disabled.actionLabel, '');
  assert.equal(disabled.helperText, '已停用后续扫码');

  const exited = buildEnterpriseReferrerRosterItem({
    id: '33',
    displayName: '  ',
    status: 'exited',
  });
  assert.equal(exited.displayName, '未命名推荐人');
  assert.equal(exited.statusLabel, '已退出');
  assert.equal(exited.helperText, '已退出本店');
  assert.equal(exited.hasActivePromotionCode, false);

  assert.equal(parseEnterpriseReferrerRosterStatus(null), undefined);
  assert.equal(parseEnterpriseReferrerRosterStatus('active'), 'active');
  assert.equal(parseEnterpriseReferrerRosterStatus('disabled'), 'disabled');
  assert.equal(parseEnterpriseReferrerRosterStatus('exited'), 'exited');
  assert.throws(() => parseEnterpriseReferrerRosterStatus('paused'), /成员状态无效/);
});

test('workbench period helpers resolve Shanghai week/month/year and custom inclusive ranges', () => {
  const now = new Date('2026-08-20T04:00:00.000Z'); // Shanghai 2026-08-20 12:00
  const month = resolveWorkbenchPeriod({ period: 'month', now });
  assert.equal(month.kind, 'month');
  assert.equal(month.label, '本月');
  assert.equal(month.fromDate, '2026-08-01');
  assert.equal(month.toDate, '2026-08-31');
  assert.equal(month.start.toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(month.end.toISOString(), '2026-08-31T16:00:00.000Z');

  const week = shanghaiWeekRange(now);
  assert.equal(week.start.toISOString(), '2026-08-16T16:00:00.000Z'); // Monday 00:00 Shanghai
  assert.equal(week.end.toISOString(), '2026-08-23T16:00:00.000Z');
  const weekPeriod = resolveWorkbenchPeriod({ period: 'week', now });
  assert.equal(weekPeriod.fromDate, '2026-08-17');
  assert.equal(weekPeriod.toDate, '2026-08-23');

  const year = resolveWorkbenchPeriod({ period: 'year', now });
  assert.equal(year.start.toISOString(), '2025-12-31T16:00:00.000Z');
  assert.equal(year.end.toISOString(), '2026-12-31T16:00:00.000Z');
  assert.equal(year.fromDate, '2026-01-01');
  assert.equal(year.toDate, '2026-12-31');

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
    publishedSchemeCount: 0,
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
    publishedSchemeCount: 82,
    schemeDeliveryRate: 88,
    schemeDeliveryDetail: '平均用时 1.2 天',
    signedCount: 36,
    contractAmountSum: 2860000,
    includeContractAmount: true,
  });
  assert.equal(withAmount.signingRate, 28.1);
  assert.equal(withAmount.cards.length, 5);
  assert.equal(withAmount.cards.find((card) => card.key === 'completedSurveys')?.detail, '已发布方案 82 份');
  assert.equal(withAmount.cards.find((card) => card.key === 'signedCount')?.detail, '签约金额 ¥286万');
  assert.equal(buildOpsDashboardSubtitle('enterprise', '本月'), '全店 · 本月');
  assert.equal(buildOpsDashboardSubtitle('personal', '本月'), '我的 · 本月');
  assert.equal(
    buildOpsDashboardSubtitle('enterprise', '2026-08-01 ~ 2026-08-20'),
    '全店 · 2026-08-01 ~ 2026-08-20'
  );
});

test('contract amount trend fills Shanghai daily buckets and aligns the previous period', () => {
  const period = resolveWorkbenchPeriod({
    period: 'custom',
    from: '2026-08-01',
    to: '2026-08-03',
    now: new Date('2026-08-20T04:00:00.000Z'),
  });
  const previous = previousComparablePeriodRange(period);
  const trend = buildContractAmountTrend({
    period,
    previous,
    granularity: 'day',
    currentRows: [
      { bucket: '2026-08-01', value: 128000 },
      { bucket: '2026-08-03', value: 50000 },
    ],
    previousRows: [
      { bucket: '2026-07-29', value: 88000 },
    ],
  });
  assert.deepEqual(trend.labels, ['8/1', '8/2', '8/3']);
  assert.deepEqual(trend.current, [128000, 0, 50000]);
  assert.deepEqual(trend.previous, [88000, 0, 0]);
  assert.equal(trend.hasData, true);
  assert.equal(trend.unit, '万元');
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

test('professional workbenches expose role-scoped acquisition entries', () => {
  const route = readFileSync(
    path.join(process.cwd(), 'src/app/api/miniprogram/workbench/route.ts'),
    'utf8'
  );
  assert.match(route, /function acquisitionEntries\(role: WorkbenchRole\)/);
  assert.match(route, /label: '分享活动码'/);
  assert.match(route, /detail: isOwner \? '员工 · 推荐人' : '仅推荐人'/);
  assert.match(route, /label: isOwner \? '查看推广人' : '我的推广人'/);
  assert.match(route, /detail: isOwner \? '全店推广网络' : '仅查看本人网络'/);
  assert.equal((route.match(/\.\.\.acquisitionEntries\(role\)/g) || []).length, 3);
  assert.match(route, /findByIds\(scheduleRows\.map\(\(item\) => item\.leadId\), \{ includeArchived: true \}\)/);
  assert.match(route, /appointmentLeadMap\.get\(String\(item\.leadId\)\)/);
  assert.match(route, /includeArchived: true/);
  assert.match(route, /searchParams.get\('schedule'\) === '1'/);
  assert.match(route, /listByEnterprise\([\s\S]*scheduleRequested \? \{ start: period\.start, end: period\.end \}/);
  assert.match(route, /自定义周期不能超过 366 天/);
});

test('enterprise appointment schedule queries overlap the selected period', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/db/repositories/appointment-repository.ts'),
    'utf8'
  );
  assert.match(source, /async listByEnterprise\(/);
  assert.match(source, /overlap\?: \{ start: Date; end: Date \}/);
  assert.match(source, /timeRange\} && \$\{range\(overlap\.start, overlap\.end\)\}::tstzrange/);
  assert.match(source, /overlap \? 500 : 50/);
});
