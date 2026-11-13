import { specialists } from '../assistant/specialists/registry';
import { workflowIssue, type WorkflowIssue } from './errors';
import { hasOwn, isJsonScalar } from './guards';
import { WORKFLOW_BOUNDS, type JsonValue, type NodeType, type ValueType, type WorkflowNode } from './types';

export type CapabilityEffect = 'none' | 'read' | 'compose' | 'save' | 'deliver' | 'wait';

export const specialistNodeSettings = {
  projectRecords: [3, 5, 10],
  knowledgeScopes: ['authorized', 'enterprise', 'project'],
  knowledgeLimits: [1, 3, 5, 10],
  publicCoverage: ['subject', 'technical', 'test'],
  evidencePolicies: ['any', 'both', 'enterprise', 'public'],
  siteWaitDays: [1, 3, 7, 14, 30],
  reviewWaitDays: [1, 3, 7, 14, 30],
  issuePolicies: ['open_or_reuse', 'manager_only'],
  reviewMilestones: ['resolved', 'closed'],
} as const;

const specialistInputs: Readonly<Record<string, Readonly<Record<string, readonly [string, string]>>>> = {
  'read.specialist_knowledge': { project: ['read.specialist_project', 'project'] },
  'compose.stage_specialist.v2': {
    project: ['read.specialist_project', 'project'],
    enterprise: ['read.specialist_knowledge', 'enterprise'],
    publicStandard: ['read.specialist_public_standard', 'publicStandard'],
  },
  'condition.specialist_evidence': {
    enterprise: ['compose.stage_specialist.v2', 'hasEnterprise'],
    publicStandard: ['compose.stage_specialist.v2', 'hasPublic'],
    issue: ['compose.stage_specialist.v2', 'hasIssue'],
  },
  'compose.specialist_checklist': { analysis: ['compose.stage_specialist.v2', 'analysis'] },
  'compose.specialist_material_request': { analysis: ['compose.stage_specialist.v2', 'analysis'] },
  'wait.specialist_site_record.v2': { project: ['read.specialist_project', 'project'] },
  'save.specialist_issue.v2': { project: ['read.specialist_project', 'project'] },
  'wait.specialist_review': { issue: ['save.specialist_issue.v2', 'saveReceipt'] },
  'deliver.specialist_result': {
    analysis: ['compose.stage_specialist.v2', 'analysis'],
    review: ['wait.specialist_review', 'review'],
  },
};

export function specialistInputMatches(branched: boolean, target: WorkflowNode, input: string, source: WorkflowNode, output: string) {
  const binding = branched ? specialistInputs[target.capabilityRef]?.[input] : undefined;
  return !binding || source.capabilityRef === binding[0] && output === binding[1];
}

export interface CapabilitySpec {
  readonly type: NodeType;
  readonly typeVersion: number;
  readonly effect: CapabilityEffect;
  readonly inputs: Readonly<Record<string, ValueType>>;
  readonly outputs: Readonly<Record<string, ValueType>>;
  readonly configKeys: readonly string[];
  readonly permission?: string;
}

/**
 * Server-side capability whitelist for B0-B2. Imported definitions can only
 * reference these names; there is no HTTP, SQL, script or file capability.
 */
