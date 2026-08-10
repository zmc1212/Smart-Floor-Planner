import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  adminUsers,
  aiCreationBatchReferenceAssets,
  aiCreationBatches,
  aiCreationModelProfiles,
  aiCreationTaskReferenceAssets,
  aiCreationTasks,
  aiGenerations,
  aiProviderAttempts,
  mediaAssets,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type MediaAssetRecord = typeof mediaAssets.$inferSelect;
export type AiCreationTaskRecord = typeof aiCreationTasks.$inferSelect;
export type AiCreationBatchRecord = typeof aiCreationBatches.$inferSelect;
export type AiGenerationRecord = typeof aiGenerations.$inferSelect;
export type AiProviderAttemptRecord = typeof aiProviderAttempts.$inferSelect;

export type AiCreationTaskView = AiCreationTaskRecord & {
  referenceAssetIds: bigint[];
  batches: Array<AiCreationBatchRecord & {
    referenceAssetIds: bigint[];
    generations: AiGenerationRecord[];
  }>;
};

function nonEmptyIds(ids: bigint[]) {
  return ids.length ? ids : [BigInt(-1)];
}

export class AiCreationRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async listTasks(options: {
    page?: number;
    limit?: number;
    query?: string;
  } = {}) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(30, Math.max(1, options.limit ?? 12));
    const filters: SQL[] = [
      eq(aiCreationTasks.status, 'active'),
      sql`${aiCreationTasks.deletedAt} is null`,
    ];
    if (options.query?.trim()) {
      const query = options.query.trim().replace(/[%_]/g, '\\$&');
      filters.push(or(
        ilike(aiCreationTasks.title, `%${query}%`),
        ilike(aiCreationTasks.prompt, `%${query}%`)
      )!);
    }
    const where = and(...filters);
    const [tasks, total] = await Promise.all([
      this.transaction
        .select()
        .from(aiCreationTasks)
        .where(where)
        .orderBy(desc(aiCreationTasks.updatedAt), desc(aiCreationTasks.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction
        .select({ value: count() })
        .from(aiCreationTasks)
        .where(where),
    ]);
    return { tasks, total: Number(total[0]?.value ?? 0), page, limit };
  }

  async findTask(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiCreationTasks)
      .where(and(eq(aiCreationTasks.id, id), sql`${aiCreationTasks.deletedAt} is null`))
      .limit(1);
    return rows[0] ?? null;
  }

  async loadTaskView(id: bigint): Promise<AiCreationTaskView | null> {
    const task = await this.findTask(id);
    if (!task) return null;
    const taskRefs = await this.transaction
      .select({ assetId: aiCreationTaskReferenceAssets.assetId })
      .from(aiCreationTaskReferenceAssets)
      .where(eq(aiCreationTaskReferenceAssets.taskId, id))
      .orderBy(asc(aiCreationTaskReferenceAssets.position));
    const batches = await this.transaction
      .select()
      .from(aiCreationBatches)
      .where(eq(aiCreationBatches.taskId, id))
      .orderBy(desc(aiCreationBatches.sequence));
    const batchIds = batches.map((batch) => batch.id);
    const [batchRefs, generations] = batchIds.length
      ? await Promise.all([
          this.transaction
            .select()
            .from(aiCreationBatchReferenceAssets)
            .where(inArray(aiCreationBatchReferenceAssets.batchId, batchIds))
            .orderBy(asc(aiCreationBatchReferenceAssets.position)),
          this.transaction
            .select()
            .from(aiGenerations)
            .where(inArray(aiGenerations.creationBatchId, batchIds))
            .orderBy(desc(aiGenerations.createdAt)),
        ])
      : [[], []] as const;
    const refsByBatch = new Map<bigint, bigint[]>();
    for (const ref of batchRefs) refsByBatch.set(ref.batchId, [...(refsByBatch.get(ref.batchId) ?? []), ref.assetId]);
    const generationsByBatch = new Map<bigint, AiGenerationRecord[]>();
    for (const generation of generations) {
      if (!generation.creationBatchId) continue;
      generationsByBatch.set(generation.creationBatchId, [
        ...(generationsByBatch.get(generation.creationBatchId) ?? []),
        generation,
      ]);
    }
    return {
      ...task,
      referenceAssetIds: taskRefs.map((ref) => ref.assetId),
      batches: batches.map((batch) => ({
        ...batch,
        referenceAssetIds: refsByBatch.get(batch.id) ?? [],
        generations: generationsByBatch.get(batch.id) ?? [],
      })),
    };
  }

  async createTask(input: {
    enterpriseId: bigint;
    operatorId: bigint;
    modelProfileId: bigint;
    title: string;
    prompt: string;
    referenceAssetIds?: bigint[];
  }) {
    const taskRows = await this.transaction.insert(aiCreationTasks).values({
      enterpriseId: input.enterpriseId,
      operatorId: input.operatorId,
      modelProfileId: input.modelProfileId,
      title: input.title,
      prompt: input.prompt,
    }).returning();
    const task = taskRows[0];
    const ids = input.referenceAssetIds ?? [];
    if (ids.length) {
      await this.transaction.insert(aiCreationTaskReferenceAssets).values(
        ids.map((assetId, position) => ({ taskId: task.id, assetId, position }))
      );
    }
    return task;
  }

  async archiveTask(id: bigint, deletedAt = new Date()) {
    const rows = await this.transaction
      .update(aiCreationTasks)
      .set({ status: 'archived', deletedAt, updatedAt: deletedAt })
      .where(and(eq(aiCreationTasks.id, id), sql`${aiCreationTasks.deletedAt} is null`))
      .returning();
    if (!rows[0]) return null;
    await this.transaction
      .update(aiGenerations)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(aiGenerations.creationTaskId, id));
    return rows[0];
  }

  async nextBatchSequence(taskId: bigint) {
    // Serializes sequence allocation for concurrent submissions of one task.
    const task = await this.transaction
      .select({ id: aiCreationTasks.id })
      .from(aiCreationTasks)
      .where(eq(aiCreationTasks.id, taskId))
      .for('update')
      .limit(1);
    if (!task[0]) throw new Error('AI creation task does not exist');
    const rows = await this.transaction
      .select({ value: max(aiCreationBatches.sequence) })
      .from(aiCreationBatches)
      .where(eq(aiCreationBatches.taskId, taskId));
    return Number(rows[0]?.value ?? 0) + 1;
  }

  async createBatch(input: typeof aiCreationBatches.$inferInsert, referenceAssetIds: bigint[] = []) {
    const rows = await this.transaction.insert(aiCreationBatches).values(input).returning();
    const batch = rows[0];
    if (referenceAssetIds.length) {
      await this.transaction.insert(aiCreationBatchReferenceAssets).values(
        referenceAssetIds.map((assetId, position) => ({ batchId: batch.id, assetId, position }))
      );
    }
    return batch;
  }

  async findBatchForUpdate(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiCreationBatches)
      .where(eq(aiCreationBatches.id, id))
      .for('update')
      .limit(1);
    return rows[0] ?? null;
  }

  async listBatchGenerationsForUpdate(batchId: bigint) {
    return this.transaction
      .select()
      .from(aiGenerations)
      .where(eq(aiGenerations.creationBatchId, batchId))
      .orderBy(asc(aiGenerations.id))
      .for('update');
  }

  async updateBatch(id: bigint, values: Partial<typeof aiCreationBatches.$inferInsert>) {
    const rows = await this.transaction
      .update(aiCreationBatches)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiCreationBatches.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updateTask(id: bigint, values: Partial<typeof aiCreationTasks.$inferInsert>) {
    const rows = await this.transaction.update(aiCreationTasks)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiCreationTasks.id, id))
      .returning();
    return rows[0] ?? null;
  }

  createGeneration(input: typeof aiGenerations.$inferInsert) {
    return this.transaction.insert(aiGenerations).values(input).returning().then((rows) => rows[0]);
  }

  async updateGeneration(id: bigint, values: Partial<typeof aiGenerations.$inferInsert>) {
    const rows = await this.transaction.update(aiGenerations)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiGenerations.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async findGeneration(id: bigint) {
    const rows = await this.transaction.select().from(aiGenerations).where(eq(aiGenerations.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findGenerationForUpdate(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiGenerations)
      .where(eq(aiGenerations.id, id))
      .for('update')
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Claims due asynchronous provider polls without blocking parallel workers.
   * Callers must complete provider I/O after the surrounding transaction ends.
   */
  async claimDueProviderPollGenerations(input: {
    now: Date;
    limit: number;
    enterpriseId?: bigint;
  }) {
    const filters: SQL[] = [
      inArray(aiGenerations.type, [
        'free_create',
        'scenario',
        'miniprogram',
        'soft_furnishing_render',
        'floor_plan_style',
        'furnishing_render',
      ]),
      eq(aiGenerations.status, 'processing'),
      sql`${aiGenerations.deletedAt} is null`,
      sql`exists (
        select 1
        from ${aiProviderAttempts}
        where ${aiProviderAttempts.id} = ${aiGenerations.currentAttemptId}
          and ${aiProviderAttempts.enterpriseId} = ${aiGenerations.enterpriseId}
          and ${aiProviderAttempts.accepted} = true
          and ${aiProviderAttempts.status} in ('submitted', 'processing', 'unknown')
          and ${aiProviderAttempts.remoteTaskId} is not null
      )`,
      or(
        sql`${aiGenerations.externalTask} ->> 'nextPollAt' is null`,
        sql`(${aiGenerations.externalTask} ->> 'nextPollAt') <= ${input.now.toISOString()}`
      )!,
    ];
    if (input.enterpriseId) filters.push(eq(aiGenerations.enterpriseId, input.enterpriseId));

    return this.transaction
      .select()
      .from(aiGenerations)
      .where(and(...filters))
      .orderBy(
        sql`coalesce(${aiGenerations.externalTask} ->> 'nextPollAt', ${aiGenerations.updatedAt}::text)`,
        asc(aiGenerations.id)
      )
      .limit(input.limit)
      .for('update', { skipLocked: true });
  }

  async listGenerationsByIds(ids: bigint[]) {
    if (!ids.length) return [];
    return this.transaction.select().from(aiGenerations).where(inArray(aiGenerations.id, nonEmptyIds(ids)));
  }

  async listGenerationsByWorkflowId(workflowId: bigint) {
    return this.transaction
      .select()
      .from(aiGenerations)
      .where(and(eq(aiGenerations.workflowId, workflowId), sql`${aiGenerations.deletedAt} is null`))
      .orderBy(desc(aiGenerations.createdAt), desc(aiGenerations.id));
  }

  async listGenerationsByWorkflowIds(workflowIds: bigint[]) {
    if (!workflowIds.length) return [];
    return this.transaction
      .select()
      .from(aiGenerations)
      .where(and(
        inArray(aiGenerations.workflowId, workflowIds),
        sql`${aiGenerations.deletedAt} is null`
      ))
      .orderBy(desc(aiGenerations.createdAt), desc(aiGenerations.id));
  }

  listEnterpriseGenerationsWithOperators(enterpriseId: bigint, limit = 30) {
    const boundedLimit = Math.min(30, Math.max(1, limit));
    return this.transaction
      .select({
        generation: aiGenerations,
        operatorDisplayName: adminUsers.displayName,
        operatorUsername: adminUsers.username,
        attemptRemoteModel: aiProviderAttempts.remoteModel,
      })
      .from(aiGenerations)
      .leftJoin(adminUsers, eq(aiGenerations.operatorId, adminUsers.id))
      .leftJoin(aiProviderAttempts, eq(aiGenerations.currentAttemptId, aiProviderAttempts.id))
      .where(eq(aiGenerations.enterpriseId, enterpriseId))
      .orderBy(desc(aiGenerations.createdAt), desc(aiGenerations.id))
      .limit(boundedLimit);
  }

  async listHistory(input: {
    page?: number;
    limit?: number;
    types?: string[];
    stageKeys?: string[];
    workflowId?: bigint;
    leadId?: bigint;
  } = {}) {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));
    const filters: SQL[] = [sql`${aiGenerations.deletedAt} is null`];
    if (input.types?.length) filters.push(inArray(aiGenerations.type, input.types));
    if (input.stageKeys?.length) filters.push(inArray(aiGenerations.stageKey, input.stageKeys));
    if (input.workflowId) filters.push(eq(aiGenerations.workflowId, input.workflowId));
    if (input.leadId) filters.push(eq(aiGenerations.leadId, input.leadId));
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      this.transaction
        .select()
        .from(aiGenerations)
        .where(where)
        .orderBy(desc(aiGenerations.createdAt), desc(aiGenerations.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction.select({ value: count() }).from(aiGenerations).where(where),
    ]);
    return { rows, total: Number(totals[0]?.value ?? 0), page, limit };
  }

  async listMiniProgramGenerations(input: { operatorId: bigint; page?: number; limit?: number }) {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));
    const where = and(
      eq(aiGenerations.operatorId, input.operatorId),
      eq(aiGenerations.channel, 'miniprogram'),
      sql`${aiGenerations.deletedAt} is null`
    );
    const [rows, totals] = await Promise.all([
      this.transaction.select().from(aiGenerations).where(where)
        .orderBy(desc(aiGenerations.createdAt), desc(aiGenerations.id))
        .offset((page - 1) * limit).limit(limit),
      this.transaction.select({ value: count() }).from(aiGenerations).where(where),
    ]);
    return { rows, total: Number(totals[0]?.value ?? 0), page, limit };
  }

  /**
   * Returns only the completed whole-home renders for one staff member and one
   * formal floor plan. This is intentionally separate from paginated history:
   * a busy surveyor's chosen customer plan must not fall out of a recent page.
   */
  async listMiniProgramWholePlanRenderHeroGenerations(input: {
    operatorId: bigint;
    floorPlanId: bigint;
    limit?: number;
  }) {
    const limit = Math.min(5, Math.max(1, input.limit ?? 5));
    return this.transaction
      .select()
      .from(aiGenerations)
      .where(and(
        eq(aiGenerations.operatorId, input.operatorId),
        eq(aiGenerations.floorPlanId, input.floorPlanId),
        eq(aiGenerations.channel, 'miniprogram'),
        eq(aiGenerations.status, 'succeeded'),
        sql`${aiGenerations.input} ->> 'mode' = 'floor_plan_render'`,
        sql`${aiGenerations.input} -> 'roomData' ->> 'targetScope' = 'whole_floor_plan'`,
        sql`${aiGenerations.deletedAt} is null`
      ))
      .orderBy(desc(aiGenerations.createdAt), desc(aiGenerations.id))
      .limit(limit);
  }

  async listMiniProgramGenerationsByFloorPlanIds(floorPlanIds: bigint[]) {
    if (!floorPlanIds.length) return [];
    return this.transaction.select().from(aiGenerations).where(and(
      inArray(aiGenerations.floorPlanId, floorPlanIds),
      eq(aiGenerations.channel, 'miniprogram'),
      sql`${aiGenerations.deletedAt} is null`
    )).orderBy(desc(aiGenerations.createdAt), desc(aiGenerations.id));
  }

  createProviderAttempt(input: typeof aiProviderAttempts.$inferInsert) {
    return this.transaction.insert(aiProviderAttempts).values(input).returning().then((rows) => rows[0]);
  }

  async updateProviderAttempt(id: bigint, values: Partial<typeof aiProviderAttempts.$inferInsert>) {
    const rows = await this.transaction.update(aiProviderAttempts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiProviderAttempts.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async findProviderAttempt(id: bigint) {
    const rows = await this.transaction.select().from(aiProviderAttempts).where(eq(aiProviderAttempts.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listProviderAttempts(generationId: bigint) {
    return this.transaction.select().from(aiProviderAttempts)
      .where(eq(aiProviderAttempts.generationId, generationId))
      .orderBy(desc(aiProviderAttempts.createdAt));
  }

  async createMediaAsset(input: typeof mediaAssets.$inferInsert) {
    const rows = await this.transaction.insert(mediaAssets).values(input).returning();
    return rows[0];
  }

  async findMediaAsset(id: bigint) {
    const rows = await this.transaction.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), sql`${mediaAssets.deletedAt} is null`)).limit(1);
    return rows[0] ?? null;
  }

  async findMediaAssetForUpdate(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), sql`${mediaAssets.deletedAt} is null`))
      .for('update')
      .limit(1);
    return rows[0] ?? null;
  }

  async findMediaAssets(ids: bigint[]) {
    if (!ids.length) return [];
    return this.transaction.select().from(mediaAssets).where(and(inArray(mediaAssets.id, nonEmptyIds(ids)), sql`${mediaAssets.deletedAt} is null`));
  }

  async updateMediaAsset(id: bigint, values: Partial<typeof mediaAssets.$inferInsert>) {
    const rows = await this.transaction.update(mediaAssets)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(mediaAssets.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async countMediaAssets(ids: bigint[]) {
    if (!ids.length) return 0;
    const rows = await this.transaction.select({ value: count() }).from(mediaAssets)
      .where(and(inArray(mediaAssets.id, nonEmptyIds(ids)), sql`${mediaAssets.deletedAt} is null`));
    return Number(rows[0]?.value ?? 0);
  }
}

export { aiCreationModelProfiles };
