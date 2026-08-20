import { eq } from 'drizzle-orm';
import {
  AdminUserRepository,
  EnterpriseRepository,
  PromotionRecordRepository,
  type NewPromotionRecord,
  type PromotionRecord,
  type PromotionRecordUpdate,
  type PromotionRecordWithRelations,
  type PromotionTimelineEntry,
} from '@/db/repositories';
import { promotionEnterpriseRecords } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  getPlatformPromotionConfig,
  type PlatformPromotionConfig,
} from '@/lib/platform-promotion-config';

export interface PromotionRouteActor {
  id: bigint;
  role: string;
  name: string;
  enterpriseId: bigint | null;
}

export interface PromotionNotificationJob {
  notificationType:
    | 'follow_up_created'
    | 'measure_assigned'
    | 'measure_submitted'
    | 'design_assigned'
    | 'design_completed'
    | 'conflict_pending'
    | 'follow_up_overdue';
  recipientRoles: string[];
  message: string;
  dedupeSuffix: string;
}

const BUSINESS_STAGES = new Set([
  'reported',
  'contacted',
  'measuring',
  'designing',
  'quoted',
  'paid',
  'closed_lost',
]);

const MEASURE_STATUSES = new Set(['unassigned', 'assigned', 'accepted', 'submitted']);
const DESIGN_STATUSES = new Set(['unassigned', 'assigned', 'in_progress', 'completed']);
function isPlatformRole(role: string) {
  return role === 'admin' || role === 'super_admin';
}

export function promotionActorFromContext(input: {
  id: unknown;
  role: string;
  name?: string | null;
  enterpriseId?: unknown;
}): PromotionRouteActor {
  return {
    id: parsePostgresId(input.id, 'userId'),
    role: input.role,
    name: input.name?.trim() || 'System',
    enterpriseId:
      input.enterpriseId === undefined || input.enterpriseId === null || input.enterpriseId === ''
        ? null
        : parsePostgresId(input.enterpriseId, 'enterpriseId'),
  };
}

function asOptionalId(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  return parsePostgresId(value, field);
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function asDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}

function timelineEntry(input: {
  content: string;
  type: string;
  actor?: PromotionRouteActor;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}): PromotionTimelineEntry {
  return {
    content: input.content,
    type: input.type,
    operator: input.actor?.name || 'System',
    operatorId: input.actor?.id.toString(),
    operatorRole: input.actor?.role || 'system',
    metadata: input.metadata,
    createdAt: input.createdAt,
  };
}

function buildNextFollowUpAt(base: Date, config: Record<string, unknown> | null | undefined) {
  const hours = Number(config?.followUpSlaHours ?? 24);
  return new Date(base.getTime() + Math.max(1, hours) * 60 * 60 * 1000);
}

function buildMeasureDueAt(base: Date, config: Record<string, unknown> | null | undefined) {
  const hours = Number(config?.measureTaskSlaHours ?? 48);
  return new Date(base.getTime() + Math.max(1, hours) * 60 * 60 * 1000);
}

function buildDesignDueAt(base: Date, config: Record<string, unknown> | null | undefined) {
  const hours = Number(config?.designTaskSlaHours ?? 72);
  return new Date(base.getTime() + Math.max(1, hours) * 60 * 60 * 1000);
}

function automationConfig(value: Record<string, unknown> | null | undefined) {
  return {
    followUpSlaHours: Number(value?.followUpSlaHours ?? 24),
    measureTaskSlaHours: Number(value?.measureTaskSlaHours ?? 48),
    designTaskSlaHours: Number(value?.designTaskSlaHours ?? 72),
    reminderIntervalHours: Number(value?.reminderIntervalHours ?? 24),
    maxReminderTimes: Number(value?.maxReminderTimes ?? 3),
    miniprogramNotificationEnabled: value?.miniprogramNotificationEnabled !== false,
  };
}

