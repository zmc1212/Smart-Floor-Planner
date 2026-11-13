import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSpecialistPhotoAnalysis } from './photo-analysis';

const analysis = {
  visibleObservations: ['管根周边可见一圈灰色密封材料，表面有轻微开裂'],
  possibleIssues: [{ observation: '管根右侧密封材料边缘有缺口', reason: '缺口处可能形成渗水通道' }],
  notObservable: ['照片无法确认密封层厚度、粘结强度和是否已做闭水试验'],
  requiredEvidence: ['补充管根正上方和侧面的近景照片', '提供该部位的施工记录和验收记录'],
  applicableStandards: ['GB 55030-2022'],
  confidence: 'low',
  needsHumanReview: true,
};

test('the fixed photo envelope keeps visible facts, issues, unknowns and missing evidence separate', () => {
  const parsed = parseSpecialistPhotoAnalysis(structuredClone(analysis));
  assert.deepEqual(parsed.visibleObservations, analysis.visibleObservations);
  assert.deepEqual(parsed.possibleIssues, analysis.possibleIssues);
  assert.equal(parsed.confidence, 'low');
  assert.equal(parsed.needsHumanReview, true);
});

test('a photo analysis cannot declare acceptance, release or precise construction quantities', () => {
  for (const observations of [
    ['管根已验收合格'], ['防水层验收通过，可以放行'], ['该处涂层厚度达到1.5mm'],
    ['闭水试验合格'],
  ]) assert.throws(() => parseSpecialistPhotoAnalysis({ ...analysis, visibleObservations: observations }), /unsupported_model_commitment/);
  assert.doesNotThrow(() => parseSpecialistPhotoAnalysis({ ...analysis,
    notObservable: ['照片无法确认是否已验收合格，也不能判定放行'] }));
});

test('an issue without human review or required evidence is rejected', () => {
  assert.throws(() => parseSpecialistPhotoAnalysis({ ...analysis, needsHumanReview: false }), /unsupported_model_commitment/);
  assert.throws(() => parseSpecialistPhotoAnalysis({ ...analysis, requiredEvidence: [] }), /unsupported_model_commitment/);
});

test('malformed envelopes fail closed instead of partially accepting fields', () => {
  for (const value of [null, [], {}, { ...analysis, confidence: 'certain' },
    { ...analysis, visibleObservations: [], notObservable: [] },
    { ...analysis, extra: true },
    { ...analysis, possibleIssues: [{ observation: '缺口' }] }]) {
    assert.throws(() => parseSpecialistPhotoAnalysis(value), /invalid_model_answer|unsupported_model_commitment/);
  }
});
