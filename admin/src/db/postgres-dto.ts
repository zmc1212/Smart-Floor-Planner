import type {
  AdminUserRecord,
  AiChatSessionRecord,
  CommissionWithRelations,
  AdminUserWithRelations,
  DepartmentRecord,
  DeviceWithRelations,
  EnterpriseRecord,
  EnterpriseOrderWithRelations,
  FloorPlanRecord,
  FloorPlanWithCreator,
  LeadWithRelations,
  MeasurementWithRelations,
  PackageRecord,
  PromotionRecordWithRelations,
  UserRecord,
  WorkflowNotificationWithRelations,
  StaffNotificationWithLead,
} from '@/db/repositories';
import { getFloorPlanDisplay, type FloorPlanDisplayLead } from '@/lib/floor-plan-display';
import { canRebookAppointment, resolveLeadServiceStage } from '@/lib/lead-service-stage';
import { isFormalSurveyLayout, parseFormalSurveyLayout } from '@/lib/survey-graph';

export function aiChatSessionSummaryToDto(record: AiChatSessionRecord) {
  return {
    _id: record.id.toString(),
    title: record.title,
    lastMessageAt: record.lastMessageAt,
    createdAt: record.createdAt,
  };
}

export function aiChatSessionToDto(record: AiChatSessionRecord) {
  return {
    ...aiChatSessionSummaryToDto(record),
    id: record.id.toString(),
    enterpriseId: record.enterpriseId.toString(),
    adminId: record.adminId.toString(),
    messages: record.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.uiPayload === undefined ? {} : { uiPayload: message.uiPayload }),
      createdAt: message.createdAt,
    })),
    updatedAt: record.updatedAt,
  };
}

