import { fail } from '../contracts';

export const specialistPhotoAnalysisProtocol = 'specialist-photo-analysis-v1';
export type SpecialistPhotoIssue = { observation: string; reason: string };
export type SpecialistPhotoAnalysis = {
  visibleObservations: string[];
  possibleIssues: SpecialistPhotoIssue[];
  notObservable: string[];
  requiredEvidence: string[];
  applicableStandards: string[];
  confidence: 'low' | 'medium' | 'high';
  needsHumanReview: boolean;
};

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const list = (value: unknown, max: number) => Array.isArray(value) && value.length <= max
  && value.every(item => text(item, 400));
// A photo may describe the absence of a conclusion; it may not assert one.
const denial = /(?:不能|不可|无法|未(?:能)?|不代表|不等于|不足以|尚待|未见|没有)/u;
const formalConclusion = /(?:已(?:经)?(?:正式)?(?:验收(?:合格|通过|完成)?|放行)|(?:验收(?:结果)?(?:合格|通过|完成|成功))|(?:(?:闭水|蓄水|淋水)?(?:试验|检验)(?:结果)?(?:合格|通过|成功))|(?:正式放行))/u;
const preciseQuantity = /\d+(?:\.\d+)?\s*(?:mm|cm|m\b|毫米|厘米|公分|米|小时|天)/iu;

function assertsConclusion(value: string) {
  return value.split(/[。；;！？!?\n]/u).some(sentence => formalConclusion.test(sentence) && !denial.test(sentence));
}

/** Validate the fixed photo-analysis envelope. It separates visible facts,
 * possible issues, what the image cannot prove, missing evidence and the
 * authoritative standards; it never accepts an engineering acceptance claim. */
export function parseSpecialistPhotoAnalysis(value: unknown): SpecialistPhotoAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_model_answer', 502);
  const record = value as Record<string, unknown>;
  const keys = ['visibleObservations', 'possibleIssues', 'notObservable', 'requiredEvidence',
    'applicableStandards', 'confidence', 'needsHumanReview'];
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !(key in record))) fail('invalid_model_answer', 502);
  if (!list(record.visibleObservations, 12) || !list(record.notObservable, 12)
    || !list(record.requiredEvidence, 12) || !list(record.applicableStandards, 8)) fail('invalid_model_answer', 502);
  if (!Array.isArray(record.possibleIssues) || record.possibleIssues.length > 8
    || record.possibleIssues.some(issue => !issue || typeof issue !== 'object'
      || Object.keys(issue).sort().join(',') !== 'observation,reason'
      || !text((issue as SpecialistPhotoIssue).observation, 400) || !text((issue as SpecialistPhotoIssue).reason, 400)))
    fail('invalid_model_answer', 502);
  if (!['low', 'medium', 'high'].includes(String(record.confidence))
    || typeof record.needsHumanReview !== 'boolean') fail('invalid_model_answer', 502);
  const result = record as unknown as SpecialistPhotoAnalysis;
  const observations = [...result.visibleObservations, ...result.possibleIssues.map(issue => issue.observation)];
  if (!result.visibleObservations.length && !result.notObservable.length) fail('invalid_model_answer', 502);
  // Visible pixels cannot establish a precise construction quantity, an
  // acceptance result, a release or a hidden-works conclusion.
  if (observations.some(item => preciseQuantity.test(item))) fail('unsupported_model_commitment', 502);
  if (observations.some(assertsConclusion) || result.notObservable.some(assertsConclusion)) fail('unsupported_model_commitment', 502);
  if (result.possibleIssues.length && (!result.needsHumanReview || !result.requiredEvidence.length))
    fail('unsupported_model_commitment', 502);
  return result;
}
