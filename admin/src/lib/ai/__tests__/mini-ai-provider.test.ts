import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMiniAiRenderPrompt } from '@/lib/ai/mini-ai-provider';

test('floor-plan render prompt treats formal measurements as concept constraints', async () => {
  const result = await buildMiniAiRenderPrompt({
    enterpriseId: 'enterprise',
    generationId: 'generation',
    mode: 'floor_plan_render',
    styleName: '现代简约',
    roomSummary: 'Measured room context: living room, approximately 4.20m by 3.60m, with 2 measured openings.',
  });

  assert.match(result.prompt, /concept/i);
  assert.match(result.prompt, /4\.20m by 3\.60m/);
  assert.match(result.prompt, /do not invent unusual structural features/i);
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
