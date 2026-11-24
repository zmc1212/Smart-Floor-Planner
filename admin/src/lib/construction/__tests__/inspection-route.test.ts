import assert from 'node:assert/strict';
import test from 'node:test';
import { fastestInspectionOrder, parseTiandituLeg } from '../inspection-route';
import { inspectionDistance, inspectionProjection } from '../inspection-policy';

const leg = (seconds: number) => ({ seconds, points: [] });
test('directed driving costs find the minimum open tour and respect a first stop', () => {
  const matrix = [
    [leg(1), leg(3), leg(7)],
    [null, leg(20), leg(20)],
    [leg(2), null, leg(2)],
    [leg(1), leg(10), null],
  ];
  assert.deepEqual(fastestInspectionOrder(matrix), { indices: [1, 2, 0], seconds: 6 });
  assert.deepEqual(fastestInspectionOrder(matrix, 0), { indices: [0, 1, 2], seconds: 23 });
  assert.throws(() => fastestInspectionOrder([[null], [null]]), /inspection_route_unavailable/);
});

test('route geometry and duration come from the provider response', () => {
  const xml = '<result><duration>4.5</duration><routelatlon>116.37,39.91;116.43,39.92;</routelatlon></result>';
  assert.deepEqual(parseTiandituLeg(xml, 'minutes'), { seconds: 270, points: [
    { longitude: 116.37, latitude: 39.91 }, { longitude: 116.43, latitude: 39.92 },
  ] });
  assert.throws(() => parseTiandituLeg('<result><duration>4</duration></result>', 'seconds'), /inspection_route_unavailable/);
  assert.throws(() => parseTiandituLeg('<!DOCTYPE result><result/>', 'minutes'), /inspection_route_unavailable/);
});

test('confirmed checkpoint beats all suggestions and withdrawn evidence falls back to human review', () => {
  const suggestion = { inspection_suggestion: { mode: 'remote', reason: '常规进展', priority: true } };
  assert.equal(inspectionProjection({ ...suggestion, inspection_evidence_available: false }).mode, 'manual');
  assert.equal(inspectionProjection({ ...suggestion, inspection_evidence_available: true }).mode, 'remote');
  const required = inspectionProjection({ ...suggestion, inspection_evidence_available: true,
    inspection_checkpoint: { name: '封闭前' }, inspection_decision: { mode: 'remote', reason: '旧决定' } });
  assert.equal(required.mode, 'required');
  assert.equal(required.requiresOnsite, true);
  assert.equal(required.reason, '封闭前');
  assert.ok(inspectionDistance({ latitude: 31, longitude: 120 }, { latitude: 31.002, longitude: 120 }) > 200);
});
