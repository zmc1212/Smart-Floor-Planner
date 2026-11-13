import type { NodeFixture, SimulationFixtures, SimulationScenario } from '../simulate';
import type { TriggerEvent, WorkflowValue } from '../types';
import { dailyReportFixtures, dailyReportScenario, periodReportFixtures, weeklyReportScenario } from './period-report';
import { specialistFixtures, specialistScenario, specialistWaitFixtures } from './specialist';
import { stageReminderFixtures, stageReminderScenario } from './stage-reminder';

export type WorkflowFixtureDefinitionKind = 'stage_reminder' | 'period_report' | 'specialist_followup';

export interface WorkflowFixtureSet {
  readonly id: string;
  readonly label: string;
  readonly definitionKind: WorkflowFixtureDefinitionKind;
  readonly eventType: TriggerEvent['eventType'];
  readonly periodKind: 'daily' | 'weekly' | null;
  readonly scenario: SimulationScenario;
  readonly fixtures: SimulationFixtures;
}

function replaceNode(base: SimulationFixtures, nodeId: string, fixture: NodeFixture): SimulationFixtures {
  const nodes = structuredClone(base.nodes) as Record<string, NodeFixture>;
  nodes[nodeId] = structuredClone(fixture);
  return { nodes };
}

function withNodeOutputs(
  base: SimulationFixtures,
  nodeId: string,
  outputs: Record<string, WorkflowValue>,
): SimulationFixtures {
  const fixture = base.nodes[nodeId];
  if (!fixture || fixture.status !== 'ok') throw new Error(`fixture ${nodeId} must succeed to patch outputs`);
  return replaceNode(base, nodeId, {
    status: 'ok',
    outputs: { ...fixture.outputs, ...outputs },
  });
}

function failedNode(base: SimulationFixtures, nodeId: string, code: string): SimulationFixtures {
  return replaceNode(base, nodeId, {
    status: 'failed',
    error: { code, path: `fixtures.${nodeId}`, message: '调试注入的模拟失败' },
  });
}

function duplicateEventScenario(scenario: SimulationScenario): SimulationScenario {
  const event = scenario.events[0];
  if (!event) return scenario;
  return { ...scenario, events: [event, event] };
}

