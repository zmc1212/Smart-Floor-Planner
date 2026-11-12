import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical';
import { WorkflowDefinitionError } from './errors';
import { deepFreeze } from './guards';
import { getCapability, type CapabilityEffect } from './registry';
import type {
  NodeType,
  ValueType,
  WorkflowDefinition,
  WorkflowInputRef,
  WorkflowInputSchema,
} from './types';
import { validateDefinition } from './validate';

export interface CompiledNode {
  readonly nodeId: string;
  readonly type: NodeType;
  readonly typeVersion: number;
  readonly capabilityRef: string;
  readonly nodeVersion: string;
  readonly effect: CapabilityEffect;
  readonly config: Readonly<Record<string, unknown>>;
  readonly inputs: Readonly<Record<string, WorkflowInputRef>>;
  readonly inputTypes: Readonly<Record<string, ValueType>>;
  readonly outputTypes: Readonly<Record<string, ValueType>>;
}

export interface CompiledEdge {
  readonly from: string;
  readonly to: string;
  readonly when?: 'true' | 'false';
}

/**
 * Immutable execution plan. A published revision keeps its digest, node
 * versions and topology; later drafts cannot mutate a plan already in use.
 */
export interface CompiledWorkflowPlan {
  readonly schemaVersion: number;
  readonly definitionId: string;
  readonly revision: number;
  readonly digest: string;
  readonly entryNodeId: string;
  readonly inputSchema: WorkflowInputSchema;
  readonly nodes: Readonly<Record<string, CompiledNode>>;
  readonly edges: readonly CompiledEdge[];
  readonly outgoing: Readonly<Record<string, readonly CompiledEdge[]>>;
  readonly topoOrder: readonly string[];
  readonly bounds: Readonly<{ nodeCount: number; edgeCount: number; maxDepth: number }>;
}

export function definitionDigest(definition: WorkflowDefinition): string {
  const nodes = [...definition.nodes]
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
    .map((node) => ({
      ...node,
      config: node.config ?? {},
      inputs: node.inputs ?? {},
    }));
  const edges = [...definition.edges]
    .sort((left, right) => {
      const leftKey = `${left.from}->${left.to}:${left.when ?? ''}`;
      const rightKey = `${right.from}->${right.to}:${right.when ?? ''}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((edge) => ({ from: edge.from, to: edge.to, ...(edge.when ? { when: edge.when } : {}) }));
  const payload = {
    schemaVersion: definition.schemaVersion,
    definitionId: definition.definitionId,
    revision: definition.revision,
    entryNodeId: definition.entryNodeId,
    inputSchema: definition.inputSchema,
    nodes,
    edges,
  };
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function compileDefinition(definition: unknown): CompiledWorkflowPlan {
  const result = validateDefinition(definition);
  if (!result.ok) throw new WorkflowDefinitionError([...result.issues]);
  const validated = result.definition;

  const nodes: Record<string, CompiledNode> = {};
  for (const node of validated.nodes) {
    const spec = getCapability(node.capabilityRef);
    if (!spec) throw new WorkflowDefinitionError([{ code: 'unknown_capability', path: `nodes.${node.nodeId}`, message: 'whitelist changed' }]);
    nodes[node.nodeId] = {
      nodeId: node.nodeId,
      type: node.type,
      typeVersion: node.typeVersion,
      capabilityRef: node.capabilityRef,
      nodeVersion: `${node.type}@${node.typeVersion}/${node.capabilityRef}`,
      effect: spec.effect,
      config: { ...(node.config ?? {}) },
      inputs: { ...(node.inputs ?? {}) },
      inputTypes: { ...spec.inputs },
      outputTypes: { ...spec.outputs },
    };
  }

  const edges: CompiledEdge[] = validated.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    ...(edge.when ? { when: edge.when } : {}),
  }));
  const outgoing: Record<string, CompiledEdge[]> = {};
  for (const nodeId of Object.keys(nodes)) outgoing[nodeId] = [];
  for (const edge of edges) outgoing[edge.from]?.push(edge);

  const indegree: Record<string, number> = {};
  for (const nodeId of Object.keys(nodes)) indegree[nodeId] = 0;
  for (const edge of edges) indegree[edge.to] = (indegree[edge.to] ?? 0) + 1;
  const queue = Object.keys(nodes)
    .filter((nodeId) => indegree[nodeId] === 0)
    .sort();
  const topoOrder: string[] = [];
  const depth: Record<string, number> = {};
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    topoOrder.push(current);
    let currentDepth = 0;
    for (const edge of edges) {
      if (edge.to === current) currentDepth = Math.max(currentDepth, depth[edge.from] ?? 1);
    }
    depth[current] = currentDepth + 1;
    for (const edge of outgoing[current] ?? []) {
      indegree[edge.to] = (indegree[edge.to] ?? 0) - 1;
      if (indegree[edge.to] === 0) queue.push(edge.to);
    }
  }

  const plan: CompiledWorkflowPlan = {
    schemaVersion: validated.schemaVersion,
    definitionId: validated.definitionId,
    revision: validated.revision,
    digest: definitionDigest(validated),
    entryNodeId: validated.entryNodeId,
    inputSchema: validated.inputSchema,
    nodes,
    edges,
    outgoing,
    topoOrder,
    bounds: {
      nodeCount: Object.keys(nodes).length,
      edgeCount: edges.length,
      maxDepth: Math.max(0, ...Object.values(depth)),
    },
  };
  return deepFreeze(plan);
}
