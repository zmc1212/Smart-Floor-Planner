import { waterproofAgentId, waterproofWorkflowTemplateId } from '../assistant/specialists/registry';
import { WORKFLOW_SCHEMA_VERSION, type WorkflowDefinition } from './types';

export function createWaterproofInspectionDefinition(): WorkflowDefinition {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    definitionId: waterproofWorkflowTemplateId,
    revision: 1,
    entryNodeId: 'start',
    inputSchema: { eventType: 'specialist_followup' },
    nodes: [
      { nodeId: 'start', type: 'trigger', typeVersion: 1, capabilityRef: 'trigger.specialist_followup',
        config: { eventType: 'specialist_followup' } },
      { nodeId: 'project', type: 'project_data', typeVersion: 1, capabilityRef: 'read.specialist_project' },
      { nodeId: 'knowledge', type: 'knowledge_retrieval', typeVersion: 1, capabilityRef: 'read.specialist_knowledge',
        inputs: { project: { nodeId: 'project', outputPath: 'project' } } },
      { nodeId: 'public_standard', type: 'public_search', typeVersion: 1, capabilityRef: 'read.specialist_public_standard' },
      { nodeId: 'analysis', type: 'agent', typeVersion: 1, capabilityRef: 'compose.stage_specialist',
        config: { agentId: waterproofAgentId, agentVersion: 1 },
        inputs: {
          project: { nodeId: 'project', outputPath: 'project' },
          enterprise: { nodeId: 'knowledge', outputPath: 'enterprise' },
          publicStandard: { nodeId: 'public_standard', outputPath: 'publicStandard' },
        } },
      { nodeId: 'analysis_ready', type: 'condition', typeVersion: 1, capabilityRef: 'condition.compare_boolean',
        config: { op: 'eq', right: true }, inputs: { left: { nodeId: 'analysis', outputPath: 'ready' } } },
      { nodeId: 'issue', type: 'create_issue', typeVersion: 1, capabilityRef: 'save.specialist_issue',
        inputs: { record: { nodeId: 'site_record', outputPath: 'record' } } },
      { nodeId: 'site_record', type: 'wait_event', typeVersion: 1, capabilityRef: 'wait.specialist_site_record',
        inputs: { project: { nodeId: 'project', outputPath: 'project' } } },
      { nodeId: 'review', type: 'human_review', typeVersion: 1, capabilityRef: 'wait.specialist_review',
        inputs: { issue: { nodeId: 'issue', outputPath: 'saveReceipt' } } },
      { nodeId: 'result', type: 'output', typeVersion: 1, capabilityRef: 'deliver.specialist_result',
        inputs: { analysis: { nodeId: 'analysis', outputPath: 'analysis' }, review: { nodeId: 'review', outputPath: 'review' } } },
    ],
    edges: [
      { from: 'start', to: 'project' }, { from: 'project', to: 'knowledge' },
      { from: 'knowledge', to: 'public_standard' }, { from: 'public_standard', to: 'analysis' },
      { from: 'analysis', to: 'analysis_ready' },
      { from: 'analysis_ready', to: 'site_record', when: 'true' }, { from: 'analysis_ready', to: 'site_record', when: 'false' },
      { from: 'site_record', to: 'issue' }, { from: 'issue', to: 'review' }, { from: 'review', to: 'result' },
    ],
  };
}
