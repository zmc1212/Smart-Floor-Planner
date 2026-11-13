import { z } from 'zod';
import type { ModelMessage } from '../contracts/model';
import type { Evidence } from '../contracts';

export const specialistProtocol = 'stage-specialist-v1';
export const specialistModel = {
  providerKey: 'bailian',
  logicalModel: 'deepseek-flash',
  model: 'deepseek-v4.1-flash-1017',
} as const;

const intents = ['advice', 'enterprise_standard', 'public_standard', 'project_progress', 'photo', 'followup'] as const;
const scopes = ['enterprise', 'public_standard', 'project'] as const;
const permissions = ['knowledge', 'public_read', 'project_progress', 'photo', 'followup'] as const;

const inputSchema = z.strictObject({
  question: z.string().min(1).max(4000),
  conversation: z.array(z.custom<ModelMessage>(message => !!message && typeof message === 'object' && 'role' in message)),
  enterpriseId: z.string(),
  projectId: z.string().nullable(),
  stage: z.string(),
  room: z.string().nullable(),
  knowledgeScopes: z.array(z.enum(scopes)),
  toolPermissions: z.array(z.enum(permissions)),
});

const evidenceRefSchema = z.strictObject({
  kind: z.enum(['enterprise_standard', 'public_standard', 'project_fact']),
  ref: z.strictObject({ type: z.string(), id: z.string(), version: z.string().min(1) }),
  hash: z.string(),
  standardId: z.string().optional(),
  page: z.number().int().positive().optional(),
  originalHash: z.string().optional(),
  url: z.string().optional(),
});

export const specialistCheckStatuses = ['enterprise_explicit', 'public_explicit', 'project_supported',
  'general_advice', 'evidence_missing', 'not_applicable', 'pending_review', 'reviewed'] as const;
export type SpecialistCheckStatus = typeof specialistCheckStatuses[number];
export const specialistCheckCategories = ['base_course', 'pipe_root', 'corner', 'embed', 'enterprise_process',
  'material_record', 'waterproof_layer', 'test_acceptance', 'protection', 'next_process', 'other'] as const;
export type SpecialistCheckCategory = typeof specialistCheckCategories[number];
export const specialistCheckCategoryLabels: Record<SpecialistCheckCategory, string> = {
  base_course: '基层施工条件', pipe_root: '管根和管线周边', corner: '阴阳角', embed: '预埋部位',
  enterprise_process: '企业工艺要求', material_record: '防水材料和施工记录', waterproof_layer: '防水层施工',
  test_acceptance: '试验及验收依据', protection: '后续保护', next_process: '下一道工序条件', other: '其他',
};
export const specialistCheckStatusLabels: Record<SpecialistCheckStatus, string> = {
  enterprise_explicit: '企业标准明确', public_explicit: '公开规范明确', project_supported: '项目记录支持',
  general_advice: '通用建议', evidence_missing: '资料缺失', not_applicable: '不适用',
  pending_review: '待人工确认', reviewed: '已正式复核',
};

// New fields are optional so already-published runs and historical checklists
// still parse. New checks always populate every binding below.
const checkSchema = z.strictObject({
  text: z.string(),
  basis: z.array(z.enum(['enterprise_standard', 'public_standard', 'project_fact', 'general_advice', 'unverified', 'not_applicable'])).min(1),
  evidenceRefs: z.array(evidenceRefSchema),
  checkId: z.string().min(1).optional(),
  projectId: z.string().nullable().optional(),
  roomId: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  agentId: z.string().min(1).optional(),
  agentVersion: z.number().int().positive().optional(),
  workflowRunId: z.string().min(1).optional(),
  evidenceVersions: z.array(z.string().min(1)).optional(),
  sourceType: z.enum(['enterprise_standard', 'public_standard', 'project_record', 'general_advice', 'mixed', 'unverified']).optional(),
  applicability: z.enum(['applicable', 'not_applicable', 'unknown']).optional(),
  currentProjectState: z.string().nullable().optional(),
  checkStatus: z.enum(specialistCheckStatuses).optional(),
  needsHumanReview: z.boolean().optional(),
  category: z.enum(specialistCheckCategories).optional(),
});

export type SpecialistEvidenceRef = z.infer<typeof evidenceRefSchema>;
export type SpecialistCheck = z.infer<typeof checkSchema>;

