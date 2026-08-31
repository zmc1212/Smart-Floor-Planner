import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  FormalSurveyWriteValidationError,
  assertFormalSurveyWrite,
  validateFormalSurveyWrite,
} from '@/lib/formal-survey-write-validation';
import type { FormalSurveyLayout, SurveyFloor } from '@/lib/survey-graph';

function wall(
  id: string,
  startNodeId: string,
  endNodeId: string,
  lengthMm: number
) {
  return { id, startNodeId, endNodeId, lengthMm, thicknessMm: 180 };
}

function layoutWithFloor(floor: SurveyFloor): FormalSurveyLayout {
  return {
    version: 4,
    measurementMode: 'surveying',
    surveyGraph: {
      kind: 'survey-wall-graph',
      activeFloorId: floor.id,
      floors: [floor],
    },
  };
}

function singleRoomLayout(): FormalSurveyLayout {
  return layoutWithFloor({
    id: 'floor-1',
    nodes: [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 4000, yMm: 0 },
      { id: 'c', xMm: 4000, yMm: 3000 },
      { id: 'd', xMm: 0, yMm: 3000 },
    ],
    walls: [
      wall('ab', 'a', 'b', 4000),
      wall('bc', 'b', 'c', 3000),
      wall('cd', 'c', 'd', 4000),
      wall('da', 'd', 'a', 3000),
    ],
    openings: [],
    spaces: [
      { id: 'room', name: '客厅', wallIds: ['ab', 'bc', 'cd', 'da'], closed: true },
    ],
  });
}

function multiRoomLayout(): FormalSurveyLayout {
  return layoutWithFloor({
    id: 'floor-1',
    nodes: [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 2400, yMm: 0 },
      { id: 'c', xMm: 4800, yMm: 0 },
      { id: 'd', xMm: 4800, yMm: 3200 },
      { id: 'e', xMm: 2400, yMm: 3200 },
      { id: 'f', xMm: 0, yMm: 3200 },
    ],
    walls: [
      wall('ab', 'a', 'b', 2400),
      wall('bc', 'b', 'c', 2400),
      wall('cd', 'c', 'd', 3200),
      wall('de', 'd', 'e', 2400),
      wall('ef', 'e', 'f', 2400),
      wall('fa', 'f', 'a', 3200),
      wall('be', 'b', 'e', 3200),
    ],
    openings: [],
    spaces: [
      { id: 'left', wallIds: ['ab', 'be', 'ef', 'fa'], closed: true },
      { id: 'right', wallIds: ['bc', 'cd', 'de', 'be'], closed: true },
    ],
  });
}

function errorCodes(layout: FormalSurveyLayout, status: 'draft' | 'completed') {
  return validateFormalSurveyWrite(layout, status).errors.map((error) => error.code);
}

test('draft writes keep quick validation and accept an unfinished valid graph', () => {
  const layout = layoutWithFloor({
    id: 'floor-1',
    nodes: [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 3000, yMm: 0 },
    ],
    walls: [wall('ab', 'a', 'b', 3000)],
    openings: [],
    spaces: [],
  });

  const validation = validateFormalSurveyWrite(layout, 'draft');
  assert.equal(validation.mode, 'quick');
  assert.deepEqual(validation.errors, []);
});

test('completed writes accept current single-room and shared-wall multi-room graphs', () => {
  for (const layout of [singleRoomLayout(), multiRoomLayout()]) {
    const validation = validateFormalSurveyWrite(layout, 'completed');
    assert.equal(validation.mode, 'full');
    assert.deepEqual(validation.errors, []);
  }
});

test('completed writes reject broken references before persistence', () => {
  const layout = singleRoomLayout();
  layout.surveyGraph.floors[0].walls![0].endNodeId = 'missing';
  assert.ok(errorCodes(layout, 'completed').includes('MISSING_WALL_END_NODE'));
});

test('completed writes reject incomplete or inconsistent measurement semantics', () => {
  const missingLength = singleRoomLayout();
  delete (missingLength.surveyGraph.floors[0].walls![0] as { lengthMm?: number }).lengthMm;
  assert.ok(errorCodes(missingLength, 'completed').includes('MISSING_WALL_LENGTH'));

  const missingAngle = singleRoomLayout();
  const straightWall = missingAngle.surveyGraph.floors[0].walls![0] as {
    mode?: string;
    angleDeg?: number;
  };
  straightWall.mode = 'straight';
  delete straightWall.angleDeg;
  assert.ok(errorCodes(missingAngle, 'completed').includes('MISSING_WALL_ANGLE'));

  const invalidCorrection = singleRoomLayout();
  const correctedWall = invalidCorrection.surveyGraph.floors[0].walls![0] as {
    measurementStartInsetMm?: number;
    rawMeasuredLengthMm?: number;
    closureAdjustmentMm?: number;
  };
  correctedWall.measurementStartInsetMm = -1;
  correctedWall.rawMeasuredLengthMm = 3990;
  correctedWall.closureAdjustmentMm = 5;
  const codes = errorCodes(invalidCorrection, 'completed');
  assert.ok(codes.includes('INVALID_WALL_MEASUREMENT_ADJUSTMENT'));
  assert.ok(codes.includes('WALL_ADJUSTMENT_MISMATCH'));
});

