import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMiniAiRenderPrompt } from '@/lib/ai/mini-ai-provider';

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
