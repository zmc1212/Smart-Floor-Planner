import { z } from 'zod';
import { stageDefinitions, stageIdSchema, stageForConstructionKey, type StageId } from './stages';
import { stageKnowledgeRegistry } from './stage-knowledge';

export const stageAgentIntents = ['stage_knowledge', 'reminder', 'progress', 'todo', 'weekly_report', 'specialist_handoff'] as const;
export type StageAgentIntent = typeof stageAgentIntents[number];
export const stageAgentPermissions = ['knowledge', 'project_progress', 'todo_read', 'weekly_report', 'specialist_handoff'] as const;
export type StageAgentPermission = typeof stageAgentPermissions[number];

export const stageAgentRegistrationSchema = z.strictObject({
  agentId: z.string().regex(/^stage-[a-z][a-z0-9-]{1,63}$/u),
  stageId: stageIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  supportedIntents: z.array(z.enum(stageAgentIntents)).min(1),
  knowledgePackId: z.string().regex(/^stage-knowledge-[a-z_]+-v\d+$/u),
  reminderPolicyId: z.string().regex(/^stage-reminder-[a-z_]+-v\d+$/u),
  weeklyReportTemplateId: z.string().regex(/^stage-weekly-[a-z_]+-v\d+$/u),
  toolPermissions: z.array(z.enum(stageAgentPermissions)),
  supportedConstructionStageKeys: z.array(z.string().min(1)).min(1),
  version: z.number().int().positive(),
  status: z.enum(['active', 'candidate', 'draft', 'disabled']),
});
export type StageAgentRegistration = z.infer<typeof stageAgentRegistrationSchema>;

const descriptions: Record<StageId, string> = {
  pre_construction: '整理装修前需求、资料、预算边界和开工条件。',
  design: '解释设计阶段的需求整理、图纸确认、版本变更和交底。',
  demolition: '解释拆改前的结构安全、物业要求、成品保护和现场留存。',
  utilities: '解释水电点位、管线、隐蔽前核对和现场记录；深入专业判断转交水电专业 Agent。',
  masonry: '解释泥木阶段的材料、铺贴、吊顶、湿区衔接和现场留存。',
  painting: '解释油漆阶段的基层、涂饰、保护和瑕疵记录。',
  installation: '解释安装阶段的设备核对、现场条件、顺序和试运行记录。',
  furnishing: '解释软装阶段的家具尺寸、动线、进场和成品保护。',
  completion: '解释完工阶段的资料、遗留事项、查看和交付记录。',
  occupancy: '解释入住后的报修、保修、原记录追溯和日常维护。',
};

/** One registration per stage. The runtime is shared; only configuration and
 * knowledge differ. Ten copies of a runtime are explicitly forbidden. */
export const stageAgentRegistrations: readonly StageAgentRegistration[] = stageDefinitions.map(stage => ({
  agentId: 'stage-' + stage.stageId.replace(/_/gu, '-'),
  stageId: stage.stageId,
  name: stage.name + '阶段 Agent',
  description: descriptions[stage.stageId],
  supportedIntents: stage.stageId === 'utilities'
    ? [...stageAgentIntents]
    : stageAgentIntents.filter(intent => intent !== 'specialist_handoff'),
  knowledgePackId: `stage-knowledge-${stage.stageId}-v1`,
  reminderPolicyId: `stage-reminder-${stage.stageId}-v1`,
  weeklyReportTemplateId: `stage-weekly-${stage.stageId}-v1`,
  toolPermissions: stage.stageId === 'utilities'
    ? [...stageAgentPermissions]
    : stageAgentPermissions.filter(permission => permission !== 'specialist_handoff'),
  supportedConstructionStageKeys: [...stage.constructionKeys],
  version: 1,
  status: 'active',
}));

export const stageAgentRegistry = (() => {
  const versions = new Map<string, StageAgentRegistration>();
  const activeByStage = new Map<StageId, StageAgentRegistration>();
  for (const value of stageAgentRegistrations) {
    const item = Object.freeze(stageAgentRegistrationSchema.parse(value));
    const key = `${item.agentId}@${item.version}`;
    if (versions.has(key)) throw new Error('duplicate_stage_agent_registration');
    if (item.status === 'active' && activeByStage.has(item.stageId)) throw new Error('duplicate_active_stage_agent');
    const pack = stageKnowledgeRegistry.get(item.stageId);
    if (!pack || pack.packId !== item.knowledgePackId) throw new Error('stage_agent_knowledge_pack_mismatch');
    if (item.supportedConstructionStageKeys.join(',') !== stageDefinitions
      .find(stage => stage.stageId === item.stageId)!.constructionKeys.join(',')) throw new Error('stage_agent_construction_key_mismatch');
    versions.set(key, item);
    if (item.status === 'active') activeByStage.set(item.stageId, item);
  }
  if (activeByStage.size !== stageDefinitions.length) throw new Error('stage_agent_stage_coverage_incomplete');
  return {
    active: (stageId: StageId) => activeByStage.get(stageId),
    byAgentId: (agentId: string) => [...versions.values()].find(agent => agent.agentId === agentId) ?? null,
    forConstructionKey: (key: string | null | undefined) => {
      const stage = stageForConstructionKey(key);
      return stage ? activeByStage.get(stage.stageId) ?? null : null;
    },
    list: () => [...versions.values()],
    activeList: () => [...activeByStage.values()],
  };
})();

export function isStageAgentRegistration(value: unknown): value is StageAgentRegistration {
  return stageAgentRegistrationSchema.safeParse(value).success;
}
