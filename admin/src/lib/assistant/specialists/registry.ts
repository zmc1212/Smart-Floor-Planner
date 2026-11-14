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
const permissions = ['knowledge', 'public_read', 'project_progress', 'photo', 'drawing', 'followup'] as const;

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
  kind: z.enum(['enterprise_standard', 'public_standard', 'project_fact', 'project_drawing']),
  ref: z.strictObject({ type: z.string(), id: z.string(), version: z.string().min(1) }),
  hash: z.string(),
  standardId: z.string().optional(),
  page: z.number().int().positive().optional(),
  originalHash: z.string().optional(),
  url: z.string().optional(),
  elementId: z.string().optional(),
  coordinateReference: z.string().optional(),
  drawingType: z.string().optional(),
});

export const specialistCheckStatuses = ['enterprise_explicit', 'public_explicit', 'project_supported',
  'drawing_supported', 'general_advice', 'evidence_missing', 'not_applicable', 'pending_site_verification',
  'pending_review', 'reviewed'] as const;
export type SpecialistCheckStatus = typeof specialistCheckStatuses[number];
export const specialistCheckCategories = ['base_course', 'pipe_root', 'corner', 'embed', 'enterprise_process',
  'material_record', 'waterproof_layer', 'test_acceptance', 'protection', 'next_process',
  'drawing_review', 'strong_current_points', 'weak_current_points', 'distribution_circuits',
  'water_supply', 'drainage', 'pipe_fixing', 'site_records', 'test_basis', 'concealment',
  'rectification', 'other'] as const;
export type SpecialistCheckCategory = typeof specialistCheckCategories[number];
export const specialistCheckCategoryLabels: Record<SpecialistCheckCategory, string> = {
  base_course: '基层施工条件', pipe_root: '管根和管线周边', corner: '阴阳角', embed: '预埋部位',
  enterprise_process: '企业工艺要求', material_record: '材料和施工记录', waterproof_layer: '防水层施工',
  test_acceptance: '试验及验收依据', protection: '后续保护', next_process: '后续工序衔接',
  drawing_review: '施工前图纸核对', strong_current_points: '强电点位', weak_current_points: '弱电点位',
  distribution_circuits: '配电箱及回路', water_supply: '给水管路', drainage: '排水管路',
  pipe_fixing: '管线连接及固定', site_records: '现场照片和施工记录', test_basis: '试验及检查依据',
  concealment: '隐蔽工程前确认', rectification: '整改及复核', other: '其他',
};
export const specialistCheckStatusLabels: Record<SpecialistCheckStatus, string> = {
  enterprise_explicit: '企业标准明确', public_explicit: '公开规范明确', project_supported: '项目记录支持',
  drawing_supported: '当前图纸支持', general_advice: '通用建议', evidence_missing: '资料缺失',
  not_applicable: '不适用', pending_site_verification: '待现场核实',
  pending_review: '待人工复核', reviewed: '已正式复核',
};

// New fields are optional so already-published runs and historical checklists
// still parse. New checks always populate every binding below.
const drawingRefSchema = z.strictObject({
  projectId: z.string(),
  roomId: z.string(),
  drawingId: z.string(),
  drawingType: z.string(),
  drawingVersion: z.string().min(1),
  revision: z.string().min(1),
  sourceHash: z.string().min(1),
  pageNumber: z.number().int().positive().nullable(),
  coordinateReference: z.string(),
  elementId: z.string().nullable(),
  uncertainty: z.array(z.string()),
  verificationStatus: z.enum(['extracted', 'text_only', 'unreadable', 'not_provided', 'not_run']),
});
export type SpecialistDrawingRef = z.infer<typeof drawingRefSchema>;

const checkSchema = z.strictObject({
  text: z.string(),
  basis: z.array(z.enum(['enterprise_standard', 'public_standard', 'project_fact', 'project_drawing', 'general_advice', 'unverified', 'not_applicable'])).min(1),
  evidenceRefs: z.array(evidenceRefSchema),
  drawingRefs: z.array(drawingRefSchema).optional(),
  checkId: z.string().min(1).optional(),
  projectId: z.string().nullable().optional(),
  roomId: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  agentId: z.string().min(1).optional(),
  agentVersion: z.number().int().positive().optional(),
  workflowRunId: z.string().min(1).optional(),
  workflowRevision: z.number().int().positive().optional(),
  workflowDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  publicEditionStatus: z.enum(['current', 'unknown']).optional(),
  evidenceVersions: z.array(z.string().min(1)).optional(),
  sourceType: z.enum(['enterprise_standard', 'public_standard', 'project_record', 'project_drawing', 'general_advice', 'mixed', 'unverified']).optional(),
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
  stagePhases: z.array(z.string().min(1)).optional(),
  supportedIntents: z.array(z.enum(intents)).min(1),
  knowledgeScopes: z.array(z.enum(scopes)),
  knowledgeDomains: z.array(z.enum(['strong_current', 'weak_current', 'water_supply', 'drainage', 'concealment'])).optional(),
  workflowTemplateId: z.string().min(1).nullable(),
  publicStandardId: z.string().min(1).optional(),
  toolPermissions: z.array(z.enum(permissions)),
  inputSchema: z.literal('stage-specialist-input-v1'),
  outputSchema: z.literal('stage-specialist-output-v1'),
  version: z.number().int().positive(),
  status: z.enum(['active', 'candidate', 'disabled', 'draft']),
}).refine(value => !['active', 'candidate'].includes(value.status) || value.workflowTemplateId !== null);

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
    list: () => [...versions.values()],
  };
}