async function getEnterprise(
  transaction: PostgresTransaction,
  enterpriseId: bigint | null
) {
  return enterpriseId
    ? new EnterpriseRepository(transaction).findById(enterpriseId)
    : null;
}

async function requireActiveStaff(
  transaction: PostgresTransaction,
  id: bigint,
  role: string,
  field = 'staffId'
) {
  const staff = await new AdminUserRepository(transaction).findById(id);
  if (!staff || staff.status !== 'active' || staff.role !== role) {
    throw new Error(`Active ${role} ${field} not found`);
  }
  return staff;
}

async function resolveEnterpriseId(
  actor: PromotionRouteActor,
  body: Record<string, unknown>
) {
  const requested = asOptionalId(body.enterpriseId, 'enterpriseId');
  if (isPlatformRole(actor.role)) return requested ?? actor.enterpriseId;
  if (!actor.enterpriseId && actor.role === 'salesperson') {
    // Platform salespeople report prospects before they belong to a customer tenant.
    return null;
  }
  if (!actor.enterpriseId) throw new Error('Enterprise context is required');
  if (requested && requested !== actor.enterpriseId) {
    throw new Error('Enterprise context does not match the request');
  }
  return actor.enterpriseId;
}

async function resolvePromoter(
  transaction: PostgresTransaction,
  actor: PromotionRouteActor,
  body: Record<string, unknown>,
  enterpriseId: bigint | null
) {
  const requested = asOptionalId(body.promoterId, 'promoterId');
  const promoterId = requested ?? (actor.role === 'salesperson' ? actor.id : null);
  if (!promoterId) throw new Error('promoterId is required');
  const promoter = await requireActiveStaff(transaction, promoterId, 'salesperson', 'promoterId');
  if (enterpriseId && promoter.enterpriseId !== enterpriseId) {
    throw new Error('Promoter does not belong to the selected enterprise');
  }
  return promoter;
}

function promotionUpdateValues(input: Record<string, unknown>) {
  return input as PromotionRecordUpdate;
}

export function buildPromotionListOptions(
  searchParams: URLSearchParams,
  actor?: { id: bigint; role: string }
) {
  const page = Number(searchParams.get('page') || 1);
  const limit = Number(searchParams.get('limit') || 50);
  const poolStatus = searchParams.get('poolStatus');
  return {
    actor,
    businessStage: searchParams.get('businessStage') || undefined,
    ownershipStatus: searchParams.get('ownershipStatus') || undefined,
    poolStatuses:
      poolStatus && poolStatus !== 'all' ? poolStatus.split(',').filter(Boolean) : undefined,
    pendingActionRole: searchParams.get('pendingActionRole') || undefined,
    search: searchParams.get('search') || undefined,
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 50,
  };
}

export async function listPromotionRecords(
  transaction: PostgresTransaction,
  options: Parameters<PromotionRecordRepository['list']>[0] = {}
) {
  return new PromotionRecordRepository(transaction).list(options);
}

export async function findPromotionRecord(
  transaction: PostgresTransaction,
  id: unknown,
  actor?: { id: bigint; role: string }
) {
  return new PromotionRecordRepository(transaction).findById(
    parsePostgresId(id, 'recordId'),
    actor
  );
}

