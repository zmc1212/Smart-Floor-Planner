import { canonicalJson } from './canonical';
import { workflowIssue, type WorkflowIssue } from './errors';
import { hasOwn, isJsonScalar, isPlainObject } from './guards';
import { getCapability, specialistInputMatches, validateCapabilityConfig, type CapabilitySpec } from './registry';
import {
  WORKFLOW_BOUNDS,
  WORKFLOW_SCHEMA_VERSION,
  type JsonValue,
  type NodeType,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowInputRef,
  type WorkflowInputSchema,
  type WorkflowNode,
} from './types';

export type ValidationResult =
  | { readonly ok: true; readonly definition: WorkflowDefinition }
  | { readonly ok: false; readonly issues: readonly WorkflowIssue[] };

const NODE_TYPES: readonly NodeType[] = [
  'trigger',
  'read_materials',
  'condition',
  'compose_content',
  'save_result',
  'deliver_inapp',
  'project_data', 'knowledge_retrieval', 'public_search', 'agent', 'evidence_assessment', 'checklist', 'request_material', 'wait_event', 'human_review', 'create_issue', 'output',
];

const nodeIdPattern = /^[a-z][a-z0-9_-]{1,63}$/;
const definitionIdPattern = /^[a-z][a-z0-9_-]{2,63}$/;

const ROOT_KEYS = ['schemaVersion', 'definitionId', 'revision', 'entryNodeId', 'inputSchema', 'nodes', 'edges'];
const NODE_KEYS = ['nodeId', 'type', 'typeVersion', 'capabilityRef', 'config', 'inputs'];
const EDGE_KEYS = ['from', 'to', 'when'];
const INPUT_SCHEMA_KEYS = ['eventType', 'periodKind'];
const INPUT_REF_KEYS = ['nodeId', 'outputPath'];

const forbiddenKeys = new Set([
  'url',
  'uri',
  'href',
  'endpoint',
  'http',
  'https',
  'sql',
  'script',
  'code',
  'eval',
  'command',
  'exec',
  'secret',
  'token',
  'password',
  'credential',
  'credentials',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'filepath',
  'file_path',
  'file',
  'env',
]);

const forbiddenValuePatterns: readonly RegExp[] = [
  /(^|\s)[a-z][a-z0-9+.-]*:\/\//i,
  /^[A-Za-z]:[\\/]/,
  /^\\\\/,
  /^\/(etc|proc|sys|tmp|var|usr|home|root)(\/|$)/,
  /\$\{/,
  /\b(select\s+[^;]+\s+from|insert\s+into|update\s+[^;]+\s+set|delete\s+from|drop\s+table|alter\s+table)\b/i,
  /\b(require|import)\s*\(/,
  /^\s*javascript:/i,
  /^\s*data:/i,
];

function checkKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: WorkflowIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push(workflowIssue('unknown_field', `${path}.${key}`, `field "${key}" is not part of the contract`));
    }
  }
}

interface ScanContext {
  count: number;
  seen: WeakSet<object>;
  stack: WeakSet<object>;
  stopped: boolean;
}

