import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pickDefaultCreationModel,
  readStoredWorkbenchTheme,
  serializeWorkbenchProviderState,
  WORKBENCH_WHOLE_FLOOR_SCOPE_KEY,
  workbenchComposerControlPreviewUrl,
  workbenchFloorPlanPreviewPath,
  workbenchMaxUserReferenceImages,
} from '@/lib/ai/workbench-studio';

test('workbench default model prefers the provider mapping, then isDefault', () => {
  const mapped = pickDefaultCreationModel(
    [
      { id: 'catalog-default', isDefault: true, remoteModel: 'gpt-image-2' },
      { id: 'mapped', isDefault: false, remoteModel: 'nano-banana-2' },
    ],
    'nano-banana-2',
  );
  assert.equal(mapped?.id, 'mapped');
  const preferred = pickDefaultCreationModel([
    { id: 'heavy', isDefault: false },
    { id: 'default', isDefault: true },
  ]);
  assert.equal(preferred?.id, 'default');
  assert.equal(pickDefaultCreationModel([{ id: 'first' }, { id: 'second' }])?.id, 'first');
  assert.equal(pickDefaultCreationModel([]), undefined);
  assert.equal(pickDefaultCreationModel(JSON.parse('[{"id":"parsed","isDefault":true}]'))?.id, 'parsed');
});

test('workbench provider state exposes mapping as defaultRemoteModel only', () => {
  assert.deepEqual(serializeWorkbenchProviderState({
    actionEnabled: true,
    generateProviders: [{ modelMappings: { 'image.generate.standard': 'gpt-image-2' } }],
    editProviders: [{}],
  }), {
    actionEnabled: true,
    supportsGenerate: true,
    supportsEdit: true,
    defaultRemoteModel: 'gpt-image-2',
  });
});

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