export async function createPromotionRecord(
  transaction: PostgresTransaction,
  body: Record<string, unknown>,
  actor: PromotionRouteActor
) {
  const enterpriseName = asString(body.enterpriseName);
  const contactPerson = asString(body.contactPerson);
  const phone = asString(body.phone);
  if (!enterpriseName || !contactPerson || !phone) {
    throw new Error('Missing required fields');
  }

  const enterpriseId = await resolveEnterpriseId(actor, body);
  const promoter = await resolvePromoter(transaction, actor, body, enterpriseId);
  const enterprise = await getEnterprise(transaction, enterpriseId);
  const enterpriseAutomation = automationConfig(enterprise?.automationConfig);
  const config = await getPlatformPromotionConfig();
  const repository = new PromotionRecordRepository(transaction);
  const creditCode = asString(body.creditCode).toUpperCase() || null;
  const duplicateRows = await repository.findDuplicates({
    creditCode,
    enterpriseName,
    phone,
  });
  const conflictingRecords = duplicateRows.filter(
    (item) => item.promoterId !== promoter.id
  );
  const sameOwnerRecord = duplicateRows.find((item) => item.promoterId === promoter.id);
  const now = new Date();

  if (sameOwnerRecord && conflictingRecords.length === 0) {
    const updated = await repository.update(sameOwnerRecord.id, {
      enterpriseId,
      promoterId: promoter.id,
      enterpriseName,
      creditCode,
      contactPerson,
      phone,
      city: asString(body.city) || null,
      address: asString(body.address) || null,
      industry: asString(body.industry) || null,
      notes: asString(body.notes) || sameOwnerRecord.notes,
      attachments: Array.isArray(body.attachments)
        ? asStringArray(body.attachments)
        : sameOwnerRecord.attachments,
      location: (body.location as Record<string, unknown> | null | undefined) ?? sameOwnerRecord.location,
      lastActivityAt: now,
      pendingActionRole:
        sameOwnerRecord.ownershipStatus === 'conflict_pending' ? 'enterprise_admin' : 'salesperson',
      nextFollowUpAt:
        sameOwnerRecord.ownershipStatus === 'conflict_pending'
          ? null
          : sameOwnerRecord.nextFollowUpAt || buildNextFollowUpAt(now, enterpriseAutomation),
    });
    return { record: updated ?? null, created: false, notificationJobs: [] };
  }

  const protectionExpiresAt = new Date(
    now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000
  );
  const isConflict = conflictingRecords.length > 0;
  const values: NewPromotionRecord = {
    enterpriseId,
    promoterId: promoter.id,
    enterpriseName,
    creditCode,
    contactPerson,
    phone,
    city: asString(body.city) || null,
    address: asString(body.address) || null,
    industry: asString(body.industry) || null,
    sourceChannel: 'ground_promotion',
    ownershipStatus: isConflict ? 'conflict_pending' : 'auto_locked',
    businessStage: 'reported',
    pendingActionRole: isConflict ? 'enterprise_admin' : 'salesperson',
    poolStatus: 'protected',
    protectionExpiresAt: isConflict ? null : protectionExpiresAt,
    protectionExtendedCount: 0,
    notes: asString(body.notes) || null,
    nextFollowUpAt: isConflict ? null : buildNextFollowUpAt(now, enterpriseAutomation),
    lastActivityAt: now,
    followUpRecords: [
      timelineEntry({
        type: 'report_created',
        content: '已创建企业报备',
        actor,
        createdAt: now,
      }),
      ...(asString(body.notes)
        ? [
            timelineEntry({
              type: 'note',
              content: asString(body.notes),
              actor,
              createdAt: now,
            }),
          ]
        : []),
    ],
    claimStatus: null,
    measureTaskStatus: 'unassigned',
    designTaskStatus: 'unassigned',
    conflictReason: isConflict ? 'duplicate_report' : null,
    conflictingRecordIds: conflictingRecords.map((item) => item.id),
    attachments: asStringArray(body.attachments),
    location: body.location as Record<string, unknown> | undefined,
  };
  const created = await repository.create(values);
  if (!created) throw new Error('Promotion report was not created');
  return {
    record: created,
    created: true,
    notificationJobs: [
      {
        notificationType: isConflict ? 'conflict_pending' : 'follow_up_created',
        recipientRoles: isConflict ? ['enterprise_admin'] : ['salesperson', 'admin', 'super_admin'],
        message: isConflict
          ? `Duplicate promotion report requires ownership review: ${created.enterpriseName}`
          : `New promotion report requires follow-up: ${created.enterpriseName}`,
        dedupeSuffix: `create-${created.id.toString()}`,
      } satisfies PromotionNotificationJob,
    ],
  };
}