function scanForbidden(
  value: unknown,
  path: string,
  issues: WorkflowIssue[],
  context: ScanContext,
  depth: number,
): void {
  if (context.stopped) return;
  context.count += 1;
  if (context.count > WORKFLOW_BOUNDS.maxScanNodes) {
    issues.push(workflowIssue('scan_nodes_exceeded', '$', 'imported definition exceeds the scan node limit'));
    context.stopped = true;
    return;
  }
  if (depth > WORKFLOW_BOUNDS.maxScanDepth) {
    issues.push(workflowIssue('scan_depth_exceeded', path, 'imported definition is nested too deeply'));
    context.stopped = true;
    return;
  }
  if (typeof value === 'string') {
    for (const pattern of forbiddenValuePatterns) {
      if (pattern.test(value)) {
        issues.push(
          workflowIssue('forbidden_content', path, 'definitions may not contain transport, SQL, code, secrets or file paths'),
        );
        return;
      }
    }
    return;
  }
  if (!Array.isArray(value) && !isPlainObject(value)) return;
  const container: object = value;
  if (context.stack.has(container)) {
    issues.push(workflowIssue('cyclic_structure', path, 'imported definition contains a cyclic structure'));
    return;
  }
  if (context.seen.has(container)) return;
  context.seen.add(container);
  context.stack.add(container);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbidden(item, `${path}[${index}]`, issues, context, depth + 1));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) {
        issues.push(workflowIssue('forbidden_key', `${path}.${key}`, `field "${key}" is not allowed in imported definitions`));
      }
      scanForbidden(item, `${path}.${key}`, issues, context, depth + 1);
    }
  }
  context.stack.delete(container);
}

function parseInputSchema(raw: unknown, path: string, issues: WorkflowIssue[]): WorkflowInputSchema | null {
  if (!isPlainObject(raw)) {
    issues.push(workflowIssue('invalid_input_schema', path, 'inputSchema must be an object'));
    return null;
  }
  checkKnownKeys(raw, INPUT_SCHEMA_KEYS, path, issues);
  const eventType = raw.eventType;
  if (eventType !== 'stage_changed' && eventType !== 'period_report' && eventType !== 'specialist_followup') {
    issues.push(workflowIssue('invalid_input_schema', `${path}.eventType`, 'eventType must be stage_changed, period_report or specialist_followup'));
    return null;
  }
  if (eventType === 'period_report') {
    if (raw.periodKind !== 'daily' && raw.periodKind !== 'weekly') {
      issues.push(workflowIssue('invalid_input_schema', `${path}.periodKind`, 'period reports require daily or weekly'));
      return null;
    }
    return { eventType, periodKind: raw.periodKind };
  }
  if (raw.periodKind !== undefined) {
    issues.push(workflowIssue('invalid_input_schema', `${path}.periodKind`, 'stage events do not take a period kind'));
  }
  return { eventType };
}

