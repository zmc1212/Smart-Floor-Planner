import assert from 'node:assert/strict';
import test from 'node:test';
import { listAiDesignActions } from '@/lib/ai/design-actions';
import { decideWorkflowBaselineUpdate } from '@/lib/ai/workflow-baseline-policy';
import { normalizeMenuPermissions } from '@/lib/staff-access';

test('shared action catalog keeps admin and Mini Program mappings consistent', () => {
  const adminStages = listAiDesignActions('admin_workflow').map((item) => item.stageKey);
  const miniModes = listAiDesignActions('miniprogram').map((item) => item.miniMode);

  assert.deepEqual(adminStages, ['direction', 'base_render', 'soft_furnishing', 'proposal_pack', 'lighting']);
  assert.deepEqual(miniModes, ['reference_recreate', 'style_transform', 'floor_plan_render', 'soft_furnishing']);
  assert.equal(listAiDesignActions('miniprogram').find((item) => item.miniMode === 'style_transform')?.stageKey, 'base_render');
  assert.equal(listAiDesignActions('miniprogram').find((item) => item.miniMode === 'soft_furnishing')?.nextStageKey, 'proposal_pack');
});

test('first baseline success is selected while later successes stay candidates', () => {
  assert.deepEqual(
    decideWorkflowBaselineUpdate({ stageKey: 'base_render', hasEarlierStageSuccess: false }),
    { selectGeneration: true, advanceWorkflow: true }
  );
  assert.deepEqual(
    decideWorkflowBaselineUpdate({ stageKey: 'base_render', hasEarlierStageSuccess: true }),
    { selectGeneration: false, advanceWorkflow: false }
  );
  assert.deepEqual(
    decideWorkflowBaselineUpdate({ stageKey: 'proposal_pack', hasEarlierStageSuccess: true }),
    { selectGeneration: false, advanceWorkflow: true }
  );
});

test('legacy AI execution permissions resolve to the unified workbench permission', () => {
  assert.deepEqual(normalizeMenuPermissions(['ai-floorplan']), ['ai-floorplan', 'ai-scenarios']);
  assert.deepEqual(normalizeMenuPermissions(['leads']), ['leads']);
});
