import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  adminUsers,
  aiGenerationPublications,
  aiGenerations,
  enterprises,
  floorPlans,
  leads,
  measurementAppointments,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type CustomerProjectPublication = {
  publication: typeof aiGenerationPublications.$inferSelect;
  generation: typeof aiGenerations.$inferSelect;
};

export type CustomerProject = {
  lead: typeof leads.$inferSelect;
  enterpriseName: string;
  designer: Pick<typeof adminUsers.$inferSelect, 'id' | 'displayName' | 'wechatId' | 'wechatQrAssetId'> | null;
  appointment: (typeof measurementAppointments.$inferSelect & {
    measurerName: string | null;
  }) | null;
  formalFloorPlan: typeof floorPlans.$inferSelect | null;
  publications: CustomerProjectPublication[];
};

export type CustomerProjectIndexItem = {
  leadId: bigint;
  enterpriseName: string;
  status: string;
  updatedAt: Date;
  appointmentStatus: string | null;
  hasFormalFloorPlan: boolean;
  publishedDesignCount: number;
};

function hasResultImage(output: unknown) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  const imageUrl = (output as Record<string, unknown>).imageUrl;
  return typeof imageUrl === 'string' && imageUrl.trim().length > 0;
}

export class CustomerProjectRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findCustomerProject(customerUserId: bigint, leadId: bigint): Promise<CustomerProject | null> {
    const leadRows = await this.transaction
      .select({ lead: leads, enterpriseName: enterprises.name })
      .from(leads)
      .innerJoin(enterprises, eq(leads.enterpriseId, enterprises.id))
      .where(and(
        eq(leads.id, leadId),
        eq(leads.customerUserId, customerUserId),
        isNull(leads.archivedAt)
      ))
      .limit(1);
    const row = leadRows[0];
    if (!row || !row.lead.enterpriseId) return null;

    const [designerRows, appointmentRows, formalFloorPlanRows, publications] = await Promise.all([
      row.lead.assignedTo
        ? this.transaction
            .select({
              id: adminUsers.id,
              displayName: adminUsers.displayName,
              wechatId: adminUsers.wechatId,
              wechatQrAssetId: adminUsers.wechatQrAssetId,
            })
            .from(adminUsers)
            .where(eq(adminUsers.id, row.lead.assignedTo))
            .limit(1)
        : [],
      this.transaction
        .select({ appointment: measurementAppointments, measurerName: adminUsers.displayName })
        .from(measurementAppointments)
        .leftJoin(adminUsers, eq(measurementAppointments.measurerId, adminUsers.id))
        .where(and(
          eq(measurementAppointments.leadId, leadId),
          eq(measurementAppointments.status, 'confirmed')
        ))
        .orderBy(desc(measurementAppointments.updatedAt), desc(measurementAppointments.id))
        .limit(1),
      row.lead.primaryFloorPlanId
        ? this.transaction
            .select()
            .from(floorPlans)
            .where(and(
              eq(floorPlans.id, row.lead.primaryFloorPlanId),
              eq(floorPlans.enterpriseId, row.lead.enterpriseId),
              eq(floorPlans.status, 'completed'),
              sql`${floorPlans.layoutData} ->> 'version' = '4'`,
              sql`${floorPlans.layoutData} ->> 'measurementMode' = 'surveying'`,
              sql`${floorPlans.layoutData} #>> '{surveyGraph,kind}' = 'survey-wall-graph'`
            ))
            .limit(1)
        : [],
      this.listActivePublications(row.lead.enterpriseId, leadId),
    ]);