function parseNode(raw: unknown, path: string, issues: WorkflowIssue[]): WorkflowNode | null {
  if (!isPlainObject(raw)) {
    issues.push(workflowIssue('invalid_node', path, 'node must be an object'));
    return null;
  }
  checkKnownKeys(raw, NODE_KEYS, path, issues);
  const nodeId = raw.nodeId;
  if (typeof nodeId !== 'string' || !nodeIdPattern.test(nodeId)) {
    issues.push(workflowIssue('invalid_node_id', `${path}.nodeId`, 'nodeId must be a lowercase identifier'));
    return null;
  }
  const type = raw.type;
  if (typeof type !== 'string' || !NODE_TYPES.includes(type as NodeType)) {
    issues.push(workflowIssue('unknown_node_type', `${path}.type`, `node type "${String(type)}" is not supported`));
    return null;
  }
  const typeVersion = raw.typeVersion;
  const capabilityRef = raw.capabilityRef;
  if (typeof capabilityRef !== 'string' || capabilityRef === '') {
    issues.push(workflowIssue('invalid_capability_ref', `${path}.capabilityRef`, 'capabilityRef is required'));
    return null;
  }
  const spec = getCapability(capabilityRef);
  if (typeVersion !== (spec?.typeVersion ?? 1)) {
    issues.push(workflowIssue('unsupported_node_version', `${path}.typeVersion`, 'version is not supported by this capability'));
  }
  if (!spec) {
    issues.push(workflowIssue('unknown_capability', `${path}.capabilityRef`, `capability "${capabilityRef}" is not whitelisted`));
  } else {
    if (spec.type !== type) {
      issues.push(
        workflowIssue('capability_type_mismatch', `${path}.capabilityRef`, `capability "${capabilityRef}" belongs to ${spec.type}`),
      );
    }
    if (spec.typeVersion !== typeVersion) {
      issues.push(
        workflowIssue('capability_version_mismatch', `${path}.capabilityRef`, `capability "${capabilityRef}" has version ${spec.typeVersion}`),
      );
    }
  }

  const configRaw = raw.config ?? {};
  const config: Record<string, JsonValue> = {};
  if (!isPlainObject(configRaw)) {
    issues.push(workflowIssue('invalid_config', `${path}.config`, 'config must be an object'));
  } else {
    for (const [key, value] of Object.entries(configRaw)) {
      if (!isJsonScalar(value)) {
        issues.push(workflowIssue('invalid_config_value', `${path}.config.${key}`, 'config values must be JSON scalars'));
        continue;
      }
      config[key] = value as JsonValue;
    }
    if (spec) validateCapabilityConfig(capabilityRef, spec, config, `${path}.config`, issues);
    else checkKnownKeys(configRaw, [], `${path}.config`, issues);
  }

  const inputsRaw = raw.inputs ?? {};
  const inputs: Record<string, WorkflowInputRef> = {};
  if (!isPlainObject(inputsRaw)) {
    issues.push(workflowIssue('invalid_inputs', `${path}.inputs`, 'inputs must be an object'));
  } else {
    const entries = Object.entries(inputsRaw);
    if (entries.length > WORKFLOW_BOUNDS.maxInputsPerNode) {
      issues.push(workflowIssue('bounds_exceeded', `${path}.inputs`, 'too many input mappings'));
    }
    for (const [name, value] of entries) {
      const inputPath = `${path}.inputs.${name}`;
      if (spec && !hasOwn(spec.inputs, name)) {
        issues.push(workflowIssue('unknown_input', inputPath, `input "${name}" is not defined by ${capabilityRef}`));
      }
      if (!isPlainObject(value)) {
        issues.push(workflowIssue('invalid_input_ref', inputPath, 'input mapping must be { nodeId, outputPath }'));
        continue;
      }
      checkKnownKeys(value, INPUT_REF_KEYS, inputPath, issues);
      if (typeof value.nodeId !== 'string' || typeof value.outputPath !== 'string') {
        issues.push(workflowIssue('invalid_input_ref', inputPath, 'nodeId and outputPath must be strings'));
        continue;
      }
      inputs[name] = { nodeId: value.nodeId, outputPath: value.outputPath };
    }
    if (spec) {
      for (const required of Object.keys(spec.inputs)) {
        if (!hasOwn(inputsRaw, required) && !spec.optionalInputs?.includes(required)) {
          issues.push(workflowIssue('missing_input', `${path}.inputs.${required}`, `input "${required}" is required`));
        }
      }
    }
  }

  return {
    nodeId,
    type: type as NodeType,
    typeVersion: typeof typeVersion === 'number' ? typeVersion : 1,
    capabilityRef,
    config,
    inputs,
  };
}

function parseEdge(raw: unknown, path: string, issues: WorkflowIssue[]): WorkflowEdge | null {
  if (!isPlainObject(raw)) {
    issues.push(workflowIssue('invalid_edge', path, 'edge must be an object'));
    return null;
  }
  checkKnownKeys(raw, EDGE_KEYS, path, issues);
  const from = raw.from;
  const to = raw.to;
  if (typeof from !== 'string' || from === '' || typeof to !== 'string' || to === '') {
    issues.push(workflowIssue('invalid_edge', path, 'edge needs from/to node ids'));
    return null;
  }
  if (from === to) {
    issues.push(workflowIssue('self_edge', path, 'an edge may not point at its own node'));
    return null;
  }
  const when = raw.when;
  if (when !== undefined && when !== 'true' && when !== 'false' && when !== 'issue') {
    issues.push(workflowIssue('invalid_edge_branch', `${path}.when`, 'edge branch must be true, false or issue'));
    return null;
  }
  return when === undefined ? { from, to } : { from, to, when };
}

