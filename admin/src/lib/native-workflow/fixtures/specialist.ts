import type { SimulationFixtures, SimulationScenario } from '../simulate';

export const specialistScenario: SimulationScenario = {
  runIdPrefix: 'simulation-waterproof',
  clock: { startedAt: '2026-11-13T08:00:00+08:00', stepMs: 1000 },
  events: [{ eventType: 'specialist_followup', eventId: 'followup-1', occurredAt: '2026-11-13T08:00:00+08:00' }],
};

export const specialistFixtures: SimulationFixtures = {
  nodes: {
    project: { status: 'ok', outputs: { project: { stageKey: 'masonry_carpentry', roomName: '卫生间' } } },
    knowledge: { status: 'ok', outputs: { enterprise: { status: 'no_match', sources: [] } } },
    public_standard: { status: 'ok', outputs: { publicStandard: { status: 'ready', pages: [27, 31] } } },
    analysis: { status: 'ok', outputs: { analysis: { agentId: 'waterproof-specialist', version: 1,
      checklist: ['核对管根密封和基层状况'], needsHumanReview: true }, ready: true } },
    issue: { status: 'ok', outputs: { saved: true, saveReceipt: { receiptId: 'sim-issue-1' } } },
    site_record: { status: 'ok', outputs: { record: { id: 'sim-record-1', version: 1 } } },
    review: { status: 'ok', outputs: { review: { id: 'sim-review-1', state: 'resolved' } } },
    result: { status: 'ok', outputs: { delivered: true, deliveryReceipt: { receiptId: 'sim-message-1' } } },
  },
};

export const specialistWaitFixtures: SimulationFixtures = {
  nodes: { ...specialistFixtures.nodes,
    site_record: { status: 'waiting' },
  },
};