export async function updatePromotionRecord(
  transaction: PostgresTransaction,
  id: unknown,
  body: Record<string, unknown>,
  actor: PromotionRouteActor
) {
  const recordId = parsePostgresId(id, 'recordId');
  const repository = new PromotionRecordRepository(transaction);
  const record = await repository.findById(recordId, { id: actor.id, role: actor.role });
  if (!record) return null;

  const enterprise = await getEnterprise(transaction, record.enterpriseId);
  const enterpriseAutomation = automationConfig(enterprise?.automationConfig);
  const now = new Date();
  const values: Record<string, unknown> = { lastActivityAt: now };
  const timeline: PromotionTimelineEntry[] = [];
  const notificationJobs: PromotionNotificationJob[] = [];

  const businessStage = asString(body.businessStage);
  if (businessStage) {
    if (!BUSINESS_STAGES.has(businessStage)) throw new Error('Invalid businessStage');
    values.businessStage = businessStage;
    if (businessStage === 'closed_lost') {
      values.pendingActionRole = 'none';
      values.nextFollowUpAt = null;
    }
    if (businessStage === 'contacted' && body.nextFollowUpAt === undefined) {
      values.pendingActionRole = 'salesperson';
    }
  }

  const followUpNote = asString(body.followUpNote);
  if (followUpNote) {
    timeline.push(
      timelineEntry({
        type: 'follow_up',
        content: followUpNote,
        actor,
        createdAt: now,
      })
    );
    if (record.businessStage === 'reported') values.businessStage = 'contacted';
    if (
      record.poolStatus === 'protected' &&
      record.protectionExtendedCount < Number((await getPlatformPromotionConfig()).maxProtectionExtends)
    ) {
      const config = await getPlatformPromotionConfig();
      const currentExpiry = record.protectionExpiresAt?.getTime() ?? now.getTime();
      const base = Math.max(currentExpiry, now.getTime());
      values.protectionExpiresAt = new Date(
        base + config.protectionExtendDays * 24 * 60 * 60 * 1000
      );
      values.protectionExtendedCount = record.protectionExtendedCount + 1;
    }
  }

  if (body.nextFollowUpAt !== undefined) {
    const nextFollowUpAt = asDate(body.nextFollowUpAt, 'nextFollowUpAt');
    values.nextFollowUpAt = nextFollowUpAt;
    values.pendingActionRole = nextFollowUpAt ? 'salesperson' : 'none';
  }

  if (body.followUpCompleted) {
    values.businessStage = values.businessStage || (record.businessStage === 'reported' ? 'contacted' : record.businessStage);
    if (!body.nextFollowUpAt) {
      values.pendingActionRole = 'none';
      values.nextFollowUpAt = null;
    }
  }

  if (body.assignMeasurer !== undefined) {
    if (!['enterprise_admin', 'admin', 'super_admin'].includes(actor.role)) {
      throw new Error('Only managers can assign measurers');
    }
    const assignedTo = asOptionalId(body.assignMeasurer, 'assignMeasurer');
    if (!assignedTo) throw new Error('assignMeasurer is required');
    await requireActiveStaff(transaction, assignedTo, 'measurer', 'assignMeasurer');
    values.measureAssignedTo = assignedTo;
    values.measureTaskStatus = 'assigned';
    values.measureAssignedAt = now;
    values.measureDueAt = buildMeasureDueAt(now, enterpriseAutomation);
    values.measureLastReminderAt = null;
    values.businessStage = 'measuring';
    values.pendingActionRole = 'measurer';
    values.nextFollowUpAt = null;
    notificationJobs.push({
      notificationType: 'measure_assigned',
      recipientRoles: ['measurer'],
      message: `Measurement task assigned: ${record.enterpriseName}`,
      dedupeSuffix: `measure-assign-${now.getTime()}`,
    });
  }

  if (body.assignDesigner !== undefined) {
    if (!['enterprise_admin', 'admin', 'super_admin'].includes(actor.role)) {
      throw new Error('Only managers can assign designers');
    }
    const assignedTo = asOptionalId(body.assignDesigner, 'assignDesigner');
    if (!assignedTo) throw new Error('assignDesigner is required');
    await requireActiveStaff(transaction, assignedTo, 'designer', 'assignDesigner');
    values.designAssignedTo = assignedTo;
    values.designTaskStatus = 'assigned';
    values.designAssignedAt = now;
    values.designDueAt = buildDesignDueAt(now, enterpriseAutomation);
    values.designLastReminderAt = null;
    values.businessStage = 'designing';
    values.pendingActionRole = 'designer';
    notificationJobs.push({
      notificationType: 'design_assigned',
      recipientRoles: ['designer'],
      message: `Design task assigned: ${record.enterpriseName}`,
      dedupeSuffix: `design-assign-${now.getTime()}`,
    });
  }

  const measureTaskStatus = asString(body.measureTaskStatus);
  if (measureTaskStatus) {
    if (!MEASURE_STATUSES.has(measureTaskStatus)) throw new Error('Invalid measureTaskStatus');
    if (actor.role !== 'measurer' && !isPlatformRole(actor.role) && actor.role !== 'enterprise_admin') {
      throw new Error('Only measurers can update measurement tasks');
    }
    values.measureTaskStatus = measureTaskStatus;
    if (measureTaskStatus === 'accepted') {
      values.measureAcceptedAt = now;
      values.businessStage = 'measuring';
      values.pendingActionRole = 'measurer';
    }
    if (measureTaskStatus === 'submitted') {
      values.measureSubmittedAt = now;
      values.measureResultSummary = asString(body.measureResultSummary) || null;
      values.businessStage = 'measuring';
      values.pendingActionRole = 'enterprise_admin';
      notificationJobs.push({
        notificationType: 'measure_submitted',
        recipientRoles: ['enterprise_admin'],
        message: `Measurement result submitted: ${record.enterpriseName}`,
        dedupeSuffix: `measure-submitted-${now.getTime()}`,
      });
    }
  }

  const designTaskStatus = asString(body.designTaskStatus);
  if (designTaskStatus) {
    if (!DESIGN_STATUSES.has(designTaskStatus)) throw new Error('Invalid designTaskStatus');
    if (actor.role !== 'designer' && !isPlatformRole(actor.role) && actor.role !== 'enterprise_admin') {
      throw new Error('Only designers can update design tasks');
    }
    values.designTaskStatus = designTaskStatus;
    if (designTaskStatus === 'in_progress') {
      values.designLatestNote = asString(body.designNote) || null;
      values.businessStage = 'designing';
      values.pendingActionRole = 'designer';
    }
    if (designTaskStatus === 'completed') {
      values.designCompletedAt = now;
      values.designLatestNote = asString(body.designNote) || null;
      values.businessStage = 'quoted';
      values.pendingActionRole = 'salesperson';
      values.nextFollowUpAt = buildNextFollowUpAt(now, enterpriseAutomation);
      notificationJobs.push({
        notificationType: 'design_completed',
        recipientRoles: ['salesperson', 'enterprise_admin'],
        message: `Design completed and ready for quotation: ${record.enterpriseName}`,
        dedupeSuffix: `design-completed-${now.getTime()}`,
      });
    }
  }

  if (
    ['enterprise_admin', 'admin', 'super_admin'].includes(actor.role) &&
    body.ownershipStatus === 'manually_locked'
  ) {
    const promoterId = asOptionalId(body.promoterId, 'promoterId');
    if (!promoterId) throw new Error('promoterId is required');
    const promoter = await requireActiveStaff(transaction, promoterId, 'salesperson', 'promoterId');
    if (record.enterpriseId && promoter.enterpriseId !== record.enterpriseId) {
      throw new Error('Promoter does not belong to the selected enterprise');
    }
    const config = await getPlatformPromotionConfig();
    values.ownershipStatus = 'manually_locked';
    values.promoterId = promoter.id;
    values.poolStatus = 'protected';
    values.pendingActionRole = 'salesperson';
    values.protectionExpiresAt = new Date(
      now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000
    );
    values.protectionExtendedCount = 0;
    values.businessStage = record.businessStage === 'closed_lost' ? 'reported' : record.businessStage;
    values.nextFollowUpAt = buildNextFollowUpAt(now, enterpriseAutomation);
    values.conflictReviewedBy = actor.id;
    values.conflictReviewedAt = now;
    values.conflictResolution = asString(body.resolution) || 'manual_override';
    values.conflictingRecordIds = [];
    values.claimStatus = null;
    values.claimRequestedBy = null;
    values.claimRequestedAt = null;
    values.claimReviewedBy = null;
    values.claimReviewedAt = null;
    values.claimRejectReason = null;
    timeline.push(
      timelineEntry({
        type: 'ownership_assigned',
        content: `Ownership assigned to ${promoter.displayName || promoter.username}`,
        actor,
        metadata: { promoterId: promoter.id.toString() },
        createdAt: now,
      })
    );
    notificationJobs.push({
      notificationType: 'follow_up_created',
      recipientRoles: ['salesperson'],
      message: `Ownership confirmed; continue follow-up: ${record.enterpriseName}`,
      dedupeSuffix: `ownership-assigned-${now.getTime()}`,
    });
  }

  const conditions = [];
  if (actor.role === 'measurer') conditions.push(eq(promotionEnterpriseRecords.measureAssignedTo, actor.id));
  if (actor.role === 'designer') conditions.push(eq(promotionEnterpriseRecords.designAssignedTo, actor.id));
  const updated = await repository.updateWhere(
    recordId,
    conditions,
    promotionUpdateValues(values),
    timeline
  );
  return updated ? { record: updated, notificationJobs } : null;
}

