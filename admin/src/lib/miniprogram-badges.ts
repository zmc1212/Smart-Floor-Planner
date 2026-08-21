import {
  AdminUserRepository,
  AppointmentRepository,
  CustomerProjectRepository,
  LeadCommissionRepository,
  LeadRepository,
  ReferrerPortalRepository,
  type MiniProgramIdentityContextRecord,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import {
  DEFAULT_APPOINTMENT_TIMEZONE,
  localDateInTimeZone,
} from '@/lib/appointment-scheduling';
import { customerProjectIndexToDto } from '@/lib/customer-project';
import { parseAppointmentBounds } from '@/lib/lead-service-stage';
import {
  buildStaffingGapItems,
  isAssignmentEligibleStaff,
  isMeasurerWorkbenchSurveyLead,
  selectMeasurerWorkbenchAppointments,
  shouldIncludeMeasurerWorkbenchAppointment,
} from '@/lib/miniprogram-workbench';

type BadgeRole = 'customer' | 'referrer' | 'designer' | 'measurer' | 'enterprise_admin';

export const MINI_PROGRAM_BADGE_UNAVAILABLE_MESSAGE = '暂时无法读取';

export type MiniProgramBadgeSummary = {
  status: 'ok' | 'unavailable';
  message: string | null;
  counts: Record<string, number>;
};

export type MiniProgramBadgeFacts = {
  customerRescheduleCount?: number;
  customerRebookCount?: number;
  designerFollowUpCount?: number;
  designerExpiredCount?: number;
  measurerTodayCount?: number;
  measurerTaskCount?: number;
  ownerExceptionCount?: number;
  ownerExpiredCount?: number;
  referrerOpenProgressCount?: number;
  referrerPayableCount?: number;
  staffPayableCount?: number;
  ownerPayableCount?: number;
};

export function unavailableMiniProgramBadges(): MiniProgramBadgeSummary {
  return {
    status: 'unavailable',
    message: MINI_PROGRAM_BADGE_UNAVAILABLE_MESSAGE,
    counts: {},
  };
}

function counted(key: string, value: number): Record<string, number> {
  const count = Math.max(0, Number(value) || 0);
  return count > 0 ? { [key]: count } : {};
}

export function buildMiniProgramBadges(input: {
  role: BadgeRole;
  facts: MiniProgramBadgeFacts;
}): MiniProgramBadgeSummary {
  const facts = input.facts;
  let counts: Record<string, number> = {};
  if (input.role === 'customer') {
    counts = counted(
      'service',
      Number(facts.customerRescheduleCount || 0) + Number(facts.customerRebookCount || 0)
    );
  } else if (input.role === 'designer') {
    counts = {
      ...counted(
        'workbench',
        Number(facts.designerFollowUpCount || 0) + Number(facts.designerExpiredCount || 0)
      ),
      ...counted('earnings', Number(facts.staffPayableCount || 0)),
    };
  } else if (input.role === 'measurer') {
    counts = {
      ...counted(
        'workbench',
        Number(facts.measurerTodayCount || 0) + Number(facts.measurerTaskCount || 0)
      ),
      ...counted('earnings', Number(facts.staffPayableCount || 0)),
    };
  } else if (input.role === 'enterprise_admin') {
    counts = {
      ...counted('operations', Number(facts.ownerExceptionCount || 0)),
      ...counted('appointments', Number(facts.ownerExpiredCount || 0)),
      ...counted('commissions', Number(facts.ownerPayableCount || 0)),
    };
  } else if (input.role === 'referrer') {
    counts = {
      ...counted('progress', Number(facts.referrerOpenProgressCount || 0)),
      ...counted('earnings', Number(facts.referrerPayableCount || 0)),
    };
  }
  return { status: 'ok', message: null, counts };
}

function appointmentTimeRangeText(timeRange: unknown) {
  return typeof timeRange === 'string' ? timeRange : String(timeRange || '');
}

function isAppointmentOnLocalDate(timeRange: unknown, localDate: string) {
  const bounds = parseAppointmentBounds(appointmentTimeRangeText(timeRange));
  return Boolean(
    bounds && localDateInTimeZone(bounds.startAt, DEFAULT_APPOINTMENT_TIMEZONE) === localDate
  );
}

export async function loadMiniProgramBadgeCounts(input: {
  transaction: PostgresTransaction;
  userId: bigint;
  current: MiniProgramIdentityContextRecord;
  role: BadgeRole;
}): Promise<MiniProgramBadgeFacts> {
  const { transaction, userId, current, role } = input;
  if (role === 'customer') {
    const projects = await new CustomerProjectRepository(transaction).listCustomerProjects(userId);
    let customerRescheduleCount = 0;
    let customerRebookCount = 0;
    for (const project of projects) {
      const nextActionKind = customerProjectIndexToDto(project).nextActionKind;
      if (nextActionKind === 'reschedule') customerRescheduleCount += 1;
      if (nextActionKind === 'rebook' || nextActionKind === 'book') customerRebookCount += 1;
    }
    return { customerRescheduleCount, customerRebookCount };
  }

  if (role === 'referrer') {
    if (!current.enterpriseId || !current.referrerMembershipId) return {};
    const portal = new ReferrerPortalRepository(transaction);
    const [progress, earnings] = await Promise.all([
      portal.listProgress(userId, current.referrerMembershipId, current.enterpriseId),
      portal.listEarnings(userId, current.referrerMembershipId, current.enterpriseId),
    ]);
    return {
      referrerOpenProgressCount: (progress?.items || []).filter((item) => (
        item.stage.key !== 'converted' && item.stage.key !== 'closed'
      )).length,
      referrerPayableCount: (earnings?.items || []).filter((item) => item.status === 'payable').length,
    };
  }

  if (!current.enterpriseId || !current.staffId) return {};
  const enterpriseId = current.enterpriseId;
  const staffId = current.staffId;
  const leads = new LeadRepository(transaction);
  const appointments = new AppointmentRepository(transaction);

  if (role === 'designer' || role === 'measurer') {
    const earningsQuery = new LeadCommissionRepository(transaction).listOwnStaffEarnings({
      userId,
      enterpriseId,
      staffId,
      role,
      enterpriseName: current.enterpriseName || '',
    });

    if (role === 'designer') {
      const scope = { staffId, staffVisibility: 'assigned' as const };
      const [earnings, statusCounts, expiredUnbooked] = await Promise.all([
        earningsQuery,
        leads.countStatuses(scope, ['new', 'contacted', 'measuring', 'measured', 'assigned', 'designing', 'quoting']),
        appointments.listExpiredUnbooked(enterpriseId, 50),
      ]);
      const designerExpiredCount = expiredUnbooked.filter((row) => row.lead.assignedTo === staffId).length;
      const activeCount = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
      return {
        designerFollowUpCount: Math.max(0, activeCount - designerExpiredCount),
        designerExpiredCount,
        staffPayableCount: (earnings.items || []).filter((item) => item.status === 'payable').length,
      };
    }

    const today = localDateInTimeZone(new Date(), DEFAULT_APPOINTMENT_TIMEZONE);
    const [earnings, appointmentRows, surveyList] = await Promise.all([
      earningsQuery,
      appointments.listByMeasurer(enterpriseId, staffId, ['confirmed', 'expired']),
      leads.list({ staffId, staffVisibility: 'measurer', page: 1, limit: 50, orderBy: 'updatedAt' }),
    ]);
    const currentAppointmentRows = selectMeasurerWorkbenchAppointments(appointmentRows);
    const leadIds = currentAppointmentRows.map((item) => item.leadId);
    const leadRows = leadIds.length ? await leads.findByIds(leadIds) : [];
    const leadMap = new Map(leadRows.map((item) => [item.id, item]));
    const confirmedRows = currentAppointmentRows
      .filter((item) => item.status === 'confirmed')
      .filter((item) => shouldIncludeMeasurerWorkbenchAppointment(leadMap.get(item.leadId), item));
    const expiredRows = currentAppointmentRows
      .filter((item) => item.status === 'expired')
      .filter((item) => shouldIncludeMeasurerWorkbenchAppointment(leadMap.get(item.leadId), item));
    const measurerTodayCount = confirmedRows.filter((item) => isAppointmentOnLocalDate(item.timeRange, today)).length;
    const expiredCount = expiredRows.length;
    const occupiedIds = new Set([
      ...confirmedRows.map((item) => item.leadId.toString()),
      ...expiredRows.map((item) => item.leadId.toString()),
    ]);
    const unscheduledCount = surveyList.rows.filter((lead) => isMeasurerWorkbenchSurveyLead(lead, occupiedIds)).length;
    return {
      measurerTodayCount,
      measurerTaskCount: expiredCount + unscheduledCount,
      staffPayableCount: (earnings.items || []).filter((item) => item.status === 'payable').length,
    };
  }

  const [pendingAssignments, expiredUnbooked, staffList, ownerPayableCount] = await Promise.all([
    leads.list({ assignmentStatus: 'assignment_pending', page: 1, limit: 1, orderBy: 'updatedAt' }),
    appointments.listExpiredUnbooked(enterpriseId, 50),
    new AdminUserRepository(transaction).list({ roles: ['designer', 'measurer'], status: 'active', page: 1, limit: 200 }),
    new LeadCommissionRepository(transaction).countEnterprisePayable(enterpriseId),
  ]);
  const staffingCount = buildStaffingGapItems({
    eligibleDesignerCount: staffList.rows.filter((member) => member.role === 'designer' && isAssignmentEligibleStaff(member)).length,
    eligibleMeasurerCount: staffList.rows.filter((member) => member.role === 'measurer' && isAssignmentEligibleStaff(member)).length,
  }).length;
  const ownerExpiredCount = expiredUnbooked.length;
  return {
    ownerExceptionCount: pendingAssignments.total + ownerExpiredCount + staffingCount,
    ownerExpiredCount,
    ownerPayableCount,
  };
}
