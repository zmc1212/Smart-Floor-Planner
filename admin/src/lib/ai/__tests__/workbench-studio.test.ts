import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readStoredWorkbenchTheme,
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
