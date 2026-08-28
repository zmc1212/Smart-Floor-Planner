import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  aiGenerationPublications,
  aiGenerations,
  enterprises,
  floorPlans,
  leadCommissions,
  leads,
  measurementAppointments,
  referrerEnterpriseMemberships,
  referrerProfiles,
} from '@/db/schema';
import { resolveLeadServiceStage, selectOperationalAppointment } from '@/lib/lead-service-stage';
import type { PostgresTransaction } from '@/db/transaction';
import { LeadLifecycleRepository } from '@/db/repositories/lead-lifecycle-repository';

type ReferrerMembershipScope = {
  membershipId: bigint;
  enterpriseId: bigint;
  enterpriseName: string;
};

function maskedCustomerLabel(leadId: bigint) {
  return `服务客户 #${leadId.toString().slice(-4).padStart(4, '0')}`;
}

function fallbackRecordCode(leadId: bigint) {
  return `R-${leadId.toString().slice(-8).padStart(8, '0')}`;
}

export class ReferrerPortalRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async resolveMembership(userId: bigint, membershipId: bigint, enterpriseId: bigint): Promise<ReferrerMembershipScope | null> {
    const rows = await this.transaction
      .select({
        membershipId: referrerEnterpriseMemberships.id,
        enterpriseId: referrerEnterpriseMemberships.enterpriseId,
        enterpriseName: enterprises.name,
      })
      .from(referrerEnterpriseMemberships)
      .innerJoin(referrerProfiles, eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id))
      .innerJoin(enterprises, eq(referrerEnterpriseMemberships.enterpriseId, enterprises.id))
      .where(and(
        eq(referrerEnterpriseMemberships.id, membershipId),
        eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId),
        eq(referrerProfiles.userId, userId),
        eq(referrerEnterpriseMemberships.status, 'active')
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async listProgress(userId: bigint, membershipId: bigint, enterpriseId: bigint) {
    const scope = await this.resolveMembership(userId, membershipId, enterpriseId);
    if (!scope) return null;

    const progressLeads = await this.transaction
      .select({
        id: leads.id,
        status: leads.status,
        assignmentStatus: leads.assignmentStatus,
        primaryFloorPlanId: leads.primaryFloorPlanId,
        convertedAt: leads.convertedAt,
        updatedAt: leads.updatedAt,
        createdAt: leads.createdAt,
        referrerRecordCode: leads.referrerRecordCode,
        terminationType: leads.terminationType,
        terminatedAt: leads.terminatedAt,
        terminationNote: leads.terminationNote,
        terminationPreviousStatus: leads.terminationPreviousStatus,
      })
      .from(leads)
      .where(and(
        eq(leads.enterpriseId, enterpriseId),
        eq(leads.referrerMembershipId, membershipId),
        isNull(leads.archivedAt)
      ))
      .orderBy(desc(leads.updatedAt), desc(leads.id));
    if (!progressLeads.length) return { enterpriseName: scope.enterpriseName, items: [] };

    const leadIds = progressLeads.map((lead) => lead.id);
    const [appointmentRows, publicationRows, impacts] = await Promise.all([
      this.transaction
        .select({
          leadId: measurementAppointments.leadId,
          status: measurementAppointments.status,
          timeRange: measurementAppointments.timeRange,
          updatedAt: measurementAppointments.updatedAt,
        })
        .from(measurementAppointments)
        .where(and(eq(measurementAppointments.enterpriseId, enterpriseId), inArray(measurementAppointments.leadId, leadIds))),
      this.transaction
        .select({ leadId: aiGenerationPublications.leadId, publishedAt: aiGenerationPublications.publishedAt })
        .from(aiGenerationPublications)
        .innerJoin(aiGenerations, eq(aiGenerationPublications.generationId, aiGenerations.id))
        .where(and(
          eq(aiGenerationPublications.enterpriseId, enterpriseId),
          inArray(aiGenerationPublications.leadId, leadIds),
          isNull(aiGenerationPublications.withdrawnAt),
          eq(aiGenerations.status, 'succeeded'),
          isNull(aiGenerations.deletedAt)
        ))
        .orderBy(desc(aiGenerationPublications.publishedAt), desc(aiGenerationPublications.id)),
      new LeadLifecycleRepository(this.transaction).impacts(leadIds),
    ]);
    const planIds = progressLeads.map((lead) => lead.primaryFloorPlanId).filter((id): id is bigint => Boolean(id));
    const plans = planIds.length
      ? await this.transaction
          .select({ id: floorPlans.id })
          .from(floorPlans)
          .where(and(
            eq(floorPlans.enterpriseId, enterpriseId),
            inArray(floorPlans.id, planIds),
            eq(floorPlans.status, 'completed'),
            sql`${floorPlans.layoutData} ->> 'version' = '4'`,
            sql`${floorPlans.layoutData} ->> 'measurementMode' = 'surveying'`,
            sql`${floorPlans.layoutData} #>> '{surveyGraph,kind}' = 'survey-wall-graph'`
          ))
      : [];
    const appointmentByLead = new Map<bigint, (typeof appointmentRows)[number]>();
    const appointmentsByLead = new Map<bigint, typeof appointmentRows>();
    for (const appointment of appointmentRows) {
      const current = appointmentsByLead.get(appointment.leadId);
      if (current) current.push(appointment);
      else appointmentsByLead.set(appointment.leadId, [appointment]);
    }
    for (const [leadId, appointments] of appointmentsByLead) {
      const selected = selectOperationalAppointment(appointments);
      if (selected) appointmentByLead.set(leadId, selected);
    }
    const publishedAtByLead = new Map<bigint, Date>();
    for (const publication of publicationRows) {
      if (!publishedAtByLead.has(publication.leadId)) publishedAtByLead.set(publication.leadId, publication.publishedAt);
    }
    const completedPlanIds = new Set(plans.map((plan) => plan.id));

    return {
      enterpriseName: scope.enterpriseName,
      items: progressLeads.map((lead) => {
        const appointment = appointmentByLead.get(lead.id) ?? null;
        const publishedAt = publishedAtByLead.get(lead.id) ?? null;
        const hasFormalFloorPlan = Boolean(lead.primaryFloorPlanId && completedPlanIds.has(lead.primaryFloorPlanId));
        const stage = resolveLeadServiceStage({
          leadStatus: lead.status,
          terminationType: lead.terminationType,
          assignmentStatus: lead.assignmentStatus,
          measurerId: lead.assignmentStatus === 'assigned' ? 'assigned' : null,
          appointment: appointment ? { status: appointment.status, timeRange: appointment.timeRange } : null,
          hasFormalFloorPlan,
          publishedDesignCount: publishedAt ? 1 : 0,
        });
        const updatedAt = [lead.updatedAt, appointment?.updatedAt, publishedAt, lead.convertedAt]
          .filter((value): value is Date => Boolean(value))
          .reduce((latest, value) => value > latest ? value : latest, lead.updatedAt);
        const impact = impacts.find((item) => item.leadId === lead.id);
        const canWithdraw = lead.terminationType == null && lead.status === 'new' && !appointment
          && !impact?.floorPlanCount && !impact?.aiWorkflowCount && !impact?.aiGenerationCount && !impact?.followUpCount && !impact?.hasConversion && !impact?.commissionCount;
        const withdrawalDeadline = lead.terminatedAt ? new Date(lead.terminatedAt.getTime() + 10 * 60 * 1000) : null;
        return {
          id: lead.id.toString(),
          customerLabel: maskedCustomerLabel(lead.id),
          recordCode: lead.referrerRecordCode || fallbackRecordCode(lead.id),
          createdAt: lead.createdAt,
          stage,
          updatedAt,
          terminationType: lead.terminationType,
          terminatedAt: lead.terminatedAt,
          terminationNote: lead.terminationNote,
          canWithdraw,
          canUndo: lead.terminationType === 'referrer_withdrawn' && Boolean(withdrawalDeadline && withdrawalDeadline.getTime() > Date.now()),
          withdrawalDeadline,
          withdrawalBlockedReason: canWithdraw || lead.terminationType === 'referrer_withdrawn' ? null : '该线索已开始服务，不能撤回，请联系企业管理员',
        };
      }),
    };
  }

  async listEarnings(userId: bigint, membershipId: bigint, enterpriseId: bigint) {
    const scope = await this.resolveMembership(userId, membershipId, enterpriseId);
    if (!scope) return null;
    const rows = await this.transaction
      .select({ commission: leadCommissions, leadId: leads.id })
      .from(leadCommissions)
      .innerJoin(leads, eq(leadCommissions.leadId, leads.id))
      .where(and(
        eq(leadCommissions.enterpriseId, enterpriseId),
        eq(leadCommissions.role, 'referrer'),
        eq(leadCommissions.beneficiaryUserId, userId),
        eq(leads.enterpriseId, enterpriseId),
        isNull(leads.archivedAt)
      ))
      .orderBy(desc(leadCommissions.createdAt), desc(leadCommissions.id));
    const items = rows.map(({ commission, leadId }) => ({
      id: commission.id.toString(),
      customerLabel: maskedCustomerLabel(leadId),
      status: commission.status,
      createdAt: commission.createdAt,
      paidAt: commission.paidAt,
    }));

    return {
      enterpriseName: scope.enterpriseName,
      payableCount: items.filter((item) => item.status === 'payable').length,
      paidCount: items.filter((item) => item.status === 'paid').length,
      items,
    };
  }
}