const sets: WorkflowFixtureSet[] = [
  {
    id: 'stage-normal',
    label: '阶段提醒 · 知识开启（模型整理）',
    definitionKind: 'stage_reminder',
    eventType: 'stage_changed',
    periodKind: null,
    scenario: stageReminderScenario,
    fixtures: stageReminderFixtures,
  },
  {
    id: 'stage-knowledge-off',
    label: '阶段提醒 · 知识关闭（确定性内容）',
    definitionKind: 'stage_reminder',
    eventType: 'stage_changed',
    periodKind: null,
    scenario: stageReminderScenario,
    fixtures: withNodeOutputs(stageReminderFixtures, 'read-craft', { craftEnabled: false, craftSummary: '' }),
  },
  {
    id: 'stage-duplicate-event',
    label: '阶段提醒 · 重复事件（应只产生一次）',
    definitionKind: 'stage_reminder',
    eventType: 'stage_changed',
    periodKind: null,
    scenario: duplicateEventScenario(stageReminderScenario),
    fixtures: stageReminderFixtures,
  },
  {
    id: 'stage-read-denied',
    label: '阶段提醒 · 读取被拒绝',
    definitionKind: 'stage_reminder',
    eventType: 'stage_changed',
    periodKind: null,
    scenario: stageReminderScenario,
    fixtures: failedNode(stageReminderFixtures, 'read-context', 'read_denied'),
  },
  {
    id: 'stage-compose-failed',
    label: '阶段提醒 · 内容整理失败',
    definitionKind: 'stage_reminder',
    eventType: 'stage_changed',
    periodKind: null,
    scenario: stageReminderScenario,
    fixtures: failedNode(stageReminderFixtures, 'compose-model', 'compose_failed'),
  },
  {
    id: 'stage-save-failed',
    label: '阶段提醒 · 保存失败',
    definitionKind: 'stage_reminder',
    eventType: 'stage_changed',
    periodKind: null,
    scenario: stageReminderScenario,
    fixtures: failedNode(stageReminderFixtures, 'save-model', 'save_failed'),
  },
  {
    id: 'stage-deliver-failed',
    label: '阶段提醒 · 站内投递失败',
    definitionKind: 'stage_reminder',
    eventType: 'stage_changed',
    periodKind: null,
    scenario: stageReminderScenario,
    fixtures: failedNode(stageReminderFixtures, 'deliver-model', 'deliver_failed'),
  },
  {
    id: 'report-weekly-normal',
    label: '周报 · 正常（原始施工记录）',
    definitionKind: 'period_report',
    eventType: 'period_report',
    periodKind: 'weekly',
    scenario: weeklyReportScenario,
    fixtures: periodReportFixtures,
  },
  {
    id: 'report-daily-normal',
    label: '日报 · 正常（当期记录）',
    definitionKind: 'period_report',
    eventType: 'period_report',
    periodKind: 'daily',
    scenario: dailyReportScenario,
    fixtures: dailyReportFixtures,
  },
  {
    id: 'report-material-withdrawn',
    label: '报告 · 照片资料撤回',
    definitionKind: 'period_report',
    eventType: 'period_report',
    periodKind: 'weekly',
    scenario: weeklyReportScenario,
    fixtures: failedNode(periodReportFixtures, 'read-photos', 'material_withdrawn'),
  },
  {
    id: 'report-compose-failed',
    label: '报告 · 内容整理失败',
    definitionKind: 'period_report',
    eventType: 'period_report',
    periodKind: 'weekly',
    scenario: weeklyReportScenario,
    fixtures: failedNode(periodReportFixtures, 'compose-report', 'compose_failed'),
  },
  {
    id: 'report-save-failed',
    label: '报告 · 保存失败',
    definitionKind: 'period_report',
    eventType: 'period_report',
    periodKind: 'weekly',
    scenario: weeklyReportScenario,
    fixtures: failedNode(periodReportFixtures, 'save-report', 'save_failed'),
  },
  {
    id: 'report-deliver-failed',
    label: '报告 · 站内投递失败',
    definitionKind: 'period_report',
    eventType: 'period_report',
    periodKind: 'weekly',
    scenario: weeklyReportScenario,
    fixtures: failedNode(periodReportFixtures, 'deliver-report', 'deliver_failed'),
  },
  {
    id: 'report-no-receivers',
    label: '报告 · 无接收范围（保存后停止）',
    definitionKind: 'period_report',
    eventType: 'period_report',
    periodKind: 'weekly',
    scenario: weeklyReportScenario,
    fixtures: withNodeOutputs(periodReportFixtures, 'read-receivers', {
      receiverCount: 0,
      receivers: { scope: 'project_members', roles: [] },
    }),
  },
];

sets.push(
  { id: 'waterproof-reviewed', label: '防水事项已复核', definitionKind: 'specialist_followup', eventType: 'specialist_followup', periodKind: null,
    scenario: specialistScenario, fixtures: specialistFixtures },
  { id: 'waterproof-waiting', label: '等待防水现场资料', definitionKind: 'specialist_followup', eventType: 'specialist_followup', periodKind: null,
    scenario: specialistScenario, fixtures: specialistWaitFixtures },
);

export const fixtureSets: readonly WorkflowFixtureSet[] = sets;

export interface WorkflowFixtureSetSummary {
  readonly id: string;
  readonly label: string;
  readonly definitionKind: WorkflowFixtureDefinitionKind;
  readonly eventType: TriggerEvent['eventType'];
  readonly periodKind: 'daily' | 'weekly' | null;
}

export const fixtureSetSummaries: readonly WorkflowFixtureSetSummary[] = sets.map((set) => ({
  id: set.id,
  label: set.label,
  definitionKind: set.definitionKind,
  eventType: set.eventType,
  periodKind: set.periodKind,
}));

export function findFixtureSet(id: string): WorkflowFixtureSet | undefined {
  return sets.find((set) => set.id === id);
}

export function fixtureMatchesDefinition(
  set: WorkflowFixtureSet,
  definition: { readonly inputSchema: { readonly eventType: string; readonly periodKind?: string } },
): boolean {
  return (
    set.eventType === definition.inputSchema.eventType &&
    (set.periodKind ?? null) === (definition.inputSchema.periodKind ?? null)
  );
}
