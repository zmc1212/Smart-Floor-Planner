import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeCreationBatchPrompt,
  composePhotoFirstCreationBatchPrompt,
  resolveCreationBatchControlPng,
  resolveCreationBatchFloorPlanScope,
  resolveCreationBatchTargetContext,
} from '@/lib/ai/creation-batch-floorplan';
import { createMiniAiFloorPlanControlSvg } from '@/lib/ai/mini-ai-floorplan';
import { DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT } from '@/lib/ai/floor-plan-constraint-prompt';

const layout = {
  version: 4 as const,
  measurementMode: 'surveying' as const,
  surveyGraph: {
    kind: 'survey-wall-graph' as const,
    activeFloorId: 'floor-1',
    floors: [{
      id: 'floor-1',
      name: '一层',
      ceilingHeightMm: 2800,
      nodes: [
        { id: 'n1', xMm: 0, yMm: 0 },
        { id: 'n2', xMm: 4000, yMm: 0 },
        { id: 'n3', xMm: 4000, yMm: 3000 },
        { id: 'n4', xMm: 0, yMm: 3000 },
        { id: 'n5', xMm: 8000, yMm: 0 },
        { id: 'n6', xMm: 8000, yMm: 3000 },
      ],
      walls: [
        { id: 'w1', startNodeId: 'n1', endNodeId: 'n2' },
        { id: 'w2', startNodeId: 'n2', endNodeId: 'n3' },
        { id: 'w3', startNodeId: 'n3', endNodeId: 'n4' },
        { id: 'w4', startNodeId: 'n4', endNodeId: 'n1' },
        { id: 'w5', startNodeId: 'n2', endNodeId: 'n5' },
        { id: 'w6', startNodeId: 'n5', endNodeId: 'n6' },
        { id: 'w7', startNodeId: 'n6', endNodeId: 'n3' },
      ],
      openings: [],
      spaces: [
        { id: 'living', name: '客厅', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true },
        { id: 'bedroom', name: '卧室', wallIds: ['w5', 'w6', 'w7', 'w2'], closed: true },
      ],
    }],
  },
};

const plan = {
  id: 1n,
  enterpriseId: 2n,
  layoutData: layout,
  status: 'completed',
};

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('omitted workbench scope defaults to whole-floor-plan roomData in the provider prompt', () => {
  const scope = resolveCreationBatchFloorPlanScope({
    layoutData: layout,
    prompt: 'Warm oak living interior',
  });
  assert.equal(scope.target.targetScope, 'whole_floor_plan');
  assert.equal(scope.roomData.targetLabel, '完整户型');
  assert.equal(scope.roomData.roomCount, 2);
  assert.equal(scope.roomData.roomId, undefined);
  assert.match(scope.providerPrompt, /^Warm oak living interior\n\nMeasured whole-floor-plan context/);
  assert.match(scope.providerPrompt, /客厅/);
  assert.match(scope.providerPrompt, /卧室/);
  assert.equal(
    composeCreationBatchPrompt('Warm oak living interior', scope.roomData),
    scope.providerPrompt,
  );
});

test('single-room workbench scope crops the Mini control SVG and keeps roomData in the prompt', async () => {
  const scope = resolveCreationBatchFloorPlanScope({
    layoutData: layout,
    prompt: 'Soft bedroom lighting',
    targetScope: 'single_room',
    roomId: 'bedroom',
  });
  assert.equal(scope.roomData.targetScope, 'single_room');
  assert.equal(scope.roomData.roomId, 'bedroom');
  assert.equal(scope.roomData.targetLabel, '卧室');
  assert.equal(scope.roomData.roomCount, 1);
  assert.match(scope.providerPrompt, /Measured room context: 卧室/);
  assert.doesNotMatch(scope.providerPrompt, /客厅/);

  const bedroomSvg = createMiniAiFloorPlanControlSvg(layout, 1024, 'bedroom');
  const wholeSvg = createMiniAiFloorPlanControlSvg(layout);
  assert.equal((bedroomSvg.match(/<line /g) || []).length, 4);
  assert.equal((wholeSvg.match(/<line /g) || []).length, 7);

  const cropped = await resolveCreationBatchControlPng(plan, scope.target, {
    renderRoomCrop: async () => Buffer.concat([pngSignature, Buffer.from('room')]),
    resolveWholePlan: async () => Buffer.concat([pngSignature, Buffer.from('whole')]),
  });
  assert.equal(cropped.controlKind, 'room_crop');
  assert.equal(cropped.buffer.subarray(8).toString(), 'room');
});

