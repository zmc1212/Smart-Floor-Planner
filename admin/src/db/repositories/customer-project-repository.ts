import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  adminUsers,
  aiGenerationPublications,
  aiGenerations,
  aiWorkflows,
  enterpriseAppointmentSettings,
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
  measurerName: string | null;
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
  assignmentStatus: string | null;
  measurerId: bigint | null;
  updatedAt: Date;
  appointmentId: bigint | null;
  appointmentVersion: number | null;
  appointmentStatus: string | null;
  appointmentTimeRange?: string | null;
  customerRescheduleCutoffHours: number;
  hasFormalFloorPlan: boolean;
  publishedDesignCount: number;
};

function operationalAppointmentOrderSql() {
  return sql`case when ${measurementAppointments.status} = 'confirmed' and upper(${measurementAppointments.timeRange}) > now() then 0 else 1 end`;
}

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

    const [designerRows, measurerRows, appointmentRows, formalFloorPlanRows, publications] = await Promise.all([
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
      row.lead.measurerId
        ? this.transaction
            .select({ displayName: adminUsers.displayName })
            .from(adminUsers)
            .where(eq(adminUsers.id, row.lead.measurerId))
            .limit(1)
        : [],
      this.transaction
        .select({ appointment: measurementAppointments, measurerName: adminUsers.displayName })
        .from(measurementAppointments)
        .leftJoin(adminUsers, eq(measurementAppointments.measurerId, adminUsers.id))
        .where(eq(measurementAppointments.leadId, leadId))
        .orderBy(
          operationalAppointmentOrderSql(),
          desc(measurementAppointments.id)
        )
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
      measurerName: measurerRows[0]?.displayName ?? null,
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
        assignmentStatus: leads.assignmentStatus,
        measurerId: leads.measurerId,
        updatedAt: leads.updatedAt,
        appointmentId: sql<bigint | null>`(
          select ${measurementAppointments.id}
          from app.measurement_appointments
          where ${measurementAppointments.leadId} = ${leads.id}
          order by ${operationalAppointmentOrderSql()},
            ${measurementAppointments.id} desc
          limit 1
        )`,
        appointmentVersion: sql<number | null>`(
          select ${measurementAppointments.version}
          from app.measurement_appointments
          where ${measurementAppointments.leadId} = ${leads.id}
          order by ${operationalAppointmentOrderSql()},
            ${measurementAppointments.id} desc
          limit 1
        )`,
        appointmentStatus: sql<string | null>`(
          select ${measurementAppointments.status}
          from app.measurement_appointments
          where ${measurementAppointments.leadId} = ${leads.id}
          order by ${operationalAppointmentOrderSql()},
            ${measurementAppointments.id} desc
          limit 1
        )`,
        appointmentTimeRange: sql<string | null>`(
          select ${measurementAppointments.timeRange}::text
          from app.measurement_appointments
          where ${measurementAppointments.leadId} = ${leads.id}
          order by ${operationalAppointmentOrderSql()},
            ${measurementAppointments.id} desc
          limit 1
        )`,
        customerRescheduleCutoffHours: sql<number>`coalesce(${enterpriseAppointmentSettings.customerRescheduleCutoffHours}, 2)`,
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
      .leftJoin(enterpriseAppointmentSettings, eq(enterpriseAppointmentSettings.enterpriseId, leads.enterpriseId))
      .where(and(eq(leads.customerUserId, customerUserId), isNull(leads.archivedAt)))
      .orderBy(desc(leads.updatedAt), desc(leads.id));

    return rows;
  }

  async findCustomerPublishedGeneration(customerUserId: bigint, leadId: bigint, generationId: bigint) {
    const project = await this.findCustomerProject(customerUserId, leadId);
    return project?.publications.find((item) => item.generation.id === generationId) ?? null;
  }

  async countPublishedDesignsByLeadIds(enterpriseId: bigint, leadIds: bigint[]) {
    if (!leadIds.length) return new Map<string, number>();
    const rows = await this.transaction
      .select({
        leadId: aiGenerationPublications.leadId,
        value: count(),
      })
      .from(aiGenerationPublications)
      .innerJoin(aiGenerations, eq(aiGenerationPublications.generationId, aiGenerations.id))
      .where(and(
        eq(aiGenerationPublications.enterpriseId, enterpriseId),
        inArray(aiGenerationPublications.leadId, leadIds),
        isNull(aiGenerationPublications.withdrawnAt),
        eq(aiGenerations.enterpriseId, enterpriseId),
        eq(aiGenerations.status, 'succeeded'),
        isNull(aiGenerations.deletedAt),
        sql`coalesce(${aiGenerations.output} ->> 'imageUrl', '') <> ''`
      ))
      .groupBy(aiGenerationPublications.leadId);
    return new Map(rows.map((row) => [row.leadId.toString(), Number(row.value ?? 0)]));
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
      .orderBy(
        desc(aiGenerationPublications.publishedAt),
        asc(aiGenerationPublications.sortOrder),
        desc(aiGenerationPublications.id)
      );
  }

  async listPublishableGenerations(enterpriseId: bigint, leadId: bigint) {
    const publishedIds = sql`(
      select ${aiGenerationPublications.generationId}
      from ${aiGenerationPublications}
      where ${aiGenerationPublications.enterpriseId} = ${enterpriseId}
        and ${aiGenerationPublications.leadId} = ${leadId}
        and ${aiGenerationPublications.withdrawnAt} is null
    )`;
    return this.transaction
      .select()
      .from(aiGenerations)
      .where(and(
        eq(aiGenerations.enterpriseId, enterpriseId),
        eq(aiGenerations.leadId, leadId),
        eq(aiGenerations.status, 'succeeded'),
        isNull(aiGenerations.deletedAt),
        sql`coalesce(${aiGenerations.output} ->> 'imageUrl', '') <> ''`,
        sql`${aiGenerations.id} not in ${publishedIds}`
      ))
      .orderBy(desc(aiGenerations.updatedAt), desc(aiGenerations.id));
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

  async publishScheme(input: {
    enterpriseId: bigint;
    leadId: bigint;
    workflowId: bigint;
    title: string;
    generationIds: bigint[];
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

    const uniqueIds = Array.from(new Map(input.generationIds.map((id) => [id.toString(), id])).values());
    if (!uniqueIds.length) return { kind: 'empty_selection' as const, lead };

    const workflowRows = await this.transaction
      .select({ id: aiWorkflows.id, title: aiWorkflows.title, leadId: aiWorkflows.leadId })
      .from(aiWorkflows)
      .where(and(
        eq(aiWorkflows.id, input.workflowId),
        eq(aiWorkflows.enterpriseId, input.enterpriseId),
        eq(aiWorkflows.leadId, input.leadId)
      ))
      .limit(1);
    const workflow = workflowRows[0];
    if (!workflow) return { kind: 'workflow_not_found' as const, lead };

    const generationRows = await this.transaction
      .select({
        id: aiGenerations.id,
        output: aiGenerations.output,
        workflowId: aiGenerations.workflowId,
        parentGenerationId: aiGenerations.parentGenerationId,
        status: aiGenerations.status,
        deletedAt: aiGenerations.deletedAt,
      })
      .from(aiGenerations)
      .where(and(
        inArray(aiGenerations.id, uniqueIds),
        eq(aiGenerations.enterpriseId, input.enterpriseId),
        eq(aiGenerations.leadId, input.leadId)
      ));
    const generationById = new Map(generationRows.map((row) => [row.id.toString(), row]));
    const publishable = uniqueIds.every((id) => {
      const generation = generationById.get(id.toString());
      return Boolean(
        generation
        && generation.workflowId === input.workflowId
        && generation.status === 'succeeded'
        && !generation.deletedAt
        && hasResultImage(generation.output)
      );
    });
    if (!publishable) return { kind: 'generation_not_publishable' as const, lead };

    const now = new Date();
    const title = input.title.trim() || workflow.title || '设计方案';
    const selectionSet = new Set(uniqueIds.map((id) => id.toString()));

    // Active publications that already exist for this workflow
    const workflowActivePubs = await this.transaction
      .select({
        generationId: aiGenerationPublications.generationId,
        sortOrder: aiGenerationPublications.sortOrder,
      })
      .from(aiGenerationPublications)
      .where(and(
        eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
        eq(aiGenerationPublications.leadId, input.leadId),
        eq(aiGenerationPublications.workflowId, input.workflowId),
        isNull(aiGenerationPublications.withdrawnAt)
      ));

    const existingSelectedPubs = await this.transaction
      .select({
        generationId: aiGenerationPublications.generationId,
        sortOrder: aiGenerationPublications.sortOrder,
      })
      .from(aiGenerationPublications)
      .where(and(
        eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
        eq(aiGenerationPublications.leadId, input.leadId),
        eq(aiGenerationPublications.workflowId, input.workflowId),
        inArray(aiGenerationPublications.generationId, uniqueIds),
        isNull(aiGenerationPublications.withdrawnAt)
      ));
    const existingSelectedSortByGen = new Map(existingSelectedPubs.map((row) => [row.generationId.toString(), row.sortOrder]));

    const parentGenerationIds = Array.from(new Set(generationRows
      .map((row) => row.parentGenerationId)
      .filter((id): id is bigint => Boolean(id))));
    const parentPubs = parentGenerationIds.length
      ? await this.transaction
        .select({
          generationId: aiGenerationPublications.generationId,
          sortOrder: aiGenerationPublications.sortOrder,
        })
        .from(aiGenerationPublications)
        .where(and(
          eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
          eq(aiGenerationPublications.leadId, input.leadId),
          eq(aiGenerationPublications.workflowId, input.workflowId),
          inArray(aiGenerationPublications.generationId, parentGenerationIds),
          isNull(aiGenerationPublications.withdrawnAt)
        ))
      : [];
    const parentSortByGen = new Map(parentPubs.map((row) => [row.generationId.toString(), row.sortOrder]));

    // 1) Withdraw any active publications for the selected generations in other workflows
    // to satisfy the unique constraint on (generation_id) when active.
    await this.transaction
      .update(aiGenerationPublications)
      .set({ withdrawnAt: now, withdrawnBy: input.publishedBy, updatedAt: now })
      .where(and(
        eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
        eq(aiGenerationPublications.leadId, input.leadId),
        inArray(aiGenerationPublications.generationId, uniqueIds),
        isNull(aiGenerationPublications.withdrawnAt),
        sql`${aiGenerationPublications.workflowId} is distinct from ${input.workflowId}`
      ));

    // 2) Replacement: if a selected generation was edited from a parent generation,
    // withdraw the parent publication (unless the parent itself is selected).
    const parentToWithdraw = new Set<bigint>();
    for (const generationId of uniqueIds) {
      const generation = generationById.get(generationId.toString());
      if (!generation?.parentGenerationId) continue;
      const parentId = generation.parentGenerationId;
      if (!parentSortByGen.has(parentId.toString())) continue;
      if (selectionSet.has(parentId.toString())) continue;
      parentToWithdraw.add(parentId);
    }
    const parentToWithdrawIds = Array.from(parentToWithdraw);
    if (parentToWithdrawIds.length) {
      await this.transaction
        .update(aiGenerationPublications)
        .set({ withdrawnAt: now, withdrawnBy: input.publishedBy, updatedAt: now })
        .where(and(
          eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
          eq(aiGenerationPublications.leadId, input.leadId),
          eq(aiGenerationPublications.workflowId, input.workflowId),
          inArray(aiGenerationPublications.generationId, parentToWithdrawIds),
          isNull(aiGenerationPublications.withdrawnAt)
        ));
    }

    // 3) Keep the scheme title in sync for all active images in this workflow.
    await this.transaction
      .update(aiGenerationPublications)
      .set({ schemeTitle: title, updatedAt: now })
      .where(and(
        eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
        eq(aiGenerationPublications.leadId, input.leadId),
        eq(aiGenerationPublications.workflowId, input.workflowId),
        isNull(aiGenerationPublications.withdrawnAt)
      ));

    // 4) Append new images to the end of the existing active order (except replaced parents).
    const withdrawnParentSortOrders = new Set(parentToWithdrawIds.map((id) => id.toString()));
    const remainingSortOrders = workflowActivePubs
      .filter((row) => !withdrawnParentSortOrders.has(row.generationId.toString()))
      .map((row) => row.sortOrder);
    const remainingMaxSortOrder = remainingSortOrders.length ? Math.max(...remainingSortOrders) : -1;
    let appendSortOrder = remainingMaxSortOrder + 1;

    // 5) Update existing publications for selected generations (and compute replacement sort orders).
    for (const generationId of uniqueIds) {
      const hasExisting = existingSelectedSortByGen.has(generationId.toString());
      if (!hasExisting) continue;
      const generation = generationById.get(generationId.toString());
      if (!generation) continue;
      const replacementParentId = generation.parentGenerationId;
      const replacementSort = replacementParentId && parentSortByGen.has(replacementParentId.toString())
        && !selectionSet.has(replacementParentId.toString())
        ? parentSortByGen.get(replacementParentId.toString())
        : undefined;
      const targetSortOrder = replacementSort ?? existingSelectedSortByGen.get(generationId.toString()) ?? 0;
      await this.transaction
        .update(aiGenerationPublications)
        .set({
          schemeTitle: title,
          sortOrder: targetSortOrder,
          publishedBy: input.publishedBy,
          publishedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
          eq(aiGenerationPublications.leadId, input.leadId),
          eq(aiGenerationPublications.workflowId, input.workflowId),
          eq(aiGenerationPublications.generationId, generationId),
          isNull(aiGenerationPublications.withdrawnAt)
        ));
    }

    // 6) Insert missing publications for newly selected generations.
    const missingIds = uniqueIds.filter((id) => !existingSelectedSortByGen.has(id.toString()));
    for (const generationId of missingIds) {
      const generation = generationById.get(generationId.toString());
      if (!generation) continue;

      const replacementParentId = generation.parentGenerationId;
      const replacementSort = replacementParentId && parentSortByGen.has(replacementParentId.toString())
        && !selectionSet.has(replacementParentId.toString())
        ? parentSortByGen.get(replacementParentId.toString())
        : undefined;

      const targetSortOrder = replacementSort ?? appendSortOrder;
      if (replacementSort === undefined) appendSortOrder += 1;

      await this.transaction.insert(aiGenerationPublications).values({
        enterpriseId: input.enterpriseId,
        leadId: input.leadId,
        generationId,
        workflowId: input.workflowId,
        schemeTitle: title,
        sortOrder: targetSortOrder,
        publishedBy: input.publishedBy,
        publishedAt: now,
      });
    }

    const publications = (await this.listActivePublications(input.enterpriseId, input.leadId))
      .filter((item) => item.publication.workflowId === input.workflowId);
    return { kind: 'published' as const, lead, publications, title };
  }

  async withdrawScheme(input: {
    enterpriseId: bigint;
    leadId: bigint;
    workflowId: bigint;
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
        eq(aiGenerationPublications.workflowId, input.workflowId),
        isNull(aiGenerationPublications.withdrawnAt)
      ))
      .returning();
    return { kind: rows[0] ? 'withdrawn' as const : 'publication_not_found' as const, lead, publications: rows };
  }
}
