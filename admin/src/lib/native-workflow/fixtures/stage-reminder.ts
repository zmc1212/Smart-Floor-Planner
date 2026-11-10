import type { SimulationFixtures, SimulationScenario } from '../simulate';

/** Synthetic stage-change scenario; no real customer data. */
export const stageReminderScenario: SimulationScenario = {
  runIdPrefix: 'sim-native-stage',
  clock: { startedAt: '2026-11-11T09:00:00.000Z', stepMs: 1000 },
  events: [
    {
      eventId: 'evt-stage-20261111-0001',
      eventType: 'stage_changed',
      occurredAt: '2026-11-11T08:58:00.000Z',
      stageKey: 'plumbing',
      stageLabel: '水电施工',
    },
  ],
};

export const stageReminderFixtures: SimulationFixtures = {
  nodes: {
    'read-context': {
      status: 'ok',
      outputs: {
        stageKey: 'plumbing',
        stageLabel: '水电施工',
        stageKnown: true,
        subscribed: true,
        receivers: { scope: 'project_members', roles: ['owner', 'manager', 'worker'] },
        receiverCount: 3,
      },
    },
    'read-craft': {
      status: 'ok',
      outputs: {
        craftEnabled: true,
        craftSummary: '模拟企业工艺摘录：水电阶段按企业工艺核对线管固定与打压记录。',
      },
    },
    'compose-model': {
      status: 'ok',
      outputs: {
        title: '阶段提醒：水电施工（模拟）',
        body: '模拟整理内容：项目已进入水电施工阶段，请按有效企业工艺核对线管固定和打压记录。',
      },
    },
    'save-model': {
      status: 'ok',
      outputs: {
        saved: true,
        saveReceipt: { receiptId: 'sim-save-stage-model-0001', simulated: true },
      },
    },
    'deliver-model': {
      status: 'ok',
      outputs: {
        delivered: true,
        deliveryReceipt: { receiptId: 'sim-deliver-stage-model-0001', simulated: true },
      },
    },
    'save-deterministic': {
      status: 'ok',
      outputs: {
        saved: true,
        saveReceipt: { receiptId: 'sim-save-stage-deterministic-0001', simulated: true },
      },
    },
    'deliver-deterministic': {
      status: 'ok',
      outputs: {
        delivered: true,
        deliveryReceipt: { receiptId: 'sim-deliver-stage-deterministic-0001', simulated: true },
      },
    },
  },
};
