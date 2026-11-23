import { WORKFLOW_BOUNDS, type WorkflowDefinition, type WorkflowEdge } from './types';

function newId(definition: WorkflowDefinition, prefix: string) {
  const used = new Set(definition.nodes.map((node) => node.nodeId));
  for (let n = 1; n <= WORKFLOW_BOUNDS.maxNodes; n++) if (!used.has(prefix + '_' + n)) return prefix + '_' + n;
  return null;
}

export function canInsertStageCondition(definition: WorkflowDefinition, edge: WorkflowEdge) {
  return (
    definition.inputSchema.eventType === 'stage_consultation' &&
    definition.nodes.length < WORKFLOW_BOUNDS.maxNodes &&
    !edge.when &&
    definition.nodes.some((node) => node.nodeId === edge.from && node.capabilityRef === 'read.stage_guide') &&
    definition.edges.some((item) => item.from === edge.from && item.to === edge.to && !item.when)
  );
}

export function insertStageCondition(definition: WorkflowDefinition, edge: WorkflowEdge) {
  const id = newId(definition, 'condition');
  if (!id || !canInsertStageCondition(definition, edge)) return null;
  const result: WorkflowDefinition = {
    ...definition,
    nodes: [
      ...definition.nodes,
      {
        nodeId: id,
        type: 'condition',
        typeVersion: 1,
        capabilityRef: 'condition.compare_boolean',
        inputs: { left: { nodeId: edge.from, outputPath: 'matched' } },
        config: { op: 'eq', right: true },
      },
    ],
    edges: [
      ...definition.edges.filter((item) => item.from !== edge.from || item.to !== edge.to || item.when),
      { from: edge.from, to: id },
      { from: id, to: edge.to, when: 'true' },
    ],
  };
  return { definition: result, id };
}

export function connectStageReturn(definition: WorkflowDefinition, conditionId: string, when: 'true' | 'false') {
  const condition = definition.nodes.find(
    (node) => node.nodeId === conditionId && node.capabilityRef === 'condition.compare_boolean',
  );
  const guide = condition?.inputs?.left?.nodeId;
  const id = newId(definition, 'reply');
  if (
    !id ||
    definition.inputSchema.eventType !== 'stage_consultation' ||
    definition.nodes.length >= WORKFLOW_BOUNDS.maxNodes ||
    !definition.nodes.some((node) => node.nodeId === guide && node.capabilityRef === 'read.stage_guide') ||
    definition.edges.some((edge) => edge.from === conditionId && edge.when === when)
  )
    return null;
  const result: WorkflowDefinition = {
    ...definition,
    nodes: [
      ...definition.nodes,
      {
        nodeId: id,
        type: 'output',
        typeVersion: 1,
        capabilityRef: 'output.stage_guide',
        inputs: { text: { nodeId: guide!, outputPath: when === 'false' ? 'nextStage' : 'answer' } },
      },
    ],
    edges: [...definition.edges, { from: conditionId, to: id, when }],
  };
  return { definition: result, id };
}
