import { electricalAgentId, electricalChecklistAgentVersion, isPublishedSpecialistVersion, specialists, waterproofAgentId,
  type SpecialistRegistration } from '../assistant/specialists/registry';
import { WORKFLOW_SCHEMA_VERSION, type WorkflowDefinition } from './types';

export function createWaterproofInspectionDefinition(): WorkflowDefinition {
  return createSpecialistInspectionDefinition(specialists.active(waterproofAgentId)!);
}

export function createElectricalInspectionDefinition(): WorkflowDefinition {
  // The candidate version is reachable only through its explicit published
  // workflow; ordinary consultation still uses active registrations.
  return createSpecialistInspectionDefinition(specialists.version(electricalAgentId, electricalChecklistAgentVersion)!);
}

export function createSpecialistInspectionDefinition(agent: Readonly<SpecialistRegistration>): WorkflowDefinition {
  if (!isPublishedSpecialistVersion(agent) || !agent.workflowTemplateId) throw new Error('specialist_template_unavailable');
  const electrical = agent.agentId === electricalAgentId;
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    definitionId: agent.workflowTemplateId,
    revision: 1,
    entryNodeId: 'start',
    inputSchema: { eventType: 'specialist_followup' },
    nodes: [
      { nodeId: 'start', type: 'trigger', typeVersion: 1, capabilityRef: 'trigger.specialist_followup',
        config: { eventType: 'specialist_followup' } },
      { nodeId: 'project', type: 'project_data', typeVersion: 1, capabilityRef: 'read.specialist_project',
        config: { recordLimit: 10 } },
      { nodeId: 'knowledge', type: 'knowledge_retrieval', typeVersion: 1, capabilityRef: 'read.specialist_knowledge',
        config: { scope: 'authorized', topK: 3 }, inputs: { project: { nodeId: 'project', outputPath: 'project' } } },
      { nodeId: 'public_standard', type: 'public_search', typeVersion: 1, capabilityRef: 'read.specialist_public_standard',
        config: { coverage: 'subject' } },
      { nodeId: 'analysis', type: 'agent', typeVersion: 3, capabilityRef: 'compose.stage_specialist.v3',
        config: { agentId: agent.agentId, agentVersion: agent.version },
        inputs: {
          project: { nodeId: 'project', outputPath: 'project' },
          enterprise: { nodeId: 'knowledge', outputPath: 'enterprise' },
          publicStandard: { nodeId: 'public_standard', outputPath: 'publicStandard' },
        } },
      { nodeId: 'assessment', type: 'evidence_assessment', typeVersion: 1, capabilityRef: 'read.specialist_evidence',
        inputs: { analysisRun: { nodeId: 'analysis', outputPath: 'analysisRun' },
          project: { nodeId: 'project', outputPath: 'project' },
          enterprise: { nodeId: 'knowledge', outputPath: 'enterprise' },
          publicStandard: { nodeId: 'public_standard', outputPath: 'publicStandard' },
        } },
      { nodeId: 'analysis_ready', type: 'condition', typeVersion: 1, capabilityRef: 'condition.specialist_evidence',
        config: { evidencePolicy: electrical ? 'any_evidence' : 'any' }, inputs: {
          enterprise: { nodeId: 'assessment', outputPath: 'hasEnterprise' },
          publicStandard: { nodeId: 'assessment', outputPath: 'hasPublic' },
          issue: { nodeId: 'assessment', outputPath: 'hasIssue' },
          ...(electrical ? { drawing: { nodeId: 'assessment', outputPath: 'hasDrawing' } } : {}),
        } },
      { nodeId: 'checklist', type: 'checklist', typeVersion: 1, capabilityRef: 'compose.specialist_checklist',
        inputs: { analysis: { nodeId: 'assessment', outputPath: 'analysis' } } },
      { nodeId: 'request_material', type: 'request_material', typeVersion: 1, capabilityRef: 'compose.specialist_material_request',
        inputs: { analysis: { nodeId: 'assessment', outputPath: 'analysis' } } },
      { nodeId: 'issue', type: 'create_issue', typeVersion: 2, capabilityRef: 'save.specialist_issue.v2',
        config: { policy: 'open_or_reuse' }, inputs: { project: { nodeId: 'project', outputPath: 'project' } } },
      { nodeId: 'site_record', type: 'wait_event', typeVersion: 2, capabilityRef: 'wait.specialist_site_record.v2',
        config: { waitDays: 30 }, inputs: { project: { nodeId: 'project', outputPath: 'project' } } },
      { nodeId: 'review', type: 'human_review', typeVersion: 1, capabilityRef: 'wait.specialist_review',
        config: { waitDays: 30 }, inputs: { issue: { nodeId: 'issue', outputPath: 'saveReceipt' } } },
      { nodeId: 'result', type: 'output', typeVersion: 1, capabilityRef: 'deliver.specialist_result',
        config: { milestone: 'resolved' }, inputs: { analysis: { nodeId: 'assessment', outputPath: 'analysis' }, review: { nodeId: 'review', outputPath: 'review' } } },
    ],
    edges: [
      { from: 'start', to: 'project' }, { from: 'project', to: 'knowledge' },
      { from: 'knowledge', to: 'public_standard' }, { from: 'public_standard', to: 'analysis' },
      { from: 'analysis', to: 'assessment' }, { from: 'assessment', to: 'analysis_ready' },
      { from: 'analysis_ready', to: 'checklist', when: 'true' }, { from: 'analysis_ready', to: 'request_material', when: 'false' },
      { from: 'analysis_ready', to: 'issue', when: 'issue' },
      { from: 'checklist', to: 'site_record' }, { from: 'request_material', to: 'site_record' },
      { from: 'site_record', to: 'issue' }, { from: 'issue', to: 'review' }, { from: 'review', to: 'result' },
    ],
  };
}
