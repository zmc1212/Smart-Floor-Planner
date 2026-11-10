import type { WorkflowDefinition, WorkflowEdge, WorkflowInputRef, WorkflowNode } from './types';
import { WORKFLOW_SCHEMA_VERSION } from './types';

function ref(nodeId: string, outputPath: string): WorkflowInputRef {
  return { nodeId, outputPath };
}

/**
 * Template one: reminder after an actual stage change.
 *
 * trigger -> read project context (host-scoped identity) -> known stage gate ->
 * subscription gate -> authorized craft read -> knowledge switch ->
 * (model compose | deterministic compose) -> save reminder -> in-app delivery.
 *
 * Knowledge off keeps the deterministic branch; duplicate events are ignored
 * by the runtime, and an unknown stage halts instead of guessing.
 */
export function createStageReminderDefinition(): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    {
      nodeId: 'trigger-1',
      type: 'trigger',
      typeVersion: 1,
      capabilityRef: 'trigger.stage_changed',
      config: { eventType: 'stage_changed' },
    },
    {
      nodeId: 'read-context',
      type: 'read_materials',
      typeVersion: 1,
      capabilityRef: 'read.project_context',
      inputs: { stageKey: ref('trigger-1', 'stageKey') },
    },
    {
      nodeId: 'condition-stage',
      type: 'condition',
      typeVersion: 1,
      capabilityRef: 'condition.compare_boolean',
      config: { op: 'eq', right: true },
      inputs: { left: ref('read-context', 'stageKnown') },
    },
    {
      nodeId: 'condition-subscription',
      type: 'condition',
      typeVersion: 1,
      capabilityRef: 'condition.compare_boolean',
      config: { op: 'eq', right: true },
      inputs: { left: ref('read-context', 'subscribed') },
    },
    {
      nodeId: 'read-craft',
      type: 'read_materials',
      typeVersion: 1,
      capabilityRef: 'read.enterprise_craft',
    },
    {
      nodeId: 'condition-knowledge',
      type: 'condition',
      typeVersion: 1,
      capabilityRef: 'condition.compare_boolean',
      config: { op: 'eq', right: true },
      inputs: { left: ref('read-craft', 'craftEnabled') },
    },
    {
      nodeId: 'compose-deterministic',
      type: 'compose_content',
      typeVersion: 1,
      capabilityRef: 'compose.stage_reminder_deterministic',
      config: {
        title: '阶段提醒',
        template: '项目已进入{{stageLabel}}阶段，请按既定安排关注本阶段施工注意事项。',
      },
      inputs: { stageLabel: ref('read-context', 'stageLabel') },
    },
    {
      nodeId: 'compose-model',
      type: 'compose_content',
      typeVersion: 1,
      capabilityRef: 'compose.stage_reminder_model',
      inputs: {
        stageLabel: ref('read-context', 'stageLabel'),
        craftSummary: ref('read-craft', 'craftSummary'),
      },
    },
    {
      nodeId: 'save-deterministic',
      type: 'save_result',
      typeVersion: 1,
      capabilityRef: 'save.stage_reminder',
      inputs: { title: ref('compose-deterministic', 'title'), body: ref('compose-deterministic', 'body') },
    },
    {
      nodeId: 'save-model',
      type: 'save_result',
      typeVersion: 1,
      capabilityRef: 'save.stage_reminder',
      inputs: { title: ref('compose-model', 'title'), body: ref('compose-model', 'body') },
    },
    {
      nodeId: 'deliver-deterministic',
      type: 'deliver_inapp',
      typeVersion: 1,
      capabilityRef: 'deliver.inapp',
      inputs: {
        receivers: ref('read-context', 'receivers'),
        title: ref('compose-deterministic', 'title'),
        body: ref('compose-deterministic', 'body'),
      },
    },
    {
      nodeId: 'deliver-model',
      type: 'deliver_inapp',
      typeVersion: 1,
      capabilityRef: 'deliver.inapp',
      inputs: {
        receivers: ref('read-context', 'receivers'),
        title: ref('compose-model', 'title'),
        body: ref('compose-model', 'body'),
      },
    },
  ];

  const edges: WorkflowEdge[] = [
    { from: 'trigger-1', to: 'read-context' },
    { from: 'read-context', to: 'condition-stage' },
    { from: 'condition-stage', to: 'condition-subscription', when: 'true' },
    { from: 'condition-subscription', to: 'read-craft', when: 'true' },
    { from: 'read-craft', to: 'condition-knowledge' },
    { from: 'condition-knowledge', to: 'compose-model', when: 'true' },
    { from: 'condition-knowledge', to: 'compose-deterministic', when: 'false' },
    { from: 'compose-model', to: 'save-model' },
    { from: 'save-model', to: 'deliver-model' },
    { from: 'compose-deterministic', to: 'save-deterministic' },
    { from: 'save-deterministic', to: 'deliver-deterministic' },
  ];

  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    definitionId: 'stage-reminder',
    revision: 1,
    entryNodeId: 'trigger-1',
    inputSchema: { eventType: 'stage_changed' },
    nodes,
    edges,
  };
}

