import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMiniAiRenderPrompt,
  composeReferenceRecreatePrompt,
  selectMiniAiOutputSpec,
  selectReferenceRecreateImageInputs,
} from '@/lib/ai/mini-ai-provider';

test('reference recreation follows the reference image aspect ratio', () => {
  const result = selectMiniAiOutputSpec({
    mode: 'reference_recreate',
    referenceDimensions: { width: 1376, height: 768 },
    spaceDimensions: { width: 1024, height: 1024 },
  });

  assert.equal(result.aspectRatio, '16:9');
  assert.equal(result.size, '1376x768');
});

test('reference recreation falls back to a valid VIP size when source pixels violate constraints', () => {
  const result = selectMiniAiOutputSpec({
    mode: 'reference_recreate',
    referenceDimensions: { width: 1375, height: 768 },
  });

  assert.equal(result.aspectRatio, '16:9');
  assert.equal(result.size, '1280x720');
});

test('other Mini Program edit modes follow the user space image ratio', () => {
  const result = selectMiniAiOutputSpec({
    mode: 'style_transform',
    referenceDimensions: { width: 900, height: 1600 },
    spaceDimensions: { width: 1200, height: 900 },
  });

  assert.equal(result.aspectRatio, '4:3');
});

test('floor-plan output keeps whole plans square and single rooms landscape', () => {
  assert.equal(selectMiniAiOutputSpec({
    mode: 'floor_plan_render',
    targetScope: 'whole_floor_plan',
  }).aspectRatio, '1:1');
  assert.equal(selectMiniAiOutputSpec({
    mode: 'floor_plan_render',
    targetScope: 'single_room',
  }).aspectRatio, '3:2');
});

test('plan-backed reference recreation sends control first and reference second', () => {
  assert.deepEqual(selectReferenceRecreateImageInputs({
    controlImage: 'control',
    referenceImage: 'reference',
    spaceImage: 'space',
  }), ['control', 'reference']);

  const prompt = composeReferenceRecreatePrompt('warm wood and natural light', 'measured bedroom', true);

  assert.match(prompt, /Image 1 is the measured floor-plan control image/i);
  assert.match(prompt, /Image 2 is the design reference/i);
  assert.match(prompt, /preserve Image 1 structure first/i);
  assert.match(prompt, /Match Image 2 aspect ratio and framing/i);
});

test('standalone reference recreation keeps reference first and room image second', () => {
  assert.deepEqual(selectReferenceRecreateImageInputs({
    referenceImage: 'reference',
    spaceImage: 'space',
  }), ['reference', 'space']);
  const prompt = composeReferenceRecreatePrompt('warm wood and natural light');

  assert.match(prompt, /Image 1 is the reference image and the primary composition canvas/i);
  assert.match(prompt, /preserving its aspect ratio, crop, framing, camera position, focal length/i);
  assert.match(prompt, /Image 2 is the user space image/i);
  assert.match(prompt, /must not override Image 1 composition or camera/i);
});

test('floor-plan render prompt treats formal measurements as concept constraints', async () => {
  const result = await buildMiniAiRenderPrompt({
    enterpriseId: 'enterprise',
    generationId: 'generation',
    mode: 'floor_plan_render',
    styleName: '现代简约',
    stylePrompt: 'white walls, light wood, clean furniture',
    roomSummary: 'Measured room context: living room, approximately 4.20m by 3.60m, with 2 measured openings.',
    targetScope: 'single_room',
  });

  assert.match(result.prompt, /concept/i);
  assert.match(result.prompt, /4\.20m by 3\.60m/);
  assert.match(result.prompt, /do not invent unusual structural features/i);
  assert.match(result.prompt, /eye-level/i);
  assert.doesNotMatch(result.prompt, /top-down/i);
});

test('whole-floor-plan render prompt preserves the complete measured footprint', async () => {
  const result = await buildMiniAiRenderPrompt({
    enterpriseId: 'enterprise',
    generationId: 'generation',
    mode: 'floor_plan_render',
    styleName: '现代简约',
    stylePrompt: 'top-down furnished modern floor plan',
    roomSummary: 'Measured whole-floor-plan context: 2 closed rooms.',
    targetScope: 'whole_floor_plan',
  });

  assert.match(result.prompt, /top-down orthographic/i);
  assert.match(result.prompt, /preserve every wall, opening, room count, room adjacency/i);
  assert.match(result.prompt, /do not crop out any room/i);
});

test('soft-furnishing prompt locks hard finishes and fixed structure', async () => {
  const result = await buildMiniAiRenderPrompt({
    enterpriseId: 'enterprise',
    generationId: 'generation',
    mode: 'soft_furnishing',
    styleName: '原木奶油',
  });

  assert.match(result.prompt, /Change only movable furniture/i);
  assert.match(result.prompt, /preserve.*walls.*ceiling.*floor.*doors.*windows.*built-in cabinets/i);
});