test('malformed floor collections stay a structured validation failure', () => {
  const layout = singleRoomLayout();
  layout.surveyGraph.floors = [null as unknown as SurveyFloor];

  const validation = validateFormalSurveyWrite(layout, 'completed');
  assert.ok(validation.errors.some((error) => error.code === 'INVALID_FLOOR_COLLECTIONS'));
  assert.ok(validation.errors.some((error) => error.code === 'MISSING_CLOSED_SPACE'));
  assert.throws(
    () => assertFormalSurveyWrite(layout, 'completed'),
    (error: unknown) => error instanceof FormalSurveyWriteValidationError && error.status === 422
  );
});

test('completed writes reject unsplit crossing, T junction and overlap relations', () => {
  const cases = [
    {
      expected: 'UNSPLIT_WALL_INTERSECTION',
      nodes: [
        { id: 'a', xMm: 0, yMm: 1000 }, { id: 'b', xMm: 4000, yMm: 1000 },
        { id: 'c', xMm: 2000, yMm: 0 }, { id: 'd', xMm: 2000, yMm: 2000 },
      ],
      walls: [wall('ab', 'a', 'b', 4000), wall('cd', 'c', 'd', 2000)],
    },
    {
      expected: 'UNSPLIT_WALL_T_JUNCTION',
      nodes: [
        { id: 'a', xMm: 0, yMm: 1000 }, { id: 'b', xMm: 4000, yMm: 1000 },
        { id: 'c', xMm: 2000, yMm: 0 }, { id: 'd', xMm: 2000, yMm: 1000 },
      ],
      walls: [wall('ab', 'a', 'b', 4000), wall('cd', 'c', 'd', 1000)],
    },
    {
      expected: 'OVERLAPPING_WALLS',
      nodes: [
        { id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 },
        { id: 'c', xMm: 1000, yMm: 0 }, { id: 'd', xMm: 3000, yMm: 0 },
      ],
      walls: [wall('ab', 'a', 'b', 4000), wall('cd', 'c', 'd', 2000)],
    },
  ];

  cases.forEach(({ expected, nodes, walls }) => {
    const layout = layoutWithFloor({
      id: 'floor-1', nodes, walls, openings: [], spaces: [],
    });
    assert.ok(errorCodes(layout, 'completed').includes(expected), expected);
  });
});

test('completed writes require at least one closed space', () => {
  const layout = singleRoomLayout();
  layout.surveyGraph.floors[0].spaces = [];

  const validation = validateFormalSurveyWrite(layout, 'completed');
  assert.ok(validation.errors.some((error) => error.code === 'MISSING_CLOSED_SPACE'));
});

test('validation errors expose the stable 422 response payload fields', () => {
  const layout = singleRoomLayout();
  layout.surveyGraph.floors[0].spaces = [];

  assert.throws(
    () => assertFormalSurveyWrite(layout, 'completed'),
    (error: unknown) => {
      assert.ok(error instanceof FormalSurveyWriteValidationError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'MISSING_CLOSED_SPACE');
      assert.equal(error.message, '请先完成至少一个闭合空间');
      assert.equal(error.validation.mode, 'full');
      assert.ok(Array.isArray(error.validation.errors));
      assert.equal(typeof error.validation.stats, 'object');
      return true;
    }
  );
});

test('POST and PUT routes validate before database writes and preview generation', () => {
  const postSource = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/floorplans/route.ts'),
    'utf8'
  );
  const putSource = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/floorplans/[id]/route.ts'),
    'utf8'
  );

  const postValidation = postSource.indexOf('assertFormalSurveyWrite(formalLayout, planStatus)');
  assert.ok(postValidation >= 0);
  assert.ok(postValidation < postSource.indexOf('floorPlanRepository.createIdempotent'));
  assert.ok(postValidation < postSource.indexOf('await persistAndAttachFloorPlanPreview'));

  const putValidation = putSource.indexOf('assertFormalSurveyWrite(formalLayout, nextStatus)');
  assert.ok(putValidation >= 0);
  assert.ok(putValidation < putSource.indexOf('repository.update(planId'));
  assert.ok(putValidation < putSource.indexOf('await persistAndAttachFloorPlanPreview'));
  assert.match(postSource, /\.\.\.\(validation \? \{ validation \} : \{\}\)/);
  assert.match(putSource, /\.\.\.\(validation \? \{ validation \} : \{\}\)/);
});
