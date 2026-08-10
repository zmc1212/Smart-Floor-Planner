import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMiniAiProjectState } from '@/lib/ai/mini-ai-project-index';

const layout = {
  version: 4,
  measurementMode: 'surveying',
  surveyGraph: {
    kind: 'survey-wall-graph',
    activeFloorId: 'floor-1',
    floors: [{
      id: 'floor-1',
      nodes: [
        { id: 'n1', xMm: 0, yMm: 0 },
        { id: 'n2', xMm: 3000, yMm: 0 },
        { id: 'n3', xMm: 3000, yMm: 3000 },
        { id: 'n4', xMm: 0, yMm: 3000 },
      ],
      walls: [
        { id: 'w1', startNodeId: 'n1', endNodeId: 'n2' },
        { id: 'w2', startNodeId: 'n2', endNodeId: 'n3' },
        { id: 'w3', startNodeId: 'n3', endNodeId: 'n4' },
        { id: 'w4', startNodeId: 'n4', endNodeId: 'n1' },
      ],
      openings: [],
      spaces: [{ id: 'room-1', name: '客厅', closed: true, wallIds: ['w1', 'w2', 'w3', 'w4'] }],
    }],
  },
};

const eligiblePlan = { status: 'completed', layoutData: layout, updatedAt: '2026-08-10T10:00:00.000Z' };
const workflow = { id: BigInt(1), selectedGenerationId: BigInt(10) };

test('project index keeps active workflow lifecycle separate from generation execution', () => {
  assert.equal(deriveMiniAiProjectState({ plan: eligiblePlan, activeWorkflow: workflow }).uiState, 'continue');
  assert.equal(deriveMiniAiProjectState({
    plan: eligiblePlan,
    activeWorkflow: workflow,
    generations: [{ id: BigInt(11), status: 'processing', createdAt: '2026-08-10T11:00:00.000Z', updatedAt: '2026-08-10T11:00:00.000Z' }],
  }).uiState, 'generating');
  assert.equal(deriveMiniAiProjectState({
    plan: eligiblePlan,
    activeWorkflow: workflow,
    generations: [{ id: BigInt(12), status: 'failed', createdAt: '2026-08-10T11:00:00.000Z', updatedAt: '2026-08-10T11:00:00.000Z' }],
  }).uiState, 'retry');
});

test('project index derives stale, ready and survey-recovery groups from persisted facts', () => {
  assert.equal(deriveMiniAiProjectState({
    plan: eligiblePlan,
    activeWorkflow: workflow,
    generations: [{ id: BigInt(10), status: 'succeeded', isSelectedBaseline: true, createdAt: '2026-08-10T09:00:00.000Z', updatedAt: '2026-08-10T09:00:00.000Z' }],
  }).uiState, 'stale');
  const ready = deriveMiniAiProjectState({ plan: eligiblePlan });
  assert.equal(ready.groupKey, 'ready');
  assert.equal(ready.uiState, 'ready');
  const needsSurvey = deriveMiniAiProjectState({
    plan: { ...eligiblePlan, status: 'draft' },
  });
  assert.equal(needsSurvey.groupKey, 'needs_survey');
  assert.equal(needsSurvey.eligibility.reasonCode, 'survey_incomplete');
});
