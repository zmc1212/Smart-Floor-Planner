import assert from 'node:assert/strict';
import test from 'node:test';
import { getFloorPlanDisplay } from '@/lib/floor-plan-display';

test('uses the community as the primary floor-plan identity with a stable survey sequence', () => {
  const display = getFloorPlanDisplay(
    { name: '正式量房-20260810' },
    {
      lead: { name: '牟总', communityName: '火凤凰' },
      measurementSequence: 2,
    }
  );

  assert.deepEqual(display, {
    projectTitle: '火凤凰',
    projectSubtitle: '牟总 · 第 2 次量房',
    measurementLabel: '第 2 次量房',
    recordTitle: '火凤凰 · 第 2 次量房',
    legacyName: '正式量房-20260810',
  });
});

test('retains the stored floor-plan name when no lead relationship exists', () => {
  const display = getFloorPlanDisplay({ name: '旧版正式量房-20260810' });

  assert.equal(display.projectTitle, '旧版正式量房-20260810');
  assert.equal(display.projectSubtitle, '量房记录');
});