export async function listPoolRecords(
  transaction: PostgresTransaction,
  search: string | null,
  poolStatus: string | null,
  manager: boolean
) {
  const poolStatuses =
    manager && poolStatus === 'claimed'
      ? ['claimed']
      : manager && poolStatus === 'all'
        ? ['in_pool', 'claimed']
        : ['in_pool'];
  return new PromotionRecordRepository(transaction).list({
    poolStatuses,
    search: search?.trim() || undefined,
    limit: 200,
  });
}

export async function claimFromPool(
  transaction: PostgresTransaction,
  recordId: unknown,
  salespersonId: unknown,
  config: PlatformPromotionConfig
) {
  const salesperson = await requireActiveStaff(
    transaction,
    parsePostgresId(salespersonId, 'salespersonId'),
    'salesperson',
    'salespersonId'
  );
  const id = parsePostgresId(recordId, 'recordId');
  const repository = new PromotionRecordRepository(transaction);
  const record = await repository.findById(id);
  if (!record) return null;
  const now = new Date();
  const requested = config.poolClaimRequiresApproval;
  const values: Record<string, unknown> = requested
    ? {
        promoterId: null,
        poolStatus: 'claimed',
        ownershipStatus: 'unassigned',
        pendingActionRole: 'none',
        protectionExpiresAt: null,
        protectionExtendedCount: 0,
        nextFollowUpAt: null,
        claimStatus: 'pending',
        claimRequestedBy: salesperson.id,
        claimRequestedAt: now,
        claimReviewedBy: null,
        claimReviewedAt: null,
        claimRejectReason: null,
        lastActivityAt: now,
      }
    : {
        promoterId: salesperson.id,
        poolStatus: 'protected',
        protectionExpiresAt: new Date(
          now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000
        ),
        protectionExtendedCount: 0,
        ownershipStatus: 'auto_locked',
        pendingActionRole: 'salesperson',
        businessStage: record.businessStage === 'closed_lost' ? 'reported' : record.businessStage,
        claimStatus: 'approved',
        claimRequestedBy: salesperson.id,
        claimRequestedAt: now,
        claimReviewedBy: salesperson.id,
        claimReviewedAt: now,
        claimRejectReason: null,
        lastActivityAt: now,
      };
  const updated = await repository.updateWhere(
    id,
    [eq(promotionEnterpriseRecords.poolStatus, 'in_pool')],
    promotionUpdateValues(values),
    [
      timelineEntry({
        type: requested ? 'pool_claim_requested' : 'pool_claimed',
        content: requested ? 'Pool claim requested' : 'Pool record claimed',
        actor: {
          id: salesperson.id,
          role: salesperson.role,
          name: salesperson.displayName || salesperson.username,
          enterpriseId: salesperson.enterpriseId,
        },
        metadata: { requestedBy: salesperson.id.toString() },
        createdAt: now,
      }),
    ]
  );
  return updated;
}