const outputSchema = z.strictObject({
  analysis: z.string(),
  evidence: z.array(z.custom<Evidence>(item => !!item && typeof item === 'object' && 'ref' in item && 'hash' in item)),
  confirmedFacts: z.array(z.string()),
  openQuestions: z.array(z.string()),
  suggestedActions: z.array(z.string()),
  needsHumanReview: z.boolean(),
  needsWorkflow: z.boolean(),
  receipt: z.strictObject({ runId: z.string(), issueId: z.string().nullable(), eventId: z.string().nullable() }).nullable(),
  agentId: z.string(),
  agentVersion: z.number().int().positive(),
  projectId: z.string().nullable(),
  roomId: z.string().nullable(),
  stage: z.string(),
  originalMessageId: z.string(),
  workflowRunId: z.string().nullable(),
  issueId: z.string().nullable(),
  evidenceRefs: z.array(evidenceRefSchema),
  evidenceVersions: z.array(z.string()),
  requestedChecks: z.array(checkSchema),
  unresolvedItems: z.array(z.string()),
  humanReviewRequirement: z.strictObject({ required: z.boolean(), issueId: z.string().nullable(),
    role: z.literal('manager'), reviewVersion: z.number().int().positive().nullable() }).nullable(),
});

const registration = z.strictObject({
  agentId: z.string().regex(/^[a-z]+-specialist$/),
  name: z.string().min(1),
  description: z.string().min(1),
  supportedStages: z.array(z.string().min(1)).min(1),
  supportedIntents: z.array(z.enum(intents)).min(1),
  knowledgeScopes: z.array(z.enum(scopes)),
  workflowTemplateId: z.string().min(1).nullable(),
  publicStandardId: z.string().min(1).optional(),
  toolPermissions: z.array(z.enum(permissions)),
  inputSchema: z.literal('stage-specialist-input-v1'),
  outputSchema: z.literal('stage-specialist-output-v1'),
  version: z.number().int().positive(),
  status: z.enum(['active', 'disabled', 'draft']),
}).refine(value => value.status !== 'active' || value.workflowTemplateId !== null);

export type SpecialistRegistration = z.infer<typeof registration>;
export type SpecialistInput = z.infer<typeof inputSchema>;
export type SpecialistOutput = z.infer<typeof outputSchema>;

export function specialistRegistry(registrations: readonly SpecialistRegistration[]) {
  const versions = new Map<string, Readonly<SpecialistRegistration>>();
  const active = new Map<string, Readonly<SpecialistRegistration>>();
  for (const value of registrations) {
    const item = Object.freeze(registration.parse(value));
    const key = `${item.agentId}@${item.version}`;
    if (versions.has(key) || item.status === 'active' && active.has(item.agentId)) {
      throw new Error('duplicate_specialist_registration');
    }
    versions.set(key, item);
    if (item.status === 'active') active.set(item.agentId, item);
  }
  return {
    active: (agentId: string) => active.get(agentId),
    version: (agentId: string, version: number) => versions.get(`${agentId}@${version}`),
  };
}

export const waterproofAgentId = 'waterproof-specialist';

export type SpecialistRunBinding = {
  delegationId: string;
  workflowRunId: string;
  agentId?: string;
  agentVersion?: number;
  projectId?: string;
  roomId?: string;
  roomName?: string;
  projectRecordLimit?: number;
  knowledgeScope?: 'authorized' | 'enterprise' | 'project';
  knowledgeTopK?: number;
  publicCoverage?: 'subject' | 'technical' | 'test';
};
export const waterproofWorkflowTemplateId = 'waterproof-inspection-v1';
const schemaVersions = {
  inputSchema: 'stage-specialist-input-v1', outputSchema: 'stage-specialist-output-v1',
} as const;

export const specialists = specialistRegistry([
  {
    ...schemaVersions, agentId: waterproofAgentId, version: 1, status: 'active',
    name: '防水阶段专业 Agent', description: '解释施工准备、节点密封、验收与后续工序，并协助跟进待复核事项。',
    supportedStages: ['waterproof'], supportedIntents: [...intents], knowledgeScopes: [...scopes],
    workflowTemplateId: waterproofWorkflowTemplateId, publicStandardId: 'GB55030-2022', toolPermissions: [...permissions],
  },
  ...([
    ['electrical', '水电'], ['masonry', '泥木'], ['painting', '油漆'],
    ['installation', '安装'], ['handover', '竣工验收'],
  ] as const).map(([stage, name]): SpecialistRegistration => ({
    ...schemaVersions, agentId: `${stage}-specialist`, version: 1, status: 'draft',
    name: `${name}阶段专业 Agent`, description: `${name}阶段`, supportedStages: [stage],
    supportedIntents: ['advice'], knowledgeScopes: [], workflowTemplateId: null, toolPermissions: [],
  })),
]);

export function bindSpecialistInput(agent: Readonly<SpecialistRegistration>, input: SpecialistInput): SpecialistInput {
  return inputSchema.parse({
    ...input,
    knowledgeScopes: input.knowledgeScopes.filter(scope => agent.knowledgeScopes.includes(scope)),
    toolPermissions: input.toolPermissions.filter(tool => agent.toolPermissions.includes(tool)),
  });
}

export const parseSpecialistOutput = (value: unknown): SpecialistOutput => outputSchema.parse(value);
