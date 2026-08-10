import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEligibleWorkflowFloorPlan,
  buildWorkflowFloorPlanContext,
  getWorkflowFloorPlanEligibility,
  isEligibleWorkflowFloorPlan,
  resolveWorkflowImageMode,
} from '@/lib/ai/workflow-floorplan';

const layout = {
  version: 4 as const,
  measurementMode: 'surveying' as const,
  surveyGraph: {
    kind: 'survey-wall-graph' as const,
    activeFloorId: 'floor-1',
    floors: [{
      id: 'floor-1',
      ceilingHeightMm: 2800,
      nodes: [
        { id: 'n1', xMm: 0, yMm: 0 },
        { id: 'n2', xMm: 4000, yMm: 0 },
        { id: 'n3', xMm: 4000, yMm: 3000 },
        { id: 'n4', xMm: 0, yMm: 3000 },
      ],
      walls: [
        { id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 4000, thicknessMm: 200 },
        { id: 'w2', startNodeId: 'n2', endNodeId: 'n3', lengthMm: 3000, thicknessMm: 120 },
        { id: 'w3', startNodeId: 'n3', endNodeId: 'n4', lengthMm: 4000, thicknessMm: 120 },
        { id: 'w4', startNodeId: 'n4', endNodeId: 'n1', lengthMm: 3000, thicknessMm: 120 },
      ],
      openings: [
        { id: 'door-1', wallId: 'w1', type: 'door' as const, centerOffsetMm: 900, widthMm: 900, heightMm: 2100 },
        { id: 'window-1', wallId: 'w3', type: 'window' as const, centerOffsetMm: 2000, widthMm: 1800, heightMm: 1500, sillHeightMm: 900 },
      ],
      spaces: [{ id: 'living', name: 'Living room', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true }],
    }],
  },
};

test('workflow floor-plan eligibility requires a completed formal v4 plan', () => {
  assert.equal(isEligibleWorkflowFloorPlan({ status: 'completed', layoutData: layout }), true);
  assert.equal(isEligibleWorkflowFloorPlan({ status: 'draft', layoutData: layout }), false);
  assert.equal(isEligibleWorkflowFloorPlan({ status: 'completed', layoutData: [{ name: 'legacy' }] }), false);
  assert.throws(
    () => assertEligibleWorkflowFloorPlan({ status: 'draft', layoutData: layout }),
    (error: unknown) => {
      assert.match(String((error as Error).message), /已完成/);
      assert.equal((error as Error & { status?: number }).status, 400);
      assert.equal((error as Error & { code?: string }).code, 'INVALID_WORKFLOW_FLOOR_PLAN');
      return true;
    }
  );
});

test('workflow floor-plan eligibility exposes stable UI reason codes without weakening validation', () => {
  assert.deepEqual(
    getWorkflowFloorPlanEligibility({ status: 'draft', layoutData: layout }),
    {
      eligible: false,
      reasonCode: 'survey_incomplete',
      reasonLabel: '量房未完成',
      errorMessage: '只能选择已完成的正式户型',
    }
  );
  assert.equal(
    getWorkflowFloorPlanEligibility({ status: 'completed', layoutData: [{ name: 'legacy' }] }).reasonCode,
    'invalid_formal_graph'
  );
  assert.deepEqual(
    getWorkflowFloorPlanEligibility({ status: 'completed', layoutData: layout }),
    { eligible: true }
  );
});

test('workflow floor-plan context includes wall topology and opening constraints without mutation', () => {
  const before = JSON.stringify(layout);
  const context = buildWorkflowFloorPlanContext(layout);
  assert.match(context, /Living room/);
  assert.match(context, /w1 \(0,0\) to \(4000,0\), 4000mm long, 200mm thick/);
  assert.match(context, /door on w1, center offset 900mm, 900x2100mm/);
  assert.match(context, /window on w3, center offset 2000mm, 1800x1500mm, sill 900mm/);
  assert.match(context, /supplied control image as the authoritative plan/);
  assert.equal(JSON.stringify(layout), before);
});

test('direction always uses image editing even when a stored preset still says generation', () => {
  assert.equal(resolveWorkflowImageMode('direction', 'generation'), 'edit');
  assert.equal(resolveWorkflowImageMode('base_render', 'edit'), 'edit');
  assert.equal(resolveWorkflowImageMode('proposal_pack', 'generation'), 'generation');
});
