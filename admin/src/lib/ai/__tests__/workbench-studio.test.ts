import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readStoredWorkbenchTheme,
  WORKBENCH_WHOLE_FLOOR_SCOPE_KEY,
  workbenchComposerControlPreviewUrl,
  workbenchFloorPlanPreviewPath,
  workbenchMaxUserReferenceImages,
} from '@/lib/ai/workbench-studio';

test('workbench theme storage treats only light as the day theme', () => {
  assert.equal(readStoredWorkbenchTheme(null), 'dark');
  assert.equal(readStoredWorkbenchTheme('dark'), 'dark');
  assert.equal(readStoredWorkbenchTheme('light'), 'light');
  assert.equal(readStoredWorkbenchTheme('other'), 'dark');
});

test('workbench reserves one reference slot for the floor-plan control image', () => {
  assert.equal(workbenchMaxUserReferenceImages(4), 3);
  assert.equal(workbenchMaxUserReferenceImages(1), 0);
  assert.equal(workbenchMaxUserReferenceImages(0), 0);
});

test('workbench floor-plan preview path is scoped to the conversation', () => {
  assert.equal(workbenchFloorPlanPreviewPath('42'), '/api/ai/workflows/42/floor-plan-preview?v=3');
  assert.equal(workbenchFloorPlanPreviewPath('  '), '');
});

test('workbench floor-plan preview path crops a selected closed room', () => {
  assert.equal(
    workbenchFloorPlanPreviewPath('42', 'bedroom'),
    '/api/ai/workflows/42/floor-plan-preview?v=3&roomId=bedroom',
  );
  assert.equal(
    workbenchFloorPlanPreviewPath('42', '  bedroom  '),
    '/api/ai/workflows/42/floor-plan-preview?v=3&roomId=bedroom',
  );
  assert.equal(workbenchFloorPlanPreviewPath('42', '   '), '/api/ai/workflows/42/floor-plan-preview?v=3');
});

test('composer control preview follows the apply-to scope so the room crop is the visible reference', () => {
  assert.equal(WORKBENCH_WHOLE_FLOOR_SCOPE_KEY, 'whole_floor_plan');
  assert.equal(
    workbenchComposerControlPreviewUrl('42', WORKBENCH_WHOLE_FLOOR_SCOPE_KEY),
    '/api/ai/workflows/42/floor-plan-preview?v=3',
  );
  assert.equal(
    workbenchComposerControlPreviewUrl('42', 'bedroom'),
    '/api/ai/workflows/42/floor-plan-preview?v=3&roomId=bedroom',
  );
});
