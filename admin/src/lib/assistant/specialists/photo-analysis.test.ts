import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePhotoObservationText, parseSpecialistPhotoAnalysis } from './photo-analysis';
import { photoObservationTool } from '../agent/image-context';

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

const labelled = `管根周边能看到灰色密封材料，右侧边缘有一处缺口。
可见现象：管根周边有灰色密封材料；右侧边缘可见缺口
可能问题：右侧边缘缺口（原因：缺口处可能形成渗水通道）
无法确认：密封层厚度、粘结强度以及是否做过闭水试验
需补充：管根正上方和侧面的近景照片；该部位施工记录
可对应标准：GB 55030-2022
可信程度：低
人工复核：需要`;

test('the labelled answer text is parsed into the fixed observation envelope server-side', () => {
  const parsed = parsePhotoObservationText(labelled);
  assert.equal(parsed.parsed, true);
  if (!parsed.parsed) return;
  assert.equal(parsed.analysis.visibleObservations.length, 1);
  assert.deepEqual(parsed.analysis.possibleIssues, [{ observation: '右侧边缘缺口', reason: '缺口处可能形成渗水通道' }]);
  assert.deepEqual(parsed.analysis.notObservable.length, 1);
  assert.equal(parsed.analysis.confidence, 'low');
  assert.equal(parsed.analysis.needsHumanReview, true);
});

test('unparsed text keeps the original answer and is never reported as structured success', () => {
  for (const [value, reason] of [
    ['管根看起来没问题', 'missing_sections:'],
    [labelled.replace('\n人工复核：需要', ''), 'missing_sections:needsHumanReview'],
    [labelled.replace('可信程度：低', '可信程度：大概'), 'confidence_unrecognized'],
    [labelled.replace('可能问题：右侧边缘缺口（原因：缺口处可能形成渗水通道）', '可能问题：右侧边缘缺口'), 'issue_reason_missing'],
    [labelled.replace('可见现象：管根周边有灰色密封材料；右侧边缘可见缺口', '可见现象：管根已验收合格'), 'unsupported_model_commitment'],
    [labelled.replace('可见现象：管根周边有灰色密封材料；右侧边缘可见缺口', '可见现象：涂层厚度约1.5mm'), 'unsupported_model_commitment'],
  ] as const) {
    const parsed = parsePhotoObservationText(value);
    assert.equal(parsed.parsed, false, value);
    if (!parsed.parsed) assert.ok(parsed.reason.startsWith(reason), parsed.reason);
  }
});

test('section values tolerate Chinese sentence punctuation', () => {
  const parsed = parsePhotoObservationText(labelled.replace('可信程度：低', '可信程度：低。')
    .replace('人工复核：需要', '人工复核：需要。').replace('可对应标准：GB 55030-2022', '可对应标准：无。'));
  assert.equal(parsed.parsed, true);
  if (parsed.parsed) {
    assert.equal(parsed.analysis.confidence, 'low');
    assert.deepEqual(parsed.analysis.applicableStandards, []);
  }
});

test('an issue may carry trailing explanation after the reason parenthesis', () => {
  const parsed = parsePhotoObservationText(labelled.replace(
    '可能问题：右侧边缘缺口（原因：缺口处可能形成渗水通道）',
    '可能问题：画面缺乏可判读的现场构件（原因：图片内容为示意性图形而非现场照片），无法据此提出具体问题。'));
  assert.equal(parsed.parsed, true);
  if (parsed.parsed) assert.equal(parsed.analysis.possibleIssues[0].reason, '图片内容为示意性图形而非现场照片');
});

test('the verified image tool contract keeps kind/text without structured observation fields', () => {
  assert.deepEqual(Object.keys(photoObservationTool.parameters.properties ?? {}).sort(), ['kind', 'text']);
  assert.deepEqual(photoObservationTool.parameters.required, ['kind', 'text']);
});
