import { fail, fingerprint } from '../contracts';
import type { ModelTool } from '../contracts/model';
import { parseMaterialQuery } from './materials';

export const ownerQuestionScopeProtocol = 'owner-question-scope-v1';
const choices = ['materials', 'site', 'knowledge_and_site'] as const;
type Scope = typeof choices[number];
export type OwnerQuestionIdentity = {
  enterpriseId: string;
  conversationId: string;
  runId: string;
  messageId: string;
  leadId: string;
  question: string;
};

export function ownerQuestionMaterialTool(tool: ModelTool): ModelTool {
  if (tool.name !== 'query_materials') return tool;
  return { ...tool,
    description: '本人项目问项先分范围。索取获权正式档案或原记录用 materials。进度、排期、实际点位、两张图不一致待现场决定等用 site；如果同时明确追问通用工艺、核对步骤或企业标准，用 knowledge_and_site。承接上一问只补充房间和实际差异时按当前新增问项判断，不把之前已经回答的清单再算作新问题。只有知识的问题用 search_knowledge，不查本人材料。',
    parameters: { ...tool.parameters,
      properties: { ...tool.parameters.properties as object, scope: { type: 'string', enum: [...choices] } },
      required: [...tool.parameters.required as string[], 'scope'] },
  };
}

export function readOwnerMaterialInput(input: Record<string, unknown>) {
  const { scope, ...query } = input;
  if (!choices.includes(scope as Scope)) fail('invalid_message', 422);
  return { scope: scope as Scope, query: parseMaterialQuery(query) };
}

export function ownerQuestionScope(identity: OwnerQuestionIdentity, scope: 'site' | 'knowledge_and_site') {
  return { protocol: ownerQuestionScopeProtocol, scope, binding: fingerprint({ identity, scope }) };
}

export function readOwnerQuestionScope(receipt: unknown, identity: OwnerQuestionIdentity) {
  const value = receipt as ReturnType<typeof ownerQuestionScope>;
  if (!value || (value.scope !== 'site' && value.scope !== 'knowledge_and_site')
    || fingerprint(value) !== fingerprint(ownerQuestionScope(identity, value.scope))) fail('context_changed');
  return value.scope;
}
