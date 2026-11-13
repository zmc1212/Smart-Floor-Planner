import type { SimulationFixtures, SimulationScenario } from '../simulate';

export const specialistScenario: SimulationScenario = {
  runIdPrefix: 'simulation-waterproof',
  clock: { startedAt: '2026-11-13T08:00:00+08:00', stepMs: 1000 },
  events: [{ eventType: 'specialist_followup', eventId: 'followup-1', occurredAt: '2026-11-13T08:00:00+08:00' }],
};

const analysis = { agentId: 'waterproof-specialist', version: 1,
  requestedChecks: [{ text: '核对管根密封和基层状况', basis: ['public_standard'] }],
  unresolvedItems: ['补充该房间的现场记录'] };

function fixtures(branch: 'issue' | 'true' | 'false'): SimulationFixtures {
  const publicReady = branch !== 'false';
  const project = { status: 'ok', outputs: { project: { stageKey: 'masonry_carpentry', roomName: '卫生间' } } } as const;
  const knowledge = { status: 'ok', outputs: { enterprise: { status: 'no_match', sources: [] } } } as const;
  const standard = { status: 'ok', outputs: { publicStandard: { status: publicReady ? 'ready' : 'unavailable', pages: publicReady ? [27, 31] : [] } } } as const;
  const legacy = { status: 'ok', outputs: { analysis, ready: publicReady } } as const;
  const specialist = { status: 'ok', outputs: { analysis, hasEnterprise: false, hasPublic: publicReady, hasIssue: branch === 'issue' } } as const;
  const record = branch === 'issue' ? { status: 'ok', outputs: { record: { id: 'sim-record-1', version: 1 } } } as const : { status: 'waiting' } as const;
  const issue = { status: 'ok', outputs: { saved: true, saveReceipt: { receiptId: 'sim-issue-1' } } } as const;
  const review = { status: 'ok', outputs: { review: { id: 'sim-review-1', state: 'resolved' } } } as const;
  const output = { status: 'ok', outputs: { delivered: true, deliveryReceipt: { receiptId: 'sim-message-1' } } } as const;
  return { nodes: {}, capabilities: {
    'read.specialist_project': project,
    'read.specialist_knowledge': knowledge,
    'read.specialist_public_standard': standard,
    'compose.stage_specialist': legacy,
    'compose.stage_specialist.v2': specialist,
    'wait.specialist_site_record': record,
    'wait.specialist_site_record.v2': record,
    'save.specialist_issue': issue,
    'save.specialist_issue.v2': issue,
    'wait.specialist_review': review,
    'deliver.specialist_result': output,
  } };
}

export const specialistFixtures = fixtures('issue');
export const specialistWaitFixtures = fixtures('true');
export const specialistMaterialFixtures = fixtures('false');
