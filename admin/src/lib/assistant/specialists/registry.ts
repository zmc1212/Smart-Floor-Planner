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

const outputSchema = z.strictObject({
  analysis: z.string(),
  evidence: z.array(z.custom<Evidence>(item => !!item && typeof item === 'object' && 'ref' in item && 'hash' in item)),
  confirmedFacts: z.array(z.string()),
  openQuestions: z.array(z.string()),
  suggestedActions: z.array(z.string()),
  needsHumanReview: z.boolean(),
  needsWorkflow: z.boolean(),
  receipt: z.strictObject({ runId: z.string(), issueId: z.string().nullable(), eventId: z.string().nullable() }).nullable(),
});

const registration = z.strictObject({
  agentId: z.string().regex(/^[a-z]+-specialist$/),
  name: z.string().min(1),
  description: z.string().min(1),
  supportedStages: z.array(z.string().min(1)).min(1),
  supportedIntents: z.array(z.enum(intents)).min(1),
  knowledgeScopes: z.array(z.enum(scopes)),
  workflowTemplateId: z.string().min(1).nullable(),
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
export const waterproofWorkflowTemplateId = 'waterproof-inspection-v1';
const schemaVersions = {
  inputSchema: 'stage-specialist-input-v1', outputSchema: 'stage-specialist-output-v1',
} as const;

export const specialists = specialistRegistry([
  {
    ...schemaVersions, agentId: waterproofAgentId, version: 1, status: 'active',
    name: '防水阶段专业 Agent', description: '解释施工准备、节点密封、验收与后续工序，并协助跟进待复核事项。',
    supportedStages: ['waterproof'], supportedIntents: [...intents], knowledgeScopes: [...scopes],
    workflowTemplateId: waterproofWorkflowTemplateId, toolPermissions: [...permissions],
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