export const capabilityCatalog: Readonly<Record<string, CapabilitySpec>> = {
  'trigger.specialist_followup': {
    type: 'trigger', typeVersion: 1, effect: 'none', configKeys: ['eventType'],
    inputs: {}, outputs: { eventId: 'string', eventType: 'string', occurredAt: 'string' },
  },
  'read.specialist_project': {
    type: 'project_data', typeVersion: 1, effect: 'read', configKeys: ['recordLimit'], permission: 'project_progress',
    inputs: {}, outputs: { project: 'object' },
  },
  'read.specialist_knowledge': {
    type: 'knowledge_retrieval', typeVersion: 1, effect: 'read', configKeys: ['scope', 'topK'], permission: 'knowledge',
    inputs: { project: 'object' }, outputs: { enterprise: 'object' },
  },
  'read.specialist_public_standard': {
    type: 'public_search', typeVersion: 1, effect: 'read', configKeys: ['coverage'], permission: 'public_read',
    inputs: {}, outputs: { publicStandard: 'object' },
  },
  'compose.stage_specialist': {
    type: 'agent', typeVersion: 1, effect: 'compose', configKeys: ['agentId', 'agentVersion'],
    inputs: { project: 'object', enterprise: 'object', publicStandard: 'object' }, outputs: { analysis: 'object', ready: 'boolean' },
  },
  'compose.stage_specialist.v2': {
    type: 'agent', typeVersion: 2, effect: 'compose', configKeys: ['agentId', 'agentVersion'],
    permission: 'followup', inputs: { project: 'object', enterprise: 'object', publicStandard: 'object' },
    outputs: { analysis: 'object', hasEnterprise: 'boolean', hasPublic: 'boolean', hasIssue: 'boolean' },
  },
  'condition.specialist_evidence': {
    type: 'condition', typeVersion: 1, effect: 'none', configKeys: ['evidencePolicy'], permission: 'followup',
    inputs: { enterprise: 'boolean', publicStandard: 'boolean', issue: 'boolean' }, outputs: { branch: 'string' },
  },
  'compose.specialist_checklist': {
    type: 'checklist', typeVersion: 1, effect: 'none', configKeys: [], permission: 'followup',
    inputs: { analysis: 'object' }, outputs: { checklist: 'object_list' },
  },
  'compose.specialist_material_request': {
    type: 'request_material', typeVersion: 1, effect: 'none', configKeys: [], permission: 'followup',
    inputs: { analysis: 'object' }, outputs: { missing: 'string_list' },
  },
  'wait.specialist_site_record.v2': {
    type: 'wait_event', typeVersion: 2, effect: 'wait', configKeys: ['waitDays'], permission: 'followup',
    inputs: { project: 'object' }, outputs: { record: 'object' },
  },
  'save.specialist_issue.v2': {
    type: 'create_issue', typeVersion: 2, effect: 'save', configKeys: ['policy'], permission: 'followup',
    inputs: { project: 'object' }, outputs: { saved: 'boolean', saveReceipt: 'object' },
  },
  'save.specialist_issue': {
    type: 'create_issue', typeVersion: 1, effect: 'save', configKeys: [], permission: 'followup',
    inputs: { record: 'object' }, outputs: { saved: 'boolean', saveReceipt: 'object' },
  },
  'wait.specialist_site_record': {
    type: 'wait_event', typeVersion: 1, effect: 'wait', configKeys: [], permission: 'followup',
    inputs: { project: 'object' }, outputs: { record: 'object' },
  },
  'wait.specialist_review': {
    type: 'human_review', typeVersion: 1, effect: 'wait', configKeys: ['waitDays'], permission: 'followup',
    inputs: { issue: 'object' }, outputs: { review: 'object' },
  },
  'deliver.specialist_result': {
    type: 'output', typeVersion: 1, effect: 'deliver', configKeys: ['milestone'], permission: 'followup',
    inputs: { analysis: 'object', review: 'object' }, outputs: { delivered: 'boolean', deliveryReceipt: 'object' },
  },
  'trigger.stage_changed': {
    type: 'trigger',
    typeVersion: 1,
    effect: 'none',
    inputs: {},
    outputs: {
      eventId: 'string',
      eventType: 'string',
      occurredAt: 'string',
      stageKey: 'string',
      stageLabel: 'string',
    },
    configKeys: ['eventType'],
  },
  'trigger.period_report': {
    type: 'trigger',
    typeVersion: 1,
    effect: 'none',
    inputs: {},
    outputs: {
      eventId: 'string',
      eventType: 'string',
      occurredAt: 'string',
      periodKind: 'string',
      periodStart: 'string',
      periodEnd: 'string',
    },
    configKeys: ['eventType', 'periodKind'],
  },
  'read.project_context': {
    type: 'read_materials',
    typeVersion: 1,
    effect: 'read',
    inputs: { stageKey: 'string' },
    outputs: {
      stageKey: 'string',
      stageLabel: 'string',
      stageKnown: 'boolean',
      subscribed: 'boolean',
      receivers: 'object',
      receiverCount: 'number',
      reminderText: 'string',
    },
    configKeys: [],
  },
  'read.enterprise_craft': {
    type: 'read_materials',
    typeVersion: 1,
    effect: 'read',
    inputs: {},
    outputs: { craftEnabled: 'boolean', craftSummary: 'string' },
    configKeys: [],
  },
  'read.period_records': {
    type: 'read_materials',
    typeVersion: 1,
    effect: 'read',
    inputs: { periodKind: 'string', periodStart: 'string', periodEnd: 'string' },
    outputs: { records: 'object_list', recordCount: 'number', hasRecords: 'boolean' },
    configKeys: [],
  },
  'read.authorized_photos': {
    type: 'read_materials',
    typeVersion: 1,
    effect: 'read',
    inputs: { periodKind: 'string', periodStart: 'string', periodEnd: 'string' },
    outputs: { photos: 'object_list', photoCount: 'number' },
    configKeys: [],
  },
  'read.receiver_scope': {
    type: 'read_materials',
    typeVersion: 1,
    effect: 'read',
    inputs: {},
    outputs: { receivers: 'object', receiverCount: 'number' },
    configKeys: [],
  },
  'condition.compare_boolean': {
    type: 'condition',
    typeVersion: 1,
    effect: 'none',
    inputs: { left: 'boolean' },
    outputs: { result: 'boolean' },
    configKeys: ['op', 'right'],
  },
  'condition.compare_number': {
    type: 'condition',
    typeVersion: 1,
    effect: 'none',
    inputs: { left: 'number' },
    outputs: { result: 'boolean' },
    configKeys: ['op', 'right'],
  },
  'condition.compare_text': {
    type: 'condition',
    typeVersion: 1,
    effect: 'none',
    inputs: { left: 'string' },
    outputs: { result: 'boolean' },
    configKeys: ['op', 'right'],
  },
  'compose.stage_reminder_deterministic': {
    type: 'compose_content',
    typeVersion: 1,
    effect: 'none',
    inputs: { stageLabel: 'string' },
    outputs: { title: 'string', body: 'string' },
    configKeys: ['title', 'template'],
  },
  'compose.stage_reminder_model': {
    type: 'compose_content',
    typeVersion: 1,
    effect: 'compose',
    inputs: { stageLabel: 'string', craftSummary: 'string' },
    outputs: { title: 'string', body: 'string' },
    configKeys: [],
  },
  'compose.period_report': {
    type: 'compose_content',
    typeVersion: 1,
    effect: 'compose',
    inputs: {
      periodKind: 'string',
      periodStart: 'string',
      periodEnd: 'string',
      records: 'object_list',
      photos: 'object_list',
      recordCount: 'number',
      photoCount: 'number',
    },
    outputs: { title: 'string', body: 'string', missingItems: 'string_list' },
    configKeys: [],
  },
  'save.stage_reminder': {
    type: 'save_result',
    typeVersion: 1,
    effect: 'save',
    inputs: { title: 'string', body: 'string' },
    outputs: { saved: 'boolean', saveReceipt: 'object' },
    configKeys: [],
  },
  'save.period_report': {
    type: 'save_result',
    typeVersion: 1,
    effect: 'save',
    inputs: { title: 'string', body: 'string' },
    outputs: { saved: 'boolean', saveReceipt: 'object' },
    configKeys: [],
  },
  'deliver.inapp': {
    type: 'deliver_inapp',
    typeVersion: 1,
    effect: 'deliver',
    inputs: { receivers: 'object', title: 'string', body: 'string' },
    outputs: { delivered: 'boolean', deliveryReceipt: 'object' },
    configKeys: [],
  },
};