export async function assignPoolRecordToPromoter(
  transaction: PostgresTransaction,
  recordId: unknown,
  salespersonId: unknown,
  operator: PromotionRouteActor,
  config: PlatformPromotionConfig
) {
  const salesperson = await requireActiveStaff(
    transaction,
    parsePostgresId(salespersonId, 'salespersonId'),
    'salesperson',
    'salespersonId'
  );
  const id = parsePostgresId(recordId, 'recordId');
  const record = await new PromotionRecordRepository(transaction).findById(id);
  if (!record) return null;
  const now = new Date();
  return new PromotionRecordRepository(transaction).updateWhere(
    id,
    [eq(promotionEnterpriseRecords.poolStatus, 'in_pool')],
    promotionUpdateValues({
      promoterId: salesperson.id,
      poolStatus: 'protected',
      protectionExpiresAt: new Date(
        now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000
      ),
      protectionExtendedCount: 0,
      ownershipStatus: 'manually_locked',
      pendingActionRole: 'salesperson',
      businessStage: record.businessStage === 'closed_lost' ? 'reported' : record.businessStage,
      claimStatus: null,
      claimRequestedBy: null,
      claimRequestedAt: null,
      claimReviewedBy: null,
      claimReviewedAt: null,
      claimRejectReason: null,
      lastActivityAt: now,
    }),
    [
      timelineEntry({
        type: 'pool_assigned',
        content: `Pool record assigned to ${salesperson.displayName || salesperson.username}`,
        actor: operator,
        metadata: { promoterId: salesperson.id.toString() },
        createdAt: now,
      }),
    ]
  );
}