test('photo-first modes can preserve room identity without composing a floor-plan control prompt', () => {
  const context = resolveCreationBatchTargetContext({
    layoutData: layout,
    targetScope: 'single_room',
    roomId: 'living',
  });
  assert.equal(context.target.targetScope, 'single_room');
  assert.equal(context.roomData.roomId, 'living');
  assert.equal(context.roomData.targetLabel, '客厅');
  assert.equal('providerPrompt' in context, false);
});

test('photo-first modes freeze distinct full-space and soft-furnishing boundaries', () => {
  const fullSpace = composePhotoFirstCreationBatchPrompt({
    renderMode: 'single_room_photo',
    prompt: 'Create a warm contemporary living room',
  });
  const softOnly = composePhotoFirstCreationBatchPrompt({
    renderMode: 'soft_furnishing',
    prompt: 'Create a warm contemporary living room',
  });

  assert.match(fullSpace, /^SINGLE-ROOM FULL-SPACE REDESIGN BOUNDARY/);
  assert.match(fullSpace, /redesign every visible interior design layer/);
  assert.match(fullSpace, /wall, ceiling, and floor finishes/);
  assert.match(softOnly, /^SINGLE-ROOM SOFT-FURNISHING-ONLY BOUNDARY/);
  assert.match(softOnly, /Preserve exactly[\s\S]*all visible hard-finish materials/);
  assert.match(softOnly, /Only replace, rearrange, add, or remove movable soft-furnishing layers/);
  assert.match(softOnly, /mandatory and overrides any conflicting user or template instruction/);
  assert.notEqual(fullSpace, softOnly);
});

test('whole-plan prompt composition remains on the floor-plan path', () => {
  assert.equal(composePhotoFirstCreationBatchPrompt({
    renderMode: 'whole_floor_plan',
    prompt: 'Keep the measured layout',
  }), 'Keep the measured layout');
});

test('configured structure constraint precedes measured scope and the selected template', () => {
  const scope = resolveCreationBatchFloorPlanScope({
    layoutData: layout,
    prompt: 'Warm oak living interior',
    constraintPrompt: DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
  });
  assert.match(scope.providerPrompt, /^MANDATORY FLOOR-PLAN GEOMETRY CONTROL/);
  assert.ok(scope.providerPrompt.indexOf('MEASURED TARGET CONTEXT') > 0);
  assert.ok(
    scope.providerPrompt.indexOf('USER OR TEMPLATE DESIGN REQUEST')
      > scope.providerPrompt.indexOf('MEASURED TARGET CONTEXT')
  );
  assert.match(scope.providerPrompt, /Warm oak living interior/);
  assert.match(scope.providerPrompt, /Do not default to the floor plan's top-down viewpoint/);
});

test('whole-plan batches keep the survey snapshot and do not crop', async () => {
  const scope = resolveCreationBatchFloorPlanScope({
    layoutData: layout,
    prompt: 'Whole-home palette',
    targetScope: 'whole_floor_plan',
  });
  const control = await resolveCreationBatchControlPng(plan, scope.target, {
    renderRoomCrop: async () => {
      throw new Error('crop should not run for whole-plan batches');
    },
    resolveWholePlan: async () => Buffer.concat([pngSignature, Buffer.from('snapshot')]),
  });
  assert.equal(control.controlKind, 'survey_snapshot');
  assert.equal(control.buffer.subarray(8).toString(), 'snapshot');
});

test('single-room crop failure falls back to the whole-plan snapshot without changing roomData scope', async () => {
  const scope = resolveCreationBatchFloorPlanScope({
    layoutData: layout,
    prompt: 'Keep the bedroom brief',
    targetScope: 'single_room',
    roomId: 'bedroom',
  });
  const originalError = console.error;
  console.error = () => {};
  let control;
  try {
    control = await resolveCreationBatchControlPng(plan, scope.target, {
      renderRoomCrop: async () => {
        throw new Error('sharp unavailable');
      },
      resolveWholePlan: async () => Buffer.concat([pngSignature, Buffer.from('fallback')]),
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(control.controlKind, 'survey_snapshot_fallback');
  assert.equal(control.buffer.subarray(8).toString(), 'fallback');
  assert.equal(scope.roomData.targetScope, 'single_room');
  assert.equal(scope.roomData.roomId, 'bedroom');
  assert.match(scope.providerPrompt, /Measured room context: 卧室/);
});
