import type {
  AdminUserRecord,
  AdminUserWithRelations,
  DepartmentRecord,
  DeviceWithRelations,
  EnterpriseRecord,
  FloorPlanRecord,
  FloorPlanWithCreator,
  LeadWithRelations,
  MeasurementWithRelations,
  UserRecord,
} from '@/db/repositories';

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
    wecomUserId: record.wecomUserId,
    openid: record.openid,
    phone: record.phone,
    menuPermissions: record.menuPermissions,
    status: record.status,
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
  record: FloorPlanRecord | FloorPlanWithCreator
) {
  const withCreator = record as Partial<FloorPlanWithCreator>;
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
    layoutData: record.layoutData,
    source: record.source,
    externalSource: record.externalSource,
    status: record.status,
    completedAt: record.completedAt,
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

export function leadToDto(record: LeadWithRelations) {
  return {
    _id: record.id.toString(),
    enterpriseId: record.enterpriseId?.toString() ?? null,
    promoterId:
      staffSummaryToDto(record.promoter) ?? record.promoterId?.toString() ?? null,
    assignedTo:
      staffSummaryToDto(record.assignedUser) ??
      record.assignedTo?.toString() ??
      null,
    name: record.name,
    phone: record.phone,
    communityName: record.communityName,
    area: record.area === null ? null : Number(record.area),
    stylePreference: record.stylePreference,
    city: record.city,
    source: record.source,
    status: record.status,
    notes: record.notes,
    assignedAt: record.assignedAt,
    floorPlanIds: record.floorPlanRecords.map(floorPlanToDto),
    primaryFloorPlanId: record.primaryFloorPlanRecord
      ? floorPlanToDto(record.primaryFloorPlanRecord)
      : record.primaryFloorPlanId?.toString() ?? null,
    followUpRecords: record.followUpRecords,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function deviceToDto(record: DeviceWithRelations) {
  return {
    _id: record.id.toString(),
    code: record.code,
    description: record.description,
    enterpriseId: record.enterprise
      ? { _id: record.enterprise.id.toString(), name: record.enterprise.name }
      : record.enterpriseId?.toString() ?? null,
    assignedUserId: record.assignedUser
      ? {
          _id: record.assignedUser.id.toString(),
          displayName: record.assignedUser.displayName,
          username: record.assignedUser.username,
        }
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
