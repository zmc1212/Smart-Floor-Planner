import { workflowIssue, type WorkflowIssue } from './errors';
import { isJsonScalar } from './guards';
import { WORKFLOW_BOUNDS, type JsonValue, type NodeType, type ValueType } from './types';

export type CapabilityEffect = 'none' | 'read' | 'compose' | 'save' | 'deliver';

export interface CapabilitySpec {
  readonly type: NodeType;
  readonly typeVersion: number;
  readonly effect: CapabilityEffect;
  readonly inputs: Readonly<Record<string, ValueType>>;
  readonly outputs: Readonly<Record<string, ValueType>>;
  readonly configKeys: readonly string[];
}

/**
 * Server-side capability whitelist for B0-B2. Imported definitions can only
 * reference these names; there is no HTTP, SQL, script or file capability.
 */
export const capabilityCatalog: Readonly<Record<string, CapabilitySpec>> = {
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
  return capabilityCatalog[capabilityRef];
}

const booleanOps = new Set(['eq', 'ne']);
const numberOps = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
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

  switch (capabilityRef) {
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
        if (!(name in spec.inputs)) {
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