/**
 * Template two: daily/weekly report sharing one `period` parameter.
 *
 * trigger -> period records -> authorized photos -> receiver scope -> compose
 * report -> save report -> receiver gate -> in-app delivery. Weekly runs read
 * the period's raw construction records; model-written daily reports are never
 * used as source facts.
 */
export function createPeriodReportDefinition(kind: 'daily' | 'weekly'): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    {
      nodeId: 'trigger-1',
      type: 'trigger',
      typeVersion: 1,
      capabilityRef: 'trigger.period_report',
      config: { eventType: 'period_report', periodKind: kind },
    },
    {
      nodeId: 'read-records',
      type: 'read_materials',
      typeVersion: 1,
      capabilityRef: 'read.period_records',
      inputs: {
        periodKind: ref('trigger-1', 'periodKind'),
        periodStart: ref('trigger-1', 'periodStart'),
        periodEnd: ref('trigger-1', 'periodEnd'),
      },
    },
    {
      nodeId: 'read-photos',
      type: 'read_materials',
      typeVersion: 1,
      capabilityRef: 'read.authorized_photos',
      inputs: {
        periodKind: ref('trigger-1', 'periodKind'),
        periodStart: ref('trigger-1', 'periodStart'),
        periodEnd: ref('trigger-1', 'periodEnd'),
      },
    },
    {
      nodeId: 'read-receivers',
      type: 'read_materials',
      typeVersion: 1,
      capabilityRef: 'read.receiver_scope',
    },
    {
      nodeId: 'compose-report',
      type: 'compose_content',
      typeVersion: 1,
      capabilityRef: 'compose.period_report',
      inputs: {
        periodKind: ref('trigger-1', 'periodKind'),
        periodStart: ref('trigger-1', 'periodStart'),
        periodEnd: ref('trigger-1', 'periodEnd'),
        records: ref('read-records', 'records'),
        photos: ref('read-photos', 'photos'),
        recordCount: ref('read-records', 'recordCount'),
        photoCount: ref('read-photos', 'photoCount'),
      },
    },
    {
      nodeId: 'save-report',
      type: 'save_result',
      typeVersion: 1,
      capabilityRef: 'save.period_report',
      inputs: { title: ref('compose-report', 'title'), body: ref('compose-report', 'body') },
    },
    {
      nodeId: 'condition-receivers',
      type: 'condition',
      typeVersion: 1,
      capabilityRef: 'condition.compare_number',
      config: { op: 'gt', right: 0 },
      inputs: { left: ref('read-receivers', 'receiverCount') },
    },
    {
      nodeId: 'deliver-report',
      type: 'deliver_inapp',
      typeVersion: 1,
      capabilityRef: 'deliver.inapp',
      inputs: {
        receivers: ref('read-receivers', 'receivers'),
        title: ref('compose-report', 'title'),
        body: ref('compose-report', 'body'),
      },
    },
  ];

  const edges: WorkflowEdge[] = [
    { from: 'trigger-1', to: 'read-records' },
    { from: 'read-records', to: 'read-photos' },
    { from: 'read-photos', to: 'read-receivers' },
    { from: 'read-receivers', to: 'compose-report' },
    { from: 'compose-report', to: 'save-report' },
    { from: 'save-report', to: 'condition-receivers' },
    { from: 'condition-receivers', to: 'deliver-report', when: 'true' },
  ];

  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    definitionId: kind === 'daily' ? 'period-report-daily' : 'period-report-weekly',
    revision: 1,
    entryNodeId: 'trigger-1',
    inputSchema: { eventType: 'period_report', periodKind: kind },
    nodes,
    edges,
  };
}