export function getCapability(capabilityRef: string): CapabilitySpec | undefined {
  return hasOwn(capabilityCatalog, capabilityRef) ? capabilityCatalog[capabilityRef] : undefined;
}

const booleanOps = new Set(['eq', 'ne']);
const numberOps = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
const optionalSpecialistConfig: Readonly<Record<string, Readonly<Record<string, readonly JsonValue[]>>>> = {
  'read.specialist_project': { recordLimit: specialistNodeSettings.projectRecords },
  'read.specialist_knowledge': { scope: specialistNodeSettings.knowledgeScopes, topK: specialistNodeSettings.knowledgeLimits },
  'read.specialist_public_standard': { coverage: specialistNodeSettings.publicCoverage },
  'wait.specialist_site_record.v2': { waitDays: specialistNodeSettings.siteWaitDays },
  'wait.specialist_review': { waitDays: specialistNodeSettings.reviewWaitDays },
  'save.specialist_issue.v2': { policy: specialistNodeSettings.issuePolicies },
  'deliver.specialist_result': { milestone: specialistNodeSettings.reviewMilestones },
};
const templatePlaceholder = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function validateCapabilityConfig(
  capabilityRef: string,
  spec: CapabilitySpec,
  config: Record<string, JsonValue>,
  path: string,
  issues: WorkflowIssue[],
): void {
  for (const key of Object.keys(config)) {
    if (!spec.configKeys.includes(key)) {
      issues.push(workflowIssue('unknown_config_key', `${path}.${key}`, `config key "${key}" is not allowed`));
    }
    if (!isJsonScalar(config[key])) {
      issues.push(workflowIssue('invalid_config_value', `${path}.${key}`, 'config values must be JSON scalars'));
    }
  }

  for (const [key, values] of Object.entries(optionalSpecialistConfig[capabilityRef] ?? {})) {
    if (config[key] !== undefined && !values.includes(config[key])) {
      issues.push(workflowIssue('invalid_specialist_config', `${path}.${key}`, 'select a supported value'));
    }
  }

  switch (capabilityRef) {
    case 'trigger.specialist_followup': {
      if (config.eventType !== 'specialist_followup') {
        issues.push(workflowIssue('invalid_trigger_config', `${path}.eventType`, 'specialist trigger requires eventType=specialist_followup'));
      }
      return;
    }
    case 'condition.specialist_evidence': {
      if (!specialistNodeSettings.evidencePolicies.some(value => value === config.evidencePolicy)) {
        issues.push(workflowIssue('invalid_condition', `${path}.evidencePolicy`, 'select a supported evidence policy'));
      }
      return;
    }
    case 'compose.stage_specialist':
    case 'compose.stage_specialist.v2': {
      const selected = typeof config.agentId === 'string' && typeof config.agentVersion === 'number'
        ? specialists.version(config.agentId, config.agentVersion) : undefined;
      if (!selected || selected.status === 'draft') {
        issues.push(workflowIssue('invalid_specialist', path, 'select a registered specialist version'));
      }
      return;
    }
    case 'trigger.stage_changed': {
      if (config.eventType !== 'stage_changed') {
        issues.push(workflowIssue('invalid_trigger_config', `${path}.eventType`, 'stage trigger requires eventType=stage_changed'));
      }
      return;
    }
    case 'trigger.period_report': {
      if (config.eventType !== 'period_report') {
        issues.push(workflowIssue('invalid_trigger_config', `${path}.eventType`, 'period trigger requires eventType=period_report'));
      }
      if (config.periodKind !== 'daily' && config.periodKind !== 'weekly') {
        issues.push(workflowIssue('invalid_trigger_config', `${path}.periodKind`, 'periodKind must be daily or weekly'));
      }
      return;
    }
    case 'condition.compare_boolean': {
      if (typeof config.op !== 'string' || !booleanOps.has(config.op)) {
        issues.push(workflowIssue('invalid_condition', `${path}.op`, 'boolean condition supports eq/ne'));
      }
      if (typeof config.right !== 'boolean') {
        issues.push(workflowIssue('invalid_condition', `${path}.right`, 'boolean condition needs a boolean right operand'));
      }
      return;
    }
    case 'condition.compare_number': {
      if (typeof config.op !== 'string' || !numberOps.has(config.op)) {
        issues.push(workflowIssue('invalid_condition', `${path}.op`, 'number condition supports eq/ne/gt/gte/lt/lte'));
      }
      if (typeof config.right !== 'number' || !Number.isFinite(config.right)) {
        issues.push(workflowIssue('invalid_condition', `${path}.right`, 'number condition needs a finite right operand'));
      }
      return;
    }
    case 'condition.compare_text': {
      if (typeof config.op !== 'string' || !booleanOps.has(config.op)) {
        issues.push(workflowIssue('invalid_condition', `${path}.op`, 'text condition supports eq/ne'));
      }
      if (typeof config.right !== 'string' || config.right.length > WORKFLOW_BOUNDS.maxConfigStringLength) {
        issues.push(workflowIssue('invalid_condition', `${path}.right`, 'text condition needs a bounded string operand'));
      }
      return;
    }
    case 'compose.stage_reminder_deterministic': {
      const title = config.title;
      const template = config.template;
      if (typeof title !== 'string' || title.trim() === '' || title.length > 120) {
        issues.push(workflowIssue('invalid_template', `${path}.title`, 'deterministic compose needs a short title'));
      }
      if (typeof template !== 'string' || template.trim() === '' || template.length > WORKFLOW_BOUNDS.maxConfigStringLength) {
        issues.push(workflowIssue('invalid_template', `${path}.template`, 'deterministic compose needs a bounded template'));
        return;
      }
      for (const match of template.matchAll(templatePlaceholder)) {
        const name = match[1] ?? '';
        if (!hasOwn(spec.inputs, name)) {
          issues.push(workflowIssue('unknown_template_placeholder', `${path}.template`, `placeholder "${name}" is not an input`));
        }
      }
      if (template.replace(templatePlaceholder, '').includes('{{')) {
        issues.push(workflowIssue('invalid_template', `${path}.template`, 'malformed placeholder syntax'));
      }
      return;
    }
    default:
      return;
  }
}