export const waterproofAgentId = 'waterproof-specialist';
export const waterproofChecklistAgentVersion = 2;
export const electricalAgentId = 'electrical-specialist';
export const electricalChecklistAgentVersion = 1;
export const electricalWorkflowTemplateId = 'electrical-inspection-v1';
/** Versions that bind workflow revision/digest and the three-branch checklist.
 * Waterproof V1 and other historical versions stay readable without it. */
export const checklistAgentVersions: Readonly<Record<string, number>> = {
  [waterproofAgentId]: waterproofChecklistAgentVersion,
  [electricalAgentId]: electricalChecklistAgentVersion,
};
export function isChecklistAgentVersion(agent: Readonly<SpecialistRegistration> | undefined) {
  return !!agent && checklistAgentVersions[agent.agentId] === agent.version;
}

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
  drawings?: import('./drawing').ElectricalDrawingRead;
};
export const waterproofWorkflowTemplateId = 'waterproof-inspection-v1';
const schemaVersions = {
  inputSchema: 'stage-specialist-input-v1', outputSchema: 'stage-specialist-output-v1',
} as const;

const waterproofV1: SpecialistRegistration = {
  ...schemaVersions, agentId: waterproofAgentId, version: 1, status: 'active',
  name: '防水阶段专业 Agent', description: '解释施工准备、节点密封、验收与后续工序，并协助跟进待复核事项。',
  supportedStages: ['waterproof'], supportedIntents: [...intents], knowledgeScopes: [...scopes],
  workflowTemplateId: waterproofWorkflowTemplateId, publicStandardId: 'GB55030-2022',
  toolPermissions: ['knowledge', 'public_read', 'project_progress', 'photo', 'followup'],
};

/** I7.0 registers a real electrical agent with its own knowledge scope,
 * checklist and workflow template. It never reuses the waterproof scope. */
const electricalV1: SpecialistRegistration = {
  // Active after the I7.0 offline validation; the real acceptance can still
  // demote it to candidate if a blocking domain failure is confirmed.
  ...schemaVersions, agentId: electricalAgentId, version: electricalChecklistAgentVersion, status: 'active',
  name: '水电阶段专业 Agent',
  description: '解释水电施工准备、强电、弱电、给水、排水、隐蔽工程、检查整改与交付，并协助跟进待核实事项。',
  supportedStages: ['utilities'],
  stagePhases: ['水电施工准备', '水电施工', '水电隐蔽工程', '水电检查及整改', '水电阶段交付'],
  supportedIntents: [...intents], knowledgeScopes: [...scopes],
  knowledgeDomains: ['strong_current', 'weak_current', 'water_supply', 'drainage', 'concealment'],
  workflowTemplateId: electricalWorkflowTemplateId, publicStandardId: 'GB55020-2021', toolPermissions: [...permissions],
};

export const specialists = specialistRegistry([
  waterproofV1,
  { ...waterproofV1, version: waterproofChecklistAgentVersion, status: 'candidate' },
  electricalV1,
  ...([
    ['masonry', '泥木'], ['painting', '油漆'],
    ['installation', '安装'], ['handover', '竣工验收'],
  ] as const).map(([stage, name]): SpecialistRegistration => ({
    ...schemaVersions, agentId: `${stage}-specialist`, version: 1, status: 'draft',
    name: `${name}阶段专业 Agent`, description: `${name}阶段`, supportedStages: [stage],
    supportedIntents: ['advice'], knowledgeScopes: [], workflowTemplateId: null, toolPermissions: [],
  })),
]);

/** Candidates are reachable only through an explicit published workflow
 * version. Ordinary consultation continues to resolve the active registry. */
export function isPublishedSpecialistVersion(agent: Readonly<SpecialistRegistration> | undefined): agent is Readonly<SpecialistRegistration> {
  return !!agent && (agent.status === 'active' || agent.status === 'candidate');
}

export function bindSpecialistInput(agent: Readonly<SpecialistRegistration>, input: SpecialistInput): SpecialistInput {
  return inputSchema.parse({
    ...input,
    knowledgeScopes: input.knowledgeScopes.filter(scope => agent.knowledgeScopes.includes(scope)),
    toolPermissions: input.toolPermissions.filter(tool => agent.toolPermissions.includes(tool)),
  });
}

export const parseSpecialistOutput = (value: unknown): SpecialistOutput => outputSchema.parse(value);
