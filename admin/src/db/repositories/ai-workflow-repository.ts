import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { aiGenerations, aiWorkflows } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiWorkflowRecord = typeof aiWorkflows.$inferSelect;
export type NewAiWorkflow = typeof aiWorkflows.$inferInsert;
export type AiWorkflowUpdate = Partial<
  Omit<NewAiWorkflow, 'id' | 'enterpriseId' | 'leadId' | 'operatorId' | 'createdAt' | 'updatedAt'>
>;

export class AiWorkflowRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async list(options: {
    leadId?: bigint;
    operatorId?: bigint;
    status?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const filters: SQL[] = [];
    if (options.leadId) filters.push(eq(aiWorkflows.leadId, options.leadId));
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