function reachableFrom(start: string, adjacency: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export function validateDefinition(raw: unknown): ValidationResult {
  const issues: WorkflowIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [workflowIssue('invalid_type', '$', 'definition must be an object')] };
  }
  checkKnownKeys(raw, ROOT_KEYS, '$', issues);
  scanForbidden(raw, '$', issues, { count: 0, seen: new WeakSet(), stack: new WeakSet(), stopped: false }, 0);

  if (raw.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    issues.push(workflowIssue('unsupported_schema_version', '$.schemaVersion', `schemaVersion must be ${WORKFLOW_SCHEMA_VERSION}`));
  }
  const definitionId = typeof raw.definitionId === 'string' ? raw.definitionId : '';
  if (!definitionIdPattern.test(definitionId)) {
    issues.push(workflowIssue('invalid_definition_id', '$.definitionId', 'definitionId must be a lowercase identifier'));
  }
  const revision = raw.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    issues.push(workflowIssue('invalid_revision', '$.revision', 'revision must be a positive integer'));
  }
  const entryNodeId = typeof raw.entryNodeId === 'string' && raw.entryNodeId !== '' ? raw.entryNodeId : '';
  if (entryNodeId === '') {
    issues.push(workflowIssue('invalid_entry_node', '$.entryNodeId', 'entryNodeId is required'));
  }
  const inputSchema = parseInputSchema(raw.inputSchema, '$.inputSchema', issues);

  const nodes: WorkflowNode[] = [];
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    issues.push(workflowIssue('invalid_nodes', '$.nodes', 'nodes must be a non-empty array'));
  } else {
    if (raw.nodes.length > WORKFLOW_BOUNDS.maxNodes) {
      issues.push(workflowIssue('bounds_exceeded', '$.nodes', `at most ${WORKFLOW_BOUNDS.maxNodes} nodes are allowed`));
    }
    raw.nodes.forEach((value, index) => {
      const node = parseNode(value, `$.nodes[${index}]`, issues);
      if (node) nodes.push(node);
    });
  }

  const edges: WorkflowEdge[] = [];
  if (!Array.isArray(raw.edges)) {
    issues.push(workflowIssue('invalid_edges', '$.edges', 'edges must be an array'));
  } else {
    if (raw.edges.length > WORKFLOW_BOUNDS.maxEdges) {
      issues.push(workflowIssue('bounds_exceeded', '$.edges', `at most ${WORKFLOW_BOUNDS.maxEdges} edges are allowed`));
    }
    raw.edges.forEach((value, index) => {
      const edge = parseEdge(value, `$.edges[${index}]`, issues);
      if (edge) edges.push(edge);
    });
  }

  const nodeMap = new Map<string, WorkflowNode>();
  const nodePath = new Map<string, string>();
  nodes.forEach((node, index) => {
    if (nodeMap.has(node.nodeId)) {
      issues.push(workflowIssue('duplicate_node', `$.nodes[${index}].nodeId`, `node "${node.nodeId}" is duplicated`));
      return;
    }
    nodeMap.set(node.nodeId, node);
    nodePath.set(node.nodeId, `$.nodes[${index}]`);
  });

  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const nodeId of nodeMap.keys()) {
    outgoing.set(nodeId, []);
    incoming.set(nodeId, []);
  }
  const edgeKeys = new Set<string>();
  edges.forEach((edge, index) => {
    const edgePath = `$.edges[${index}]`;
    if (!nodeMap.has(edge.from)) {
      issues.push(workflowIssue('unknown_edge_node', `${edgePath}.from`, `node "${edge.from}" does not exist`));
      return;
    }
    if (!nodeMap.has(edge.to)) {
      issues.push(workflowIssue('unknown_edge_node', `${edgePath}.to`, `node "${edge.to}" does not exist`));
      return;
    }
    const key = `${edge.from}->${edge.to}:${edge.when ?? ''}`;
    if (edgeKeys.has(key)) {
      issues.push(workflowIssue('duplicate_edge', edgePath, 'duplicate edge'));
      return;
    }
    edgeKeys.add(key);
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  });

  const specialist = inputSchema?.eventType === 'specialist_followup';
  const explicitAssessment = nodes.some(node => node.capabilityRef === 'read.specialist_evidence' || node.capabilityRef === 'compose.stage_specialist.v3');
  const branchedSpecialist = specialist && (explicitAssessment || nodes.some(node => node.typeVersion === 2 || node.capabilityRef === 'condition.specialist_evidence'));
  if (!specialist && nodes.some(node => node.capabilityRef === 'condition.specialist_evidence')) {
    issues.push(workflowIssue('capability_event_mismatch', '$.nodes', 'specialist evidence conditions require a specialist event'));
  }

  // Edge shape rules depend on the source node type.
  for (const node of nodeMap.values()) {
    const path = nodePath.get(node.nodeId) ?? '$.nodes';
    const nodeOut = outgoing.get(node.nodeId) ?? [];
    if (node.type === 'condition') {
      if (nodeOut.length === 0) {
        issues.push(workflowIssue('condition_without_branch', path, 'condition needs at least one branch'));
      }
      const branches = new Set<string>();
      const evidenceCondition = node.capabilityRef === 'condition.specialist_evidence';
      for (const edge of nodeOut) {
        if (!edge.when) {
          issues.push(workflowIssue('condition_branch_missing_when', path, 'condition edges must declare their branch'));
          continue;
        }
        if (branches.has(edge.when)) {
          issues.push(workflowIssue('duplicate_branch', path, `condition branch ${edge.when} is duplicated`));
        }
        if (edge.when === 'issue' && !evidenceCondition) {
          issues.push(workflowIssue('invalid_edge_branch', path, 'only the specialist evidence condition accepts an issue branch'));
        }
        branches.add(edge.when);
      }
      if (branchedSpecialist && (!branches.has('true') || !branches.has('false'))) {
        issues.push(workflowIssue('condition_branch_required', path, 'specialist conditions require true and false branches'));
      }
      if (evidenceCondition) {
        const targetCapabilities = { true: 'compose.specialist_checklist', false: 'compose.specialist_material_request',
          issue: 'save.specialist_issue.v2' } as const;
        for (const branch of ['true', 'false', 'issue'] as const) {
          const target = nodeMap.get(nodeOut.find(edge => edge.when === branch)?.to ?? '');
          if (target?.capabilityRef !== targetCapabilities[branch]) {
            issues.push(workflowIssue('invalid_specialist_branch', path, `${branch} must connect to ${targetCapabilities[branch]}`));
          }
        }
      }
    } else {
      for (const edge of nodeOut) {
        if (edge.when) {
          issues.push(workflowIssue('branch_on_non_condition', path, 'only condition nodes may declare when'));
        }
      }
      if (nodeOut.length > 1) {
        issues.push(workflowIssue('multiple_outgoing_edges', path, 'non-condition nodes have one outgoing edge'));
      }
      if (nodeOut.length === 0 && node.type !== 'save_result' && node.type !== 'deliver_inapp' && node.type !== 'output') {
        issues.push(workflowIssue('dangling_node', path, 'node output is not connected to a save or delivery node'));
      }
    }
  }

  const triggers = [...nodeMap.values()].filter((node) => node.type === 'trigger');
  if (triggers.length !== 1) {
    issues.push(workflowIssue('invalid_trigger_count', '$.nodes', 'exactly one trigger node is required'));
  } else if (entryNodeId !== '' && triggers[0]?.nodeId !== entryNodeId) {
    issues.push(workflowIssue('entry_not_trigger', '$.entryNodeId', 'entryNodeId must point at the trigger node'));
  }
  const entryNode = nodeMap.get(entryNodeId);
  if (entryNode && entryNode.type === 'trigger') {
    const entryOut = outgoing.get(entryNode.nodeId) ?? [];
    if (entryOut.length !== 1 || entryOut[0]?.when) {
      issues.push(workflowIssue('invalid_trigger_edges', `$.nodes`, 'the trigger needs exactly one unconditional outgoing edge'));
    }
    if ((incoming.get(entryNode.nodeId) ?? []).length > 0) {
      issues.push(workflowIssue('trigger_has_incoming', `$.nodes`, 'the trigger may not have incoming edges'));
    }
    if (inputSchema) {
      const triggerConfig = entryNode.config ?? {};
      if (triggerConfig.eventType !== inputSchema.eventType) {
        issues.push(workflowIssue('trigger_schema_mismatch', '$.inputSchema.eventType', 'trigger config must match inputSchema'));
      }
      if ((triggerConfig.periodKind ?? undefined) !== (inputSchema.periodKind ?? undefined)) {
        issues.push(workflowIssue('trigger_schema_mismatch', '$.inputSchema.periodKind', 'period kind must match inputSchema'));
      }
    }
  }

  const adjacency = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const nodeId of nodeMap.keys()) {
    adjacency.set(nodeId, []);
    reverse.set(nodeId, []);
  }
  for (const edge of edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
    reverse.get(edge.to)?.push(edge.from);
  }

  if (entryNodeId !== '' && nodeMap.has(entryNodeId)) {
    const reachable = reachableFrom(entryNodeId, adjacency);
    for (const nodeId of nodeMap.keys()) {
      if (!reachable.has(nodeId)) {
        issues.push(workflowIssue('unreachable_node', nodePath.get(nodeId) ?? '$.nodes', `node "${nodeId}" is unreachable`));
      }
    }
  }
  for (const node of nodeMap.values()) {
    if (!nodeMap.has(entryNodeId) && node.nodeId !== entryNodeId && (incoming.get(node.nodeId) ?? []).length === 0) {
      issues.push(workflowIssue('unreachable_node', nodePath.get(node.nodeId) ?? '$.nodes', `node "${node.nodeId}" has no incoming edge`));
    }
  }

  // Kahn topological sort doubles as cycle detection.
  const indegree = new Map<string, number>();
  for (const nodeId of nodeMap.keys()) indegree.set(nodeId, (incoming.get(nodeId) ?? []).length);
  const queue = [...nodeMap.keys()].filter((nodeId) => indegree.get(nodeId) === 0).sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    order.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (order.length !== nodeMap.size) {
    issues.push(workflowIssue('cycle_detected', '$.edges', 'workflow must be an acyclic graph'));
  }

  const saveNodes = [...nodeMap.values()].filter((node) => node.type === 'save_result');
  const deliverNodes = [...nodeMap.values()].filter((node) => node.type === 'deliver_inapp' || node.type === 'output');
  if (inputSchema?.eventType !== 'specialist_followup' && saveNodes.length === 0) {
    issues.push(workflowIssue('missing_save_node', '$.nodes', 'at least one save_result node is required'));
  }
  if (deliverNodes.length === 0) {
    issues.push(workflowIssue('missing_deliver_node', '$.nodes', 'at least one deliver_inapp node is required'));
  }
  if (specialist && nodes.filter(node => node.type === 'agent').length !== 1) {
    issues.push(workflowIssue('invalid_specialist_agent_count', '$.nodes', 'a specialist workflow requires exactly one agent'));
  }
  if (branchedSpecialist) {
    const requiredCapabilities = ['read.specialist_project', 'read.specialist_knowledge', 'read.specialist_public_standard',
      ...(explicitAssessment ? ['compose.stage_specialist.v3', 'read.specialist_evidence'] : ['compose.stage_specialist.v2']),
      'condition.specialist_evidence', 'compose.specialist_checklist', 'compose.specialist_material_request',
      'wait.specialist_site_record.v2', 'save.specialist_issue.v2', 'wait.specialist_review', 'deliver.specialist_result'];
    for (const capability of requiredCapabilities) {
      if (nodes.filter(node => node.capabilityRef === capability).length !== 1) {
        issues.push(workflowIssue('invalid_specialist_path', '$.nodes', `specialist workflow needs one ${capability} node`));
      }
    }
  }
  for (const node of nodeMap.values()) {
    const specialistNode = !['trigger', 'condition', 'read_materials', 'compose_content', 'save_result', 'deliver_inapp'].includes(node.type);
    if (node.type !== 'trigger' && node.type !== 'condition' && specialistNode !== specialist) {
      issues.push(workflowIssue('capability_event_mismatch', nodePath.get(node.nodeId) ?? '$.nodes', 'capability does not support this event type'));
    }
  }
  for (const deliver of deliverNodes) {
    if ((outgoing.get(deliver.nodeId) ?? []).length > 0) {
      issues.push(workflowIssue('deliver_not_terminal', nodePath.get(deliver.nodeId) ?? '$.nodes', 'delivery must be terminal'));
    }
  }
  const deliverIds = new Set(deliverNodes.map((node) => node.nodeId));
  if (branchedSpecialist) {
    const nextCapability: Readonly<Record<string, string>> = {
      'trigger.specialist_followup': 'read.specialist_project',
      'read.specialist_project': 'read.specialist_knowledge',
      'read.specialist_knowledge': 'read.specialist_public_standard',
      'read.specialist_public_standard': explicitAssessment ? 'compose.stage_specialist.v3' : 'compose.stage_specialist.v2',
      'compose.stage_specialist.v2': 'condition.specialist_evidence',
      'compose.stage_specialist.v3': 'read.specialist_evidence',
      'read.specialist_evidence': 'condition.specialist_evidence',
      'compose.specialist_checklist': 'wait.specialist_site_record.v2',
      'compose.specialist_material_request': 'wait.specialist_site_record.v2',
      'wait.specialist_site_record.v2': 'save.specialist_issue.v2',
      'save.specialist_issue.v2': 'wait.specialist_review',
      'wait.specialist_review': 'deliver.specialist_result',
    };
    const reachesOutput = new Set(deliverNodes.flatMap(node => [...reachableFrom(node.nodeId, reverse)]));
    for (const node of nodes) {
      if (!reachesOutput.has(node.nodeId)) {
        issues.push(workflowIssue('specialist_branch_without_output', nodePath.get(node.nodeId) ?? '$.nodes', 'every specialist path needs a terminal output'));
      }
      const expected = nextCapability[node.capabilityRef];
      const actual = nodeMap.get(outgoing.get(node.nodeId)?.[0]?.to ?? '')?.capabilityRef;
      if (expected && actual !== expected) {
        issues.push(workflowIssue('invalid_specialist_path', nodePath.get(node.nodeId) ?? '$.nodes', `connect this node to ${expected}`));
      }
    }
  }
  for (const save of saveNodes) {
    const forward = reachableFrom(save.nodeId, adjacency);
    if (![...forward].some((nodeId) => deliverIds.has(nodeId))) {
      issues.push(workflowIssue('save_without_delivery', nodePath.get(save.nodeId) ?? '$.nodes', 'saved results need a delivery path'));
    }
  }

  // Dominators: a reference source is mandatory only when every path from the
  // entry passes through it. This allows common pre-branch sources and rejects
  // branch-only sources after a merge.
  let dominators: Map<string, Set<string>> | null = null;
  if (order.length === nodeMap.size) {
    dominators = new Map<string, Set<string>>();
    for (const nodeId of order) {
      const predecessors = (incoming.get(nodeId) ?? []).map((edge) => edge.from);
      if (predecessors.length === 0) {
        dominators.set(nodeId, new Set([nodeId]));
        continue;
      }
      let intersection: Set<string> | null = null;
      for (const predecessor of predecessors) {
        const predecessorDominators = dominators.get(predecessor);
        if (!predecessorDominators) {
          intersection = null;
          break;
        }
        if (intersection === null) {
          intersection = new Set(predecessorDominators);
        } else {
          const kept: string[] = [];
          for (const id of intersection) {
            if (predecessorDominators.has(id)) kept.push(id);
          }
          intersection = new Set(kept);
        }
      }
      const nodeDominators = intersection ?? new Set<string>();
      nodeDominators.add(nodeId);
      dominators.set(nodeId, nodeDominators);
    }
  }

  // Input references: existence, port existence, type compatibility, upstream
  // dependency and mandatory-source (dominator) checks.
  for (const node of nodeMap.values()) {
    const path = nodePath.get(node.nodeId) ?? '$.nodes';
    const nodeSpec = getCapability(node.capabilityRef);
    const ancestors = reachableFrom(node.nodeId, reverse);
    for (const [inputName, ref] of Object.entries(node.inputs ?? {})) {
      const inputPath = `${path}.inputs.${inputName}`;
      const source = nodeMap.get(ref.nodeId);
      if (!source) {
        issues.push(workflowIssue('unknown_input_node', inputPath, `node "${ref.nodeId}" does not exist`));
        continue;
      }
      if (ref.nodeId === node.nodeId) {
        issues.push(workflowIssue('self_input_reference', inputPath, 'a node may not read its own output'));
        continue;
      }
      const sourceSpec: CapabilitySpec | undefined = getCapability(source.capabilityRef);
      if (!sourceSpec) continue;
      if (!hasOwn(sourceSpec.outputs, ref.outputPath)) {
        issues.push(
          workflowIssue('unknown_output_path', inputPath, `"${ref.nodeId}" has no output "${ref.outputPath}"`),
        );
        continue;
      }
      if (nodeSpec) {
        if (!specialistInputMatches(branchedSpecialist, node, inputName, source, ref.outputPath, explicitAssessment)) {
          const code = node.capabilityRef === 'condition.specialist_evidence' ? 'invalid_specialist_branch_input' : 'invalid_specialist_input';
          issues.push(workflowIssue(code, inputPath, `bind the matching verified ${inputName} port`));
        }
        const expected = nodeSpec.inputs[inputName];
        const actual = sourceSpec.outputs[ref.outputPath];
        if (expected && actual && expected !== actual) {
          issues.push(
            workflowIssue('input_type_mismatch', inputPath, `expected ${expected}, "${ref.nodeId}.${ref.outputPath}" is ${actual}`),
          );
        }
      }
      if (!ancestors.has(ref.nodeId)) {
        issues.push(workflowIssue('input_not_upstream', inputPath, `"${ref.nodeId}" is not upstream of "${node.nodeId}"`));
        continue;
      }
      if (dominators) {
        const mandatory = dominators.get(node.nodeId);
        if (!mandatory || !mandatory.has(ref.nodeId)) {
          issues.push(
            workflowIssue(
              'input_not_mandatory',
              inputPath,
              `"${ref.nodeId}" is not on every path to "${node.nodeId}"`,
            ),
          );
        }
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  const definition: WorkflowDefinition = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    definitionId,
    revision: revision as number,
    entryNodeId,
    inputSchema: inputSchema as WorkflowInputSchema,
    nodes: [...nodeMap.values()],
    edges,
  };
  const canonicalBytes = new TextEncoder().encode(canonicalJson(definition)).length;
  if (canonicalBytes > WORKFLOW_BOUNDS.maxDefinitionBytes) {
    return {
      ok: false,
      issues: [
        workflowIssue(
          'definition_too_large',
          '$',
          `canonical definition exceeds ${WORKFLOW_BOUNDS.maxDefinitionBytes} bytes`,
        ),
      ],
    };
  }
  return { ok: true, definition };
}
