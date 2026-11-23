import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { one, rows } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { fail } from '@/lib/assistant/contracts';
import { authorizeKnowledgeManager } from '@/lib/assistant/knowledge/manager';
import { definitionDigest } from '@/lib/native-workflow/compile';
import { getNativeWorkflowService } from '@/lib/native-workflow/configured-service';
import { stageWorkflowMetadata } from '@/lib/native-workflow/stage-consultation-template';
import { stageAgentRegistry } from './stage-agent-registry';
import { stageIdSchema, type StageId } from './stages';

const referenceSchema = z.strictObject({
  definitionId: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  revision: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type StageWorkflowRef = z.infer<typeof referenceSchema>;
export type StageWorkflowOption = StageWorkflowRef & { name: string; description: string };

const questionSchema = z.strictObject({
  title: z.string().trim().min(1).max(8), helper: z.string().trim().min(1).max(10), text: z.string().trim().min(1).max(200),
});
export type StageSuggestedQuestion = z.infer<typeof questionSchema>;

const agentInput = z.strictObject({
  expectedEnterpriseId: z.string().regex(/^[1-9]\d*$/),
  expectedVersion: z.number().int().nonnegative(),
  stageId: stageIdSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(240),
  enabled: z.boolean(),
  workflows: z.array(referenceSchema).max(12),
  defaultWorkflowId: referenceSchema.shape.definitionId.nullable(),
  suggestedQuestions: z.array(questionSchema).max(3).default([]),
}).refine(input => new Set(input.workflows.map(item => item.definitionId)).size === input.workflows.length
  && (input.workflows.length ? input.workflows.some(item => item.definitionId === input.defaultWorkflowId) : input.defaultWorkflowId === null));

export type EnterpriseStageAgent = {
  stageId: StageId; name: string; description: string; version: number; enabled: boolean;
  workflows: StageWorkflowOption[]; defaultWorkflowId: string | null; suggestedQuestions: StageSuggestedQuestion[];
};
export type StageAgentSettings = {
  enterpriseId: string; agents: EnterpriseStageAgent[]; templates: StageWorkflowOption[];
};

const projection = sql`stage_id as "stageId", name, description, version, enabled,
  workflow_refs as workflows, default_workflow_id as "defaultWorkflowId", suggested_questions as "suggestedQuestions"`;

export async function readStageAgent(tx: PostgresTransaction, enterpriseId: string, stageId: StageId) {
  return one<EnterpriseStageAgent>(tx, sql`select ${projection} from app.assistant_stage_agents
    where enterprise_id=${enterpriseId} and stage_id=${stageId} for share`);
}

export async function publishedStageWorkflow(ref: StageWorkflowRef) {
  const { record } = await getNativeWorkflowService().getDefinition(ref.definitionId);
  const version = record.versions.find(item => item.revision === ref.revision);
  if (!version || version.definition.inputSchema.eventType !== 'stage_consultation'
    || version.definition.definitionId !== ref.definitionId || version.definition.revision !== ref.revision
    || version.digest !== ref.digest || definitionDigest(version.definition) !== ref.digest) {
    fail('stage_workflow_unavailable', 409);
  }
  return version;
}

async function publishedOptions() {
  const service = getNativeWorkflowService();
  const summaries = (await service.listDefinitions()).filter(item => item.eventType === 'stage_consultation' && item.latestPublishedRevision);
  const definitions = await Promise.all(summaries.map(item => service.getDefinition(item.definitionId)));
  return definitions.flatMap(({ record }) => [...record.versions].reverse().map(version => ({
    definitionId: record.definitionId, revision: version.revision, digest: version.digest, ...stageWorkflowMetadata(version.definition),
  })));
}

export async function listStageAgentSettings(enterpriseId: string, adminId: string): Promise<StageAgentSettings> {
  const stored = await withTenantTransaction(enterpriseId, async tx => {
    await authorizeKnowledgeManager(tx, enterpriseId, adminId);
    return rows<EnterpriseStageAgent>(tx, sql`select ${projection} from app.assistant_stage_agents where enterprise_id=${enterpriseId}`);
  });
  return { enterpriseId, templates: await publishedOptions(), agents: stageAgentRegistry.activeList().map(base =>
    stored.find(item => item.stageId === base.stageId) ?? { stageId: base.stageId, name: base.name, description: base.description,
      version: 0, enabled: false, workflows: [], defaultWorkflowId: null, suggestedQuestions: [] }) };
}

export async function saveStageAgent(enterpriseId: string, adminId: string, raw: unknown, create: boolean) {
  const parsed = agentInput.safeParse(raw);
  if (!parsed.success || create !== (parsed.data.expectedVersion === 0)) fail('invalid_message', 422);
  const input = parsed.data;
  if (input.expectedEnterpriseId !== enterpriseId) fail('settings_enterprise_changed');
  return withTenantTransaction(enterpriseId, async tx => {
    await authorizeKnowledgeManager(tx, enterpriseId, adminId);
    // Allow a manager to stop a binding even when its template store is unavailable.
    const current = await one<EnterpriseStageAgent>(tx, sql`select ${projection} from app.assistant_stage_agents
      where enterprise_id=${enterpriseId} and stage_id=${input.stageId} for update`);
    if ((current?.version ?? 0) !== input.expectedVersion) fail('version_conflict');
    const unchangedRefs = current && input.workflows.every(ref => current.workflows.some(old =>
      old.definitionId === ref.definitionId && old.revision === ref.revision && old.digest === ref.digest));
    const refs = JSON.stringify(await Promise.all(input.workflows.map(async ref => {
      if (!input.enabled && unchangedRefs) return current.workflows.find(old => old.definitionId === ref.definitionId)!;
      const published = await publishedStageWorkflow(ref);
      return { ...ref, ...stageWorkflowMetadata(published.definition) };
    })));
    const row = create
      ? await one<EnterpriseStageAgent>(tx, sql`insert into app.assistant_stage_agents
          (enterprise_id,stage_id,version,name,description,enabled,workflow_refs,default_workflow_id,suggested_questions)
          values(${enterpriseId},${input.stageId},1,${input.name},${input.description},${input.enabled},${refs}::jsonb,${input.defaultWorkflowId},${JSON.stringify(input.suggestedQuestions)}::jsonb)
          on conflict (enterprise_id,stage_id) do nothing returning ${projection}`)
      : await one<EnterpriseStageAgent>(tx, sql`update app.assistant_stage_agents set name=${input.name},description=${input.description},
          enabled=${input.enabled},workflow_refs=${refs}::jsonb,default_workflow_id=${input.defaultWorkflowId},
          suggested_questions=${JSON.stringify(input.suggestedQuestions)}::jsonb,version=version+1,updated_at=now()
          where enterprise_id=${enterpriseId} and stage_id=${input.stageId} and version=${input.expectedVersion} returning ${projection}`);
    if (!row) fail('version_conflict');
    return row;
  });
}