export async function releaseToPool(
  transaction: PostgresTransaction,
  recordId: unknown,
  operator: PromotionRouteActor,
  timelineType: 'pool_released' | 'pool_auto_released' = 'pool_released'
) {
  const id = parsePostgresId(recordId, 'recordId');
  const repository = new PromotionRecordRepository(transaction);
  const record = await repository.findById(id);
  if (!record) return null;
  const now = new Date();
  return repository.updateWhere(
    id,
    [eq(promotionEnterpriseRecords.updatedAt, record.updatedAt)],
    promotionUpdateValues({
      promoterId: null,
      poolStatus: 'in_pool',
      ownershipStatus: 'unassigned',
      pendingActionRole: 'none',
      protectionExpiresAt: null,
      protectionExtendedCount: 0,
      nextFollowUpAt: null,
      claimStatus: null,
      claimRequestedBy: null,
      claimRequestedAt: null,
      claimReviewedBy: null,
      claimReviewedAt: null,
      claimRejectReason: null,
      lastActivityAt: now,
    }),
    [
      timelineEntry({
        type: timelineType,
        content: timelineType === 'pool_auto_released' ? 'Automatically released to pool' : 'Released to pool',
        actor: operator,
        metadata: record.promoterId ? { previousPromoterId: record.promoterId.toString() } : undefined,
        createdAt: now,
      }),
    ]
  );
}

