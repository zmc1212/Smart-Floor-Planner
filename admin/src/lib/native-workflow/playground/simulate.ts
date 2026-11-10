/**
 * Reproducible B2 simulation trace. Read-only: no database, network, model,
 * environment secret or timer is touched; output goes to stdout only.
 *
 * Run from admin/: npx tsx src/lib/native-workflow/playground/simulate.ts
 */
import {
  createPeriodReportDefinition,
  createStageReminderDefinition,
  simulate,
  type SimulationFixtures,
  type SimulationResult,
} from '../index';
import { stageReminderFixtures, stageReminderScenario } from '../fixtures/stage-reminder';
import {
  dailyReportFixtures,
  dailyReportScenario,
  periodReportFixtures,
  weeklyReportScenario,
} from '../fixtures/period-report';

function failureVariant(base: SimulationFixtures, nodeId: string, code: string): SimulationFixtures {
  const nodes = structuredClone(base.nodes) as Record<string, SimulationFixtures['nodes'][string]>;
  nodes[nodeId] = {
    status: 'failed',
    error: { code, path: `fixtures.${nodeId}`, message: 'playground injected failure' },
  };
  return { nodes };
}

function summarise(label: string, result: SimulationResult): Record<string, unknown> {
  return {
    label,
    mode: result.mode,
    definitionId: result.definitionId,
    revision: result.revision,
    digest: result.digest,
    duplicateEventIds: result.duplicateEventIds,
    runs: result.runs.map((run) => ({
      runId: run.runId,
      eventId: run.eventId,
      status: run.status,
      outcome: run.outcome,
      error: run.error,
      modelComposeCount: run.modelComposeCount,
      proposedOperations: run.proposedOperations.map((operation) => ({
        nodeId: operation.nodeId,
        effect: operation.effect,
        simulation: operation.simulation,
        nodeVersion: operation.nodeVersion,
        input: operation.input,
      })),
      fixtureLog: run.fixtureLog,
      trace: run.trace,
    })),
  };
}

const stageDefinition = createStageReminderDefinition();
const weeklyDefinition = createPeriodReportDefinition('weekly');
const event = stageReminderScenario.events[0]!;

const scenarios = [
  summarise('stage reminder (knowledge on)', simulate({
    definition: stageDefinition,
    scenario: stageReminderScenario,
    fixtures: stageReminderFixtures,
  })),
  summarise('stage reminder (knowledge off)', simulate({
    definition: stageDefinition,
    scenario: stageReminderScenario,
    fixtures: {
      nodes: {
        ...structuredClone(stageReminderFixtures.nodes),
        'read-craft': { status: 'ok', outputs: { craftEnabled: false, craftSummary: '' } },
      },
    },
  })),
  summarise('stage reminder (duplicate event)', simulate({
    definition: stageDefinition,
    scenario: { ...stageReminderScenario, events: [event, event] },
    fixtures: stageReminderFixtures,
  })),
  summarise('weekly report', simulate({
    definition: weeklyDefinition,
    scenario: weeklyReportScenario,
    fixtures: periodReportFixtures,
  })),
  summarise('daily report', simulate({
    definition: createPeriodReportDefinition('daily'),
    scenario: dailyReportScenario,
    fixtures: dailyReportFixtures,
  })),
  summarise('weekly report (delivery failure fixture)', simulate({
    definition: weeklyDefinition,
    scenario: weeklyReportScenario,
    fixtures: failureVariant(periodReportFixtures, 'deliver-report', 'deliver_failed'),
  })),
];

process.stdout.write(`${JSON.stringify({ mode: 'simulation', scenarios }, null, 2)}\n`);
