import { and, count, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import { aiGenerations, aiWorkflows } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiWorkflowRecord = typeof aiWorkflows.$inferSelect;
export type NewAiWorkflow = typeof aiWorkflows.$inferInsert;
export type AiWorkflowUpdate = Partial<
  Omit<NewAiWorkflow, 'id' | 'enterpriseId' | 'leadId' | 'operatorId' | 'createdAt' | 'updatedAt'>
>;

export type AiWorkflowLeadSummary = {
  leadId: bigint;
  count: number;
  latestWorkflowId: bigint;
  latestWorkflowTitle: string;
  latestUpdatedAt: Date;
};

export class AiWorkflowRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async list(options: {
    id?: bigint;
    leadId?: bigint;
    leadIds?: bigint[];
    operatorId?: bigint;
    status?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const filters: SQL[] = [];
    if (options.id) filters.push(eq(aiWorkflows.id, options.id));
    if (options.leadId) filters.push(eq(aiWorkflows.leadId, options.leadId));
    if (options.leadIds) {
      if (options.leadIds.length === 0) return { rows: [], total: 0, page, limit };
      filters.push(inArray(aiWorkflows.leadId, options.leadIds));
    }
    if (options.operatorId) filters.push(eq(aiWorkflows.operatorId, options.operatorId));
    if (options.status) filters.push(eq(aiWorkflows.status, options.status));
    const where = filters.length ? and(...filters) : undefined;
    const [rows, totals] = await Promise.all([
      this.transaction
        .select()
        .from(aiWorkflows)
        .where(where)
        .orderBy(desc(aiWorkflows.updatedAt), desc(aiWorkflows.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction.select({ value: count() }).from(aiWorkflows).where(where),
    ]);
    return { rows, total: Number(totals[0]?.value ?? 0), page, limit };
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiWorkflows)
      .where(eq(aiWorkflows.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Workflows are ordered once, so the first row for each lead is its latest
   * active workflow while the same scan preserves the aggregate count.
   */
  async summarizeActiveByLeadIds(leadIds: bigint[]): Promise<AiWorkflowLeadSummary[]> {
    if (!leadIds.length) return [];
    const rows = await this.transaction
      .select()
      .from(aiWorkflows)
      .where(and(inArray(aiWorkflows.leadId, leadIds), eq(aiWorkflows.status, 'active')))
      .orderBy(desc(aiWorkflows.updatedAt), desc(aiWorkflows.id));
    const summaries = new Map<bigint, AiWorkflowLeadSummary>();
    for (const workflow of rows) {
      const current = summaries.get(workflow.leadId);
      if (current) {
        current.count += 1;
        continue;
      }
      summaries.set(workflow.leadId, {
        leadId: workflow.leadId,
        count: 1,
        latestWorkflowId: workflow.id,
        latestWorkflowTitle: workflow.title,
        latestUpdatedAt: workflow.updatedAt,
      });
    }
    return [...summaries.values()];
  }

  async listActiveForProjectIndex(input: { leadIds: bigint[]; operatorId: bigint }) {
    if (!input.leadIds.length) return [];
    return this.transaction
      .select()
      .from(aiWorkflows)
      .where(and(
        inArray(aiWorkflows.leadId, input.leadIds),
        eq(aiWorkflows.operatorId, input.operatorId),
        eq(aiWorkflows.status, 'active')
      ))
      .orderBy(desc(aiWorkflows.updatedAt), desc(aiWorkflows.id));
  }

  async create(input: NewAiWorkflow) {
    const rows = await this.transaction.insert(aiWorkflows).values(input).returning();
    return rows[0];
  }

  async update(id: bigint, values: AiWorkflowUpdate) {
    const rows = await this.transaction
      .update(aiWorkflows)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiWorkflows.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updateActive(id: bigint, values: AiWorkflowUpdate) {
    const workflowRows = await this.transaction
      .select()
      .from(aiWorkflows)
      .where(and(eq(aiWorkflows.id, id), eq(aiWorkflows.status, 'active')))
      .for('update')
      .limit(1);
    if (!workflowRows[0]) return null;
    return this.update(id, values);
  }

  /**
   * Replaces the selected baseline only after both the active workflow and its
   * succeeded generation are locked in the same tenant transaction.
   */
  async selectSucceededGenerationBaseline(workflowId: bigint, generationId: bigint) {
    const workflowRows = await this.transaction
      .select()
      .from(aiWorkflows)
      .where(and(eq(aiWorkflows.id, workflowId), eq(aiWorkflows.status, 'active')))
      .for('update')
      .limit(1);
    const workflow = workflowRows[0];
    if (!workflow) return null;

    const generationRows = await this.transaction
      .select()
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.id, generationId),
          eq(aiGenerations.workflowId, workflow.id),
          eq(aiGenerations.status, 'succeeded'),
          isNull(aiGenerations.deletedAt)
        )
      )
      .for('update')
      .limit(1);
    const generation = generationRows[0];
    if (!generation) return null;

    await this.transaction
      .update(aiGenerations)
      .set({ isSelectedBaseline: false, updatedAt: new Date() })
      .where(eq(aiGenerations.workflowId, workflow.id));

    const selectedRows = await this.transaction
      .update(aiGenerations)
      .set({ isSelectedBaseline: true, updatedAt: new Date() })
      .where(eq(aiGenerations.id, generation.id))
      .returning();
    const selected = selectedRows[0];
    if (!selected) throw new Error('AI generation disappeared during baseline selection');

    const updatedRows = await this.transaction
      .update(aiWorkflows)
      .set({
        selectedGenerationId: selected.id,
        lastGenerationId: selected.id,
        ...(selected.nextRecommendedStage
          ? { currentStageKey: selected.nextRecommendedStage }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(aiWorkflows.id, workflow.id))
      .returning();
    const updated = updatedRows[0];
    if (!updated) throw new Error('AI workflow disappeared during baseline selection');
    return { workflow: updated, generation: selected };
  }

  /** Applies the existing automatic stage progression after a scenario result settles. */
  async applySucceededScenarioGeneration(generationId: bigint) {
    const generationRows = await this.transaction
      .select()
      .from(aiGenerations)
      .where(and(
        eq(aiGenerations.id, generationId),
        eq(aiGenerations.type, 'scenario'),
        eq(aiGenerations.status, 'succeeded'),
        isNull(aiGenerations.deletedAt)
      ))
      .for('update')
      .limit(1);
    const generation = generationRows[0];
    if (!generation?.workflowId) return null;

    const workflowRows = await this.transaction
      .select()
      .from(aiWorkflows)
      .where(and(eq(aiWorkflows.id, generation.workflowId), eq(aiWorkflows.status, 'active')))
      .for('update')
      .limit(1);
    const workflow = workflowRows[0];
    if (!workflow) return null;

    if (workflow.lastGenerationId) {
      const lastRows = await this.transaction
        .select({ createdAt: aiGenerations.createdAt })
        .from(aiGenerations)
        .where(eq(aiGenerations.id, workflow.lastGenerationId))
        .limit(1);
      if (lastRows[0]?.createdAt && lastRows[0].createdAt >= generation.createdAt) {
        return { workflow, generation, selected: generation.isSelectedBaseline, advanced: false };
      }
    }

    const stageKey = generation.stageKey;
    const nextStage = generation.nextRecommendedStage || workflow.currentStageKey;
    if (stageKey !== 'base_render' && stageKey !== 'soft_furnishing') {
      const updated = await this.update(workflow.id, {
        lastGenerationId: generation.id,
        currentStageKey: nextStage,
      });
      return { workflow: updated!, generation, selected: false, advanced: true };
    }

    const earlier = await this.transaction
      .select({ id: aiGenerations.id })
      .from(aiGenerations)
      .where(and(
        eq(aiGenerations.workflowId, workflow.id),
        eq(aiGenerations.stageKey, stageKey),
        eq(aiGenerations.status, 'succeeded'),
        isNull(aiGenerations.deletedAt),
        lt(aiGenerations.createdAt, generation.createdAt)
      ))
      .limit(1);
    if (earlier[0]) {
      const updated = await this.update(workflow.id, { lastGenerationId: generation.id });
      return { workflow: updated!, generation, selected: false, advanced: false };
    }

    await this.transaction
      .update(aiGenerations)
      .set({ isSelectedBaseline: false, updatedAt: new Date() })
      .where(eq(aiGenerations.workflowId, workflow.id));
    const selectedRows = await this.transaction
      .update(aiGenerations)
      .set({ isSelectedBaseline: true, updatedAt: new Date() })
      .where(eq(aiGenerations.id, generation.id))
      .returning();
    const selected = selectedRows[0];
    if (!selected) throw new Error('AI generation disappeared during workflow synchronization');
    const updated = await this.update(workflow.id, {
      lastGenerationId: selected.id,
      selectedGenerationId: selected.id,
      currentStageKey: nextStage,
    });
    if (!updated) throw new Error('AI workflow disappeared during workflow synchronization');
    return { workflow: updated, generation: selected, selected: true, advanced: true };
  }

  /**
   * The workflow and free-creation result are locked together so competing
   * attachment requests cannot select two different baseline generations.
   */
  async attachSucceededFreeCreationGeneration(workflowId: bigint, generationId: bigint) {
    const workflowRows = await this.transaction
      .select()
      .from(aiWorkflows)
      .where(and(eq(aiWorkflows.id, workflowId), eq(aiWorkflows.status, 'active')))
      .for('update')
      .limit(1);
    const workflow = workflowRows[0];
    if (!workflow) return null;

    const generationRows = await this.transaction
      .select()
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.id, generationId),
          eq(aiGenerations.type, 'free_create'),
          eq(aiGenerations.status, 'succeeded'),
          isNull(aiGenerations.deletedAt)
        )
      )
      .for('update')
      .limit(1);
    const generation = generationRows[0];
    if (!generation) return null;
    if (generation.workflowId && generation.workflowId !== workflow.id) {
      throw new Error('AI generation is already attached to another workflow');
    }

    const isFirstSelectedGeneration = workflow.selectedGenerationId === null;
    if (isFirstSelectedGeneration) {
      await this.transaction
        .update(aiGenerations)
        .set({ isSelectedBaseline: false, updatedAt: new Date() })
        .where(eq(aiGenerations.workflowId, workflow.id));
    }

    const attachedRows = await this.transaction
      .update(aiGenerations)
      .set({
        workflowId: workflow.id,
        leadId: workflow.leadId,
        stageKey: 'base_render',
        sourceAssetRole: 'base_render',
        nextRecommendedStage: 'soft_furnishing',
        isSelectedBaseline: isFirstSelectedGeneration,
        updatedAt: new Date(),
      })
      .where(eq(aiGenerations.id, generation.id))
      .returning();
    const attached = attachedRows[0];
    if (!attached) throw new Error('AI generation disappeared during workflow attachment');

    const workflowUpdate = {
      lastGenerationId: attached.id,
      ...(isFirstSelectedGeneration
        ? { selectedGenerationId: attached.id, currentStageKey: 'soft_furnishing' }
        : {}),
      updatedAt: new Date(),
    };
    const updatedWorkflowRows = await this.transaction
      .update(aiWorkflows)
      .set(workflowUpdate)
      .where(eq(aiWorkflows.id, workflow.id))
      .returning();
    const updatedWorkflow = updatedWorkflowRows[0];
    if (!updatedWorkflow) throw new Error('AI workflow disappeared during generation attachment');
    return { workflow: updatedWorkflow, generation: attached };
  }
}