export async function approveClaimFromPool(
  transaction: PostgresTransaction,
  recordId: unknown,
  operator: PromotionRouteActor,
  config: PlatformPromotionConfig
) {
  const id = parsePostgresId(recordId, 'recordId');
  const repository = new PromotionRecordRepository(transaction);
  const record = await repository.findById(id);
  if (!record || record.poolStatus !== 'claimed' || record.claimStatus !== 'pending' || !record.claimRequestedBy) {
    return null;
  }
  const salesperson = await requireActiveStaff(transaction, record.claimRequestedBy, 'salesperson', 'claimRequester');
  const now = new Date();
  return repository.updateWhere(
    id,
    [
      eq(promotionEnterpriseRecords.poolStatus, 'claimed'),
      eq(promotionEnterpriseRecords.claimStatus, 'pending'),
      eq(promotionEnterpriseRecords.claimRequestedBy, record.claimRequestedBy),
      eq(promotionEnterpriseRecords.updatedAt, record.updatedAt),
    ],
    promotionUpdateValues({
      promoterId: salesperson.id,
      poolStatus: 'protected',
      protectionExpiresAt: new Date(
        now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000
      ),
      protectionExtendedCount: 0,
      ownershipStatus: 'manually_locked',
      pendingActionRole: 'salesperson',
      businessStage: record.businessStage === 'closed_lost' ? 'reported' : record.businessStage,
      claimStatus: 'approved',
      claimReviewedBy: operator.id,
      claimReviewedAt: now,
      claimRejectReason: null,
      lastActivityAt: now,
    }),
    [
      timelineEntry({
        type: 'pool_claim_approved',
        content: `Pool claim approved for ${salesperson.displayName || salesperson.username}`,
        actor: operator,
        metadata: { promoterId: salesperson.id.toString() },
        createdAt: now,
      }),
    ]
  );
}

export async function rejectClaimFromPool(
  transaction: PostgresTransaction,
  recordId: unknown,
  operator: PromotionRouteActor,
  reason?: unknown
) {
  const id = parsePostgresId(recordId, 'recordId');
  const repository = new PromotionRecordRepository(transaction);
  const record = await repository.findById(id);
  if (!record || record.poolStatus !== 'claimed' || record.claimStatus !== 'pending') return null;
  const now = new Date();
  return repository.updateWhere(
    id,
    [
      eq(promotionEnterpriseRecords.poolStatus, 'claimed'),
      eq(promotionEnterpriseRecords.claimStatus, 'pending'),
      ...(record.claimRequestedBy
        ? [eq(promotionEnterpriseRecords.claimRequestedBy, record.claimRequestedBy)]
        : []),
      eq(promotionEnterpriseRecords.updatedAt, record.updatedAt),
    ],
    promotionUpdateValues({
      promoterId: null,
      poolStatus: 'in_pool',
      ownershipStatus: 'unassigned',
      pendingActionRole: 'none',
      protectionExpiresAt: null,
      protectionExtendedCount: 0,
      nextFollowUpAt: null,
      claimStatus: 'rejected',
      claimReviewedBy: operator.id,
      claimReviewedAt: now,
      claimRejectReason: asString(reason) || null,
      lastActivityAt: now,
    }),
    [
      timelineEntry({
        type: 'pool_claim_rejected',
        content: 'Pool claim rejected',
        actor: operator,
        metadata: { requestedBy: record.claimRequestedBy?.toString(), rejectReason: asString(reason) },
        createdAt: now,
      }),
    ]
  );
}

export function promotionRecordToRaw(record: PromotionRecordWithRelations | PromotionRecord) {
  return record;
}