    return {
      lead: row.lead,
      enterpriseName: row.enterpriseName,
      designer: designerRows[0] ?? null,
      appointment: appointmentRows[0]
        ? { ...appointmentRows[0].appointment, measurerName: appointmentRows[0].measurerName }
        : null,
      formalFloorPlan: formalFloorPlanRows[0] ?? null,
      publications,
    };
  }

  async listCustomerProjects(customerUserId: bigint): Promise<CustomerProjectIndexItem[]> {
    const rows = await this.transaction
      .select({
        leadId: leads.id,
        enterpriseName: enterprises.name,
        status: leads.status,
        updatedAt: leads.updatedAt,
        appointmentStatus: sql<string | null>`(
          select ${measurementAppointments.status}
          from app.measurement_appointments
          where ${measurementAppointments.leadId} = ${leads.id}
          order by ${measurementAppointments.updatedAt} desc, ${measurementAppointments.id} desc
          limit 1
        )`,
        hasFormalFloorPlan: sql<boolean>`exists (
          select 1
          from app.floor_plans
          where ${floorPlans.id} = ${leads.primaryFloorPlanId}
            and ${floorPlans.enterpriseId} = ${leads.enterpriseId}
            and ${floorPlans.status} = 'completed'
            and ${floorPlans.layoutData} ->> 'version' = '4'
            and ${floorPlans.layoutData} ->> 'measurementMode' = 'surveying'
            and ${floorPlans.layoutData} #>> '{surveyGraph,kind}' = 'survey-wall-graph'
        )`,
        publishedDesignCount: sql<number>`(
          select count(*)::int
          from app.ai_generation_publications publication
          inner join app.ai_generations generation on generation.id = publication.generation_id
          where publication.lead_id = ${leads.id}
            and publication.enterprise_id = ${leads.enterpriseId}
            and publication.withdrawn_at is null
            and generation.status = 'succeeded'
            and generation.deleted_at is null
            and coalesce(generation.output ->> 'imageUrl', '') <> ''
        )`,
      })
      .from(leads)
      .innerJoin(enterprises, eq(leads.enterpriseId, enterprises.id))
      .where(and(eq(leads.customerUserId, customerUserId), isNull(leads.archivedAt)))
      .orderBy(desc(leads.updatedAt), desc(leads.id));

    return rows;
  }

  async findCustomerPublishedGeneration(customerUserId: bigint, leadId: bigint, generationId: bigint) {
    const project = await this.findCustomerProject(customerUserId, leadId);
    return project?.publications.find((item) => item.generation.id === generationId) ?? null;
  }

  async listActivePublications(enterpriseId: bigint, leadId: bigint): Promise<CustomerProjectPublication[]> {
    return this.transaction
      .select({ publication: aiGenerationPublications, generation: aiGenerations })
      .from(aiGenerationPublications)
      .innerJoin(aiGenerations, eq(aiGenerationPublications.generationId, aiGenerations.id))
      .where(and(
        eq(aiGenerationPublications.enterpriseId, enterpriseId),
        eq(aiGenerationPublications.leadId, leadId),
        isNull(aiGenerationPublications.withdrawnAt),
        eq(aiGenerations.enterpriseId, enterpriseId),
        eq(aiGenerations.leadId, leadId),
        eq(aiGenerations.status, 'succeeded'),
        isNull(aiGenerations.deletedAt),
        sql`coalesce(${aiGenerations.output} ->> 'imageUrl', '') <> ''`
      ))
      .orderBy(desc(aiGenerationPublications.publishedAt), desc(aiGenerationPublications.id));
  }

  async publish(input: {
    enterpriseId: bigint;
    leadId: bigint;
    generationId: bigint;
    publishedBy: bigint;
  }) {
    const leadRows = await this.transaction
      .select({ id: leads.id, assignedTo: leads.assignedTo, archivedAt: leads.archivedAt })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.enterpriseId, input.enterpriseId)))
      .for('update')
      .limit(1);
    const lead = leadRows[0];
    if (!lead) return { kind: 'lead_not_found' as const };
    if (lead.archivedAt) return { kind: 'lead_archived' as const };

    const generationRows = await this.transaction
      .select({ id: aiGenerations.id, output: aiGenerations.output })
      .from(aiGenerations)
      .where(and(
        eq(aiGenerations.id, input.generationId),
        eq(aiGenerations.enterpriseId, input.enterpriseId),
        eq(aiGenerations.leadId, input.leadId),
        eq(aiGenerations.status, 'succeeded'),
        isNull(aiGenerations.deletedAt)
      ))
      .limit(1);
    if (!generationRows[0] || !hasResultImage(generationRows[0].output)) {
      return { kind: 'generation_not_publishable' as const, lead };
    }

    await this.transaction
      .insert(aiGenerationPublications)
      .values({
        enterpriseId: input.enterpriseId,
        leadId: input.leadId,
        generationId: input.generationId,
        publishedBy: input.publishedBy,
      })
      .onConflictDoNothing();
    const publication = (await this.listActivePublications(input.enterpriseId, input.leadId))
      .find((item) => item.generation.id === input.generationId) ?? null;
    return { kind: 'published' as const, lead, publication };
  }

  async withdraw(input: {
    enterpriseId: bigint;
    leadId: bigint;
    generationId: bigint;
    withdrawnBy: bigint;
  }) {
    const leadRows = await this.transaction
      .select({ id: leads.id, assignedTo: leads.assignedTo, archivedAt: leads.archivedAt })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.enterpriseId, input.enterpriseId)))
      .for('update')
      .limit(1);
    const lead = leadRows[0];
    if (!lead) return { kind: 'lead_not_found' as const };
    if (lead.archivedAt) return { kind: 'lead_archived' as const };

    const rows = await this.transaction
      .update(aiGenerationPublications)
      .set({ withdrawnAt: new Date(), withdrawnBy: input.withdrawnBy, updatedAt: new Date() })
      .where(and(
        eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
        eq(aiGenerationPublications.leadId, input.leadId),
        eq(aiGenerationPublications.generationId, input.generationId),
        isNull(aiGenerationPublications.withdrawnAt)
      ))
      .returning();
    return { kind: rows[0] ? 'withdrawn' as const : 'publication_not_found' as const, lead, publication: rows[0] ?? null };
  }
}
