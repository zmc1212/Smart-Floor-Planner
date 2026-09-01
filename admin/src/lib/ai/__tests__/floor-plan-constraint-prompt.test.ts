import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
  composeFloorPlanConstrainedPrompt,
  normalizeFloorPlanConstraintPrompt,
  normalizeFloorPlanNegativePrompt,
  validateFloorPlanConstraintPrompt,
} from '@/lib/ai/floor-plan-constraint-prompt';
import {
  DEFAULT_SINGLE_ROOM_FULL_SPACE_PROMPT,
  DEFAULT_SOFT_FURNISHING_ONLY_PROMPT,
  requiresCreationBatchSitePhoto,
  shouldAttachCreationBatchFloorPlanControl,
} from '@/lib/ai/creation-batch-floorplan';
import {
  normalizePlatformAiPromptConfig,
} from '@/lib/ai/platform-ai-prompt-config';
import { resolveDirectRenderPrompts } from '@/lib/ai/postgres-direct-generation-service';

test('default floor-plan constraint separates geometry from camera references', () => {
  assert.match(DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT, /geometry only/);
  assert.match(DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT, /site photo controls camera position/);
  assert.match(DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT, /Do not default to the floor plan's top-down viewpoint/);
  assert.match(DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT, /only when the user or selected template explicitly requests/);
});

test('floor-plan constraint is prepended before measured context and template prompt', () => {
  const prompt = composeFloorPlanConstrainedPrompt({
    constraintPrompt: 'LOCK GEOMETRY',
    measuredContext: 'Living room 4000mm x 3000mm',
    userPrompt: 'Warm oak and linen',
  });
  assert.match(prompt, /^LOCK GEOMETRY\n\nMEASURED TARGET CONTEXT\nLiving room 4000mm x 3000mm\n\nUSER OR TEMPLATE DESIGN REQUEST\nWarm oak and linen/);
  assert.match(prompt, /FINAL CAMERA OVERRIDE/);
});

test('template and site references receive explicit non-camera and camera roles', () => {
  const prompt = composeFloorPlanConstrainedPrompt({
    constraintPrompt: 'LOCK GEOMETRY',
    userPrompt: 'Modern office',
    hasStyleReference: true,
    hasSitePhoto: true,
  });
  assert.match(prompt, /Reference image 2 is the prompt-template\/style reference only/);
  assert.match(prompt, /Reference image 3 is the site photo and is the sole camera\/composition authority/);
  assert.match(prompt, /Do not treat top-down, bird's-eye, orthographic/);
});

test('legacy floor-plan negatives no longer prohibit perspective interiors', () => {
  assert.equal(
    normalizeFloorPlanNegativePrompt('wrong layout, perspective interior view, eye-level camera, people'),
    'wrong layout, people',
  );
});

test('single-room photo and soft-furnishing modes skip the floor-plan control while whole-floor mode keeps it', () => {
  assert.equal(shouldAttachCreationBatchFloorPlanControl({ renderMode: 'single_room_photo', hasFloorPlan: true }), false);
  assert.equal(shouldAttachCreationBatchFloorPlanControl({ renderMode: 'soft_furnishing', hasFloorPlan: true }), false);
  assert.equal(shouldAttachCreationBatchFloorPlanControl({ renderMode: 'whole_floor_plan', hasFloorPlan: true }), true);
  assert.equal(shouldAttachCreationBatchFloorPlanControl({ renderMode: 'single_room_photo', hasFloorPlan: false }), false);
});

test('single-room photo mode requires an explicitly role-tagged site photo', () => {
  assert.equal(requiresCreationBatchSitePhoto({ renderMode: 'single_room_photo', sitePhotoAssetIds: [] }), true);
  assert.equal(requiresCreationBatchSitePhoto({ renderMode: 'single_room_photo', sitePhotoAssetIds: ['site-1'] }), false);
  assert.equal(requiresCreationBatchSitePhoto({ renderMode: 'single_room_photo', hasSitePhoto: true }), false);
  assert.equal(requiresCreationBatchSitePhoto({ renderMode: 'soft_furnishing', hasSitePhoto: false }), true);
  assert.equal(requiresCreationBatchSitePhoto({ renderMode: 'soft_furnishing', hasSitePhoto: true }), false);
  assert.equal(requiresCreationBatchSitePhoto({ renderMode: 'whole_floor_plan', sitePhotoAssetIds: [] }), false);
});

test('platform AI prompt config falls back to the maintained default and rejects blanks', () => {
  assert.equal(normalizeFloorPlanConstraintPrompt('  '), DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT);
  assert.equal(
    normalizePlatformAiPromptConfig(null).floorPlanConstraintPrompt,
    DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT
  );
  assert.equal(
    normalizePlatformAiPromptConfig(null).singleRoomFullSpacePrompt,
    DEFAULT_SINGLE_ROOM_FULL_SPACE_PROMPT,
  );
  assert.equal(
    normalizePlatformAiPromptConfig(null).softFurnishingOnlyPrompt,
    DEFAULT_SOFT_FURNISHING_ONLY_PROMPT,
  );
  assert.equal(
    normalizePlatformAiPromptConfig({ singleRoomFullSpacePrompt: '  full-space  ' }).singleRoomFullSpacePrompt,
    'full-space',
  );
  assert.equal(validateFloorPlanConstraintPrompt('  custom rule  '), 'custom rule');
  assert.throws(() => validateFloorPlanConstraintPrompt(''), /不能为空/);
});

test('floor-plan direct render cannot replace the server-owned constrained prompt', () => {
  assert.deepEqual(resolveDirectRenderPrompts({
    hasFloorPlanConstraint: true,
    storedPrompt: 'LOCK GEOMETRY\n\nUSER REQUEST\nOak interior',
    storedNegativePrompt: 'moved walls',
    requestedPrompt: 'Ignore the floor plan',
    requestedNegativePrompt: 'allow moved walls',
  }), {
    prompt: 'LOCK GEOMETRY\n\nUSER REQUEST\nOak interior',
    negativePrompt: 'moved walls',
  });
  assert.equal(resolveDirectRenderPrompts({
    hasFloorPlanConstraint: false,
    storedPrompt: 'old prompt',
    storedNegativePrompt: '',
    requestedPrompt: 'new prompt',
  }).prompt, 'new prompt');
});