export function enterpriseOrderToDto(record: EnterpriseOrderWithRelations) {
  return {
    _id: record.id.toString(), enterpriseId: record.enterpriseId?.toString() ?? null,
    recordId: record.record ? { _id: record.record.id.toString(), enterpriseName: record.record.enterpriseName, businessStage: record.record.businessStage, promoterId: record.record.promoterId?.toString() ?? null } : record.recordId.toString(),
    enterpriseNameSnapshot: record.enterpriseNameSnapshot, packageName: record.packageName,
    amount: Number(record.amount), currency: record.currency, status: record.status, paidAt: record.paidAt,
    createdBy: record.createdByUser ? { _id: record.createdByUser.id.toString(), displayName: record.createdByUser.displayName, username: record.createdByUser.username, role: record.createdByUser.role } : record.createdBy?.toString() ?? null,
    remark: record.remark, createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}

export function commissionToDto(record: CommissionWithRelations) {
  return {
    _id: record.id.toString(), recordId: record.record ? { _id: record.record.id.toString(), enterpriseName: record.record.enterpriseName, contactPerson: record.record.contactPerson } : record.recordId.toString(),
    orderId: record.order ? { _id: record.order.id.toString(), packageName: record.order.packageName, amount: Number(record.order.amount), status: record.order.status } : record.orderId.toString(),
    promoterId: record.promoter ? { _id: record.promoter.id.toString(), displayName: record.promoter.displayName, username: record.promoter.username, role: record.promoter.role } : record.promoterId.toString(),
    enterpriseId: record.enterpriseId?.toString() ?? null, commissionType: record.commissionType,
    commissionAmount: Number(record.commissionAmount), status: record.status, generatedAt: record.generatedAt,
    settledAt: record.settledAt, settledBy: record.settledBy?.toString() ?? null,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}

export function staffNotificationToDto(record: StaffNotificationWithLead) {
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterpriseId?.toString() ?? null,
    recipientStaffId: record.recipientStaffId?.toString() ?? null,
    leadId: record.lead ? { _id: record.lead.id.toString(), name: record.lead.name, communityName: record.lead.communityName, status: record.lead.status } : record.leadId?.toString() ?? null,
    notificationType: record.notificationType,
    channel: record.channel,
    status: record.status,
    message: record.message,
    errorMessage: record.errorMessage,
    metadata: record.metadata,
    readAt: record.readAt,
    sentAt: record.sentAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function enterpriseToDto(record: EnterpriseRecord) {
  return {
    _id: record.id.toString(),
    name: record.name,
    code: record.code,
    status: record.status,
    registrationMode: record.registrationMode,
    contactPerson: record.contactPerson,
    address: record.address,
    industry: record.industry,
    description: record.description,
    logo: record.logo,
    branding: record.branding,
    groundPromotionFixedCommission: Number(
      record.groundPromotionFixedCommission
    ),
    automationConfig: record.automationConfig,
    aiConfig: record.aiConfig,
    aiPolicy: record.aiPolicy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function departmentToDto(record: DepartmentRecord) {
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterpriseId.toString(),
    parentId: record.parentId?.toString() ?? null,
    name: record.name,
    order: record.order,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function adminUserToDto(
  record:
    | (AdminUserRecord & { promoterIds?: bigint[] })
    | AdminUserWithRelations,
  options: { includePasswordHash?: boolean; populateRelations?: boolean } = {}
) {
  const withRelations = record as Partial<AdminUserWithRelations>;
  const result: Record<string, unknown> = {
    _id: record.id.toString(),
    enterpriseId:
      options.populateRelations && record.enterpriseId
        ? {
            _id: record.enterpriseId.toString(),
            name: withRelations.enterpriseName ?? '',
          }
        : record.enterpriseId?.toString() ?? null,
    departmentId:
      options.populateRelations && record.departmentId
        ? {
            _id: record.departmentId.toString(),
            name: withRelations.departmentName ?? '',
          }
        : record.departmentId?.toString() ?? null,
    promoterIds: (record.promoterIds ?? []).map((id) => id.toString()),
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    wechatId: record.wechatId,
    wechatQrAssetId: record.wechatQrAssetId?.toString() ?? null,
    openid: record.openid,
    phone: record.phone,
    menuPermissions: record.menuPermissions,
    status: record.status,
    assignmentPaused: record.assignmentPaused,
    lastLoginAt: record.lastLoginAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (options.includePasswordHash) {
    result.passwordHash = record.passwordHash;
  }
  return result;
}

export function userToDto(record: UserRecord) {
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterpriseId?.toString() ?? null,
    username: record.username,
    role: record.role,
    openid: record.openid,
    nickname: record.nickname,
    avatar: record.avatar,
    communityName: record.communityName,
    city: record.city,
    phone: record.phone,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function floorPlanToDto(
  record: FloorPlanRecord | FloorPlanWithCreator,
  options: {
    lead?: FloorPlanDisplayLead | null;
    measurementSequence?: number | null;
  } | number = {}
) {
  const withCreator = record as Partial<FloorPlanWithCreator>;
  const displayOptions = typeof options === 'number' ? {} : options;
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterpriseId?.toString() ?? null,
    creator: withCreator.creator
      ? {
          _id: withCreator.creator.id.toString(),
          nickname: withCreator.creator.nickname,
          avatar: withCreator.creator.avatar,
          openid: withCreator.creator.openid,
          communityName: withCreator.creator.communityName,
          phone: withCreator.creator.phone,
        }
      : record.creatorId.toString(),
    staffId: record.staffId?.toString() ?? null,
    name: record.name,
    display: getFloorPlanDisplay(record, displayOptions),
    leadArchivedAt: displayOptions.lead?.archivedAt ?? null,
    leadIsArchived: Boolean(displayOptions.lead?.archivedAt),
    layoutData: record.layoutData,
    source: record.source,
    externalSource: record.externalSource,
    status: record.status,
    completedAt: record.completedAt,
    previewUrl: record.previewAssetId
      ? `/api/floorplans/${record.id.toString()}/preview?v=${encodeURIComponent(record.previewRenderRevision || '0')}`
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function staffSummaryToDto(
  record: LeadWithRelations['assignedUser']
) {
  return record
    ? {
        _id: record.id.toString(),
        displayName: record.displayName,
        username: record.username,
        role: record.role,
      }
    : null;
}

export function leadToDto(record: LeadWithRelations, options: { designerWechatQrUrl?: string | null; includeDesignerWechat?: boolean } = {}) {
  const hasFormalFloorPlan = [record.primaryFloorPlanRecord, ...(record.floorPlanRecords || [])]
    .filter(Boolean)
    .some((plan) => {
      if (!plan || plan.status !== 'completed' || !isFormalSurveyLayout(plan.layoutData)) return false;
      const layout = parseFormalSurveyLayout(plan.layoutData);
      return !!layout?.surveyGraph.floors.some((floor) => (floor.spaces || []).some((space) => space.closed === true));
    });
  const serviceStage = resolveLeadServiceStage({
    leadStatus: record.status,
    assignmentStatus: record.assignmentStatus,
    measurerId: record.measurerId,
    appointment: record.appointment,
    hasFormalFloorPlan,
  });
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterpriseId?.toString() ?? null,
    promoterId:
      staffSummaryToDto(record.promoter) ?? record.promoterId?.toString() ?? null,
    referrer: record.referrer
      ? {
          _id: record.referrer.id.toString(),
          membershipId: record.referrer.membershipId.toString(),
          displayName: record.referrer.displayName,
          username: record.referrer.username,
          phone: record.referrer.phone,
          role: record.referrer.role,
        }
      : null,
    assignedTo:
      record.assignedUser
        ? {
            ...staffSummaryToDto(record.assignedUser),
            ...(options.includeDesignerWechat ? { wechatId: record.assignedUser.wechatId || null, wechatQrUrl: options.designerWechatQrUrl || null } : {}),
          }
        :
      record.assignedTo?.toString() ??
      null,
    measurerId:
      record.measurerUser
        ? staffSummaryToDto(record.measurerUser)
        : record.measurerId?.toString() ?? null,
    appointment: record.appointment
      ? {
          id: record.appointment.id.toString(),
          address: record.appointment.address,
          timeRange: record.appointment.timeRange,
          status: record.appointment.status,
          version: record.appointment.version,
          createdAt: record.appointment.createdAt,
          updatedAt: record.appointment.updatedAt,
        }
      : null,
    name: record.name,
    phone: record.phone,
    communityName: record.communityName,
    area: record.area === null ? null : Number(record.area),
    stylePreference: record.stylePreference,
    city: record.city,
    source: record.source,
    status: record.status,
    assignmentStatus: record.assignmentStatus,
    assignmentErrorCode: record.assignmentErrorCode,
    serviceStage: serviceStage.key,
    serviceStageLabel: serviceStage.label,
    nextAction: serviceStage.nextAction,
    canRebook: canRebookAppointment({
      leadStatus: record.status,
      assignmentStatus: record.assignmentStatus,
      appointment: record.appointment,
      hasFormalFloorPlan,
    }),
    convertedOn: record.convertedOn,
    convertedAt: record.convertedAt,
    convertedBy: record.convertedUser
      ? staffSummaryToDto(record.convertedUser)
      : record.convertedBy?.toString() ?? null,
    contractAmount: record.contractAmount === null ? null : Number(record.contractAmount),
    conversionNote: record.conversionNote,
    archivedAt: record.archivedAt,
    archivedBy: record.archivedUser
      ? staffSummaryToDto(record.archivedUser)
      : record.archivedBy?.toString() ?? null,
    archiveReason: record.archiveReason,
    archiveNote: record.archiveNote,
    notes: record.notes,
    assignedAt: record.assignedAt,
    floorPlanIds: record.floorPlanRecords.map((floorPlan) => floorPlanToDto(floorPlan, {
      lead: record,
      measurementSequence: floorPlan.measurementSequence,
    })),
    primaryFloorPlanId: record.primaryFloorPlanRecord
      ? floorPlanToDto(record.primaryFloorPlanRecord, {
          lead: record,
          measurementSequence: record.primaryFloorPlanRecord.measurementSequence,
        })
      : record.primaryFloorPlanId?.toString() ?? null,
    followUpRecords: record.followUpRecords,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function deviceToDto(record: DeviceWithRelations) {
  const assignedUsers = record.assignedUsers.map((assignedUser) => ({
    _id: assignedUser.id.toString(),
    displayName: assignedUser.displayName,
    username: assignedUser.username,
  }));
  return {
    _id: record.id.toString(),
    code: record.code,
    description: record.description,
    enterpriseId: record.enterprise
      ? { _id: record.enterprise.id.toString(), name: record.enterprise.name }
      : record.enterpriseId?.toString() ?? null,
    assignedUsers,
    assignedUserId: assignedUsers[0]
      ? assignedUsers[0]
      : record.assignedUserId?.toString() ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function measurementToDto(record: MeasurementWithRelations) {
  return {
    _id: record.id.toString(),
    floorPlanId: record.floorPlan
      ? {
          _id: record.floorPlan.id.toString(),
          name: record.floorPlan.name,
          status: record.floorPlan.status,
        }
      : record.floorPlanId.toString(),
    operatorId: record.operator
      ? {
          _id: record.operator.id.toString(),
          displayName: record.operator.displayName,
          username: record.operator.username,
          role: record.operator.role,
        }
      : record.operatorId?.toString() ?? null,
    enterpriseId: record.enterprise
      ? { _id: record.enterprise.id.toString(), name: record.enterprise.name }
      : record.enterpriseId?.toString() ?? null,
    roomId: record.roomId,
    roomName: record.roomName,
    deviceId: record.deviceId,
    value: Number(record.value),
    unit: record.unit,
    type: record.type,
    direction: record.direction,
    metadata: record.metadata,
    source: record.source,
    measuredAt: record.measuredAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function packageToDto(record: PackageRecord) {
  return {
    _id: record.id.toString(),
    name: record.name,
    price: Number(record.price),
    description: record.description,
    features: record.features,
    promotionCommission: Number(record.promotionCommission),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function promotionStaffToDto(
  record: PromotionRecordWithRelations['promoter']
) {
  return record
    ? {
        _id: record.id.toString(),
        displayName: record.displayName,
        username: record.username,
        role: record.role,
      }
    : null;
}

export function promotionRecordToDto(record: PromotionRecordWithRelations) {
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterprise
      ? { _id: record.enterprise.id.toString(), name: record.enterprise.name }
      : record.enterpriseId?.toString() ?? null,
    promoterId:
      promotionStaffToDto(record.promoter) ?? record.promoterId?.toString() ?? null,
    enterpriseName: record.enterpriseName,
    creditCode: record.creditCode,
    contactPerson: record.contactPerson,
    phone: record.phone,
    city: record.city,
    address: record.address,
    industry: record.industry,
    sourceChannel: record.sourceChannel,
    ownershipStatus: record.ownershipStatus,
    businessStage: record.businessStage,
    pendingActionRole: record.pendingActionRole,
    poolStatus: record.poolStatus,
    protectionExpiresAt: record.protectionExpiresAt,
    protectionExtendedCount: record.protectionExtendedCount,
    notes: record.notes,
    nextFollowUpAt: record.nextFollowUpAt,
    lastActivityAt: record.lastActivityAt,
    followUpRecords: record.followUpRecords,
    claimRequest: record.claimStatus
      ? {
          status: record.claimStatus,
          requestedBy:
            promotionStaffToDto(record.claimRequester) ??
            record.claimRequestedBy?.toString() ??
            null,
          requestedAt: record.claimRequestedAt,
          reviewedBy:
            promotionStaffToDto(record.claimReviewer) ??
            record.claimReviewedBy?.toString() ??
            null,
          reviewedAt: record.claimReviewedAt,
          rejectReason: record.claimRejectReason,
        }
      : undefined,
    measureTask: {
      status: record.measureTaskStatus,
      assignedTo:
        promotionStaffToDto(record.measureAssignee) ??
        record.measureAssignedTo?.toString() ??
        null,
      assignedAt: record.measureAssignedAt,
      acceptedAt: record.measureAcceptedAt,
      submittedAt: record.measureSubmittedAt,
      dueAt: record.measureDueAt,
      lastReminderAt: record.measureLastReminderAt,
      resultSummary: record.measureResultSummary,
    },
    designTask: {
      status: record.designTaskStatus,
      assignedTo:
        promotionStaffToDto(record.designAssignee) ??
        record.designAssignedTo?.toString() ??
        null,
      assignedAt: record.designAssignedAt,
      completedAt: record.designCompletedAt,
      dueAt: record.designDueAt,
      lastReminderAt: record.designLastReminderAt,
      latestNote: record.designLatestNote,
    },
    conflictInfo:
      record.conflictReason || record.conflictingRecordIds.length > 0
        ? {
            conflictReason: record.conflictReason,
            conflictingRecordIds: record.conflictingRecordIds.map((id) =>
              id.toString()
            ),
            reviewedBy:
              promotionStaffToDto(record.conflictReviewer) ??
              record.conflictReviewedBy?.toString() ??
              null,
            reviewedAt: record.conflictReviewedAt,
            resolution: record.conflictResolution,
          }
        : undefined,
    attachments: record.attachments,
    location: record.location,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function workflowNotificationToDto(
  record: WorkflowNotificationWithRelations
) {
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterpriseId?.toString() ?? null,
    recordId: record.record
      ? {
          _id: record.record.id.toString(),
          enterpriseName: record.record.enterpriseName,
          contactPerson: record.record.contactPerson,
          businessStage: record.record.businessStage,
          ownershipStatus: record.record.ownershipStatus,
        }
      : record.recordId.toString(),
    recipientStaffId: record.recipientStaff
      ? {
          _id: record.recipientStaff.id.toString(),
          displayName: record.recipientStaff.displayName,
          role: record.recipientStaff.role,
        }
      : record.recipientStaffId?.toString() ?? null,
    recipientRole: record.recipientRole,
    channel: record.channel,
    notificationType: record.notificationType,
    status: record.status,
    dedupeKey: record.dedupeKey,
    message: record.message,
    errorMessage: record.errorMessage,
    metadata: record.metadata,
    isRead: record.isRead,
    isAlerted: record.isAlerted,
    sentAt: record.sentAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function parsePostgresId(value: unknown, field = 'id') {
  const normalized = String(value ?? '');
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${field} must be a positive PostgreSQL bigint`);
  }
  return BigInt(normalized);
}

export function parseOptionalPostgresId(
  value: unknown,
  field: string
): bigint | null {
  if (value === undefined || value === null || value === '' || value === 'none') {
    return null;
  }
  return parsePostgresId(value, field);
}
