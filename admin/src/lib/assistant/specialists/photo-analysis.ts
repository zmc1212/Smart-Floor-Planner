import { fail } from '../contracts';

export const specialistPhotoAnalysisProtocol = 'specialist-photo-analysis-v1';
/** The image turn keeps the verified kind/text tool contract. Structured
 * observation is extracted by this server-side labelled-text parser instead of
 * widening the provider tool schema. */
export const photoObservationTextProtocol = 'specialist-photo-observation-text-v1';
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

export type PhotoObservationTextParse =
  | { parsed: true; analysis: SpecialistPhotoAnalysis }
  | { parsed: false; reason: string };

type SectionKey = 'visibleObservations' | 'possibleIssues' | 'notObservable' | 'requiredEvidence'
  | 'applicableStandards' | 'confidence' | 'needsHumanReview';

const sectionLabels: Array<[SectionKey, RegExp]> = [
  ['visibleObservations', /^(?:可见现象|可见内容)$/u],
  ['possibleIssues', /^可能问题(?:及原因)?$/u],
  ['notObservable', /^(?:无法确认|照片无法确认|不可见内容)$/u],
  ['requiredEvidence', /^(?:需补充|需要补充|补充证据|需补充的资料)$/u],
  ['applicableStandards', /^(?:可对应标准|对应标准|适用标准)$/u],
  ['confidence', /^(?:可信程度|可信度)$/u],
  ['needsHumanReview', /^(?:人工复核|是否需要人工复核)$/u],
];

const emptyMarker = /^(?:无|暂无|没有|未见异常|不涉及)$/u;
const stopPunctuation = /[。．.；;]+$/u;
const bullet = /^\s*(?:[-*•·]|\d+[.、)])\s*/u;
const heading = /^\s*([^：:]{2,16})\s*[：:]\s*(.*)$/u;
const issueReason = /^(.*?)[（(]\s*原因\s*[：:]\s*([^）)]*)[）)]/u;
const issueReasonInline = /^(.*?)[；;，,]\s*原因\s*[：:]\s*(.+)$/u;

function sectionOf(label: string): SectionKey | null {
  const text = label.replace(/[\s*#]/gu, '');
  for (const [key, pattern] of sectionLabels) if (pattern.test(text)) return key;
  return null;
}

function splitItems(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || emptyMarker.test(trimmed.replace(stopPunctuation, ''))) return [];
  return trimmed.split(/\r?\n/u).map(item => item.trim()).filter(item => item.length > 0
    && !emptyMarker.test(item.replace(stopPunctuation, '')));
}

function confidenceOf(value: string): SpecialistPhotoAnalysis['confidence'] | null {
  const text = value.trim().replace(stopPunctuation, '');
  if (/^(?:低|low)$/iu.test(text)) return 'low';
  if (/^(?:中|medium|一般)$/iu.test(text)) return 'medium';
  if (/^(?:高|high)$/iu.test(text)) return 'high';
  return null;
}

function reviewOf(value: string): boolean | null {
  const text = value.trim().replace(stopPunctuation, '');
  if (/^(?:需要|是|yes|true|必要)$/iu.test(text)) return true;
  if (/^(?:不需要|否|no|false|不必要)$/iu.test(text)) return false;
  return null;
}

function issueOf(value: string): SpecialistPhotoIssue | null {
  const match = issueReason.exec(value.trim()) ?? issueReasonInline.exec(value.trim());
  if (!match) return null;
  const observation = match[1].trim();
  const reason = (match[2] ?? '').trim();
  return observation && reason ? { observation, reason } : null;
}

/** Extract the fixed observation envelope from the model's ordinary answer
 * text. The tool schema stays `kind`/`text`, so a missing or malformed section
 * yields `parsed:false` and the untouched model text; it is never reported as a
 * successful structured analysis. */
export function parsePhotoObservationText(value: string): PhotoObservationTextParse {
  if (typeof value !== 'string' || !value.trim()) return { parsed: false, reason: 'empty_text' };
  const sections = new Map<SectionKey, string[]>();
  let current: SectionKey | null = null;
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.replace(bullet, '').trim();
    if (!line) continue;
    const match = heading.exec(line);
    const key = match ? sectionOf(match[1]) : null;
    if (key) {
      current = key;
      sections.set(key, [...(sections.get(key) ?? []), match![2]]);
      continue;
    }
    if (current) sections.set(current, [...(sections.get(current) ?? []), line]);
  }
  const joined = (key: SectionKey) => splitItems((sections.get(key) ?? []).join('\n'));
  const one = (key: SectionKey) => (sections.get(key) ?? []).join(' ').trim();
  const missing = (['visibleObservations', 'possibleIssues', 'notObservable', 'requiredEvidence', 'applicableStandards',
    'confidence', 'needsHumanReview'] as SectionKey[]).filter(key => !sections.has(key));
  if (missing.length) return { parsed: false, reason: 'missing_sections:' + missing.join(',') };
  const possibleIssues: SpecialistPhotoIssue[] = [];
  for (const item of joined('possibleIssues')) {
    const issue = issueOf(item);
    if (!issue) return { parsed: false, reason: 'issue_reason_missing' };
    possibleIssues.push(issue);
  }
  const confidence = confidenceOf(one('confidence'));
  if (!confidence) return { parsed: false, reason: 'confidence_unrecognized' };
  const needsHumanReview = reviewOf(one('needsHumanReview'));
  if (needsHumanReview === null) return { parsed: false, reason: 'review_flag_unrecognized' };
  try {
    return { parsed: true, analysis: parseSpecialistPhotoAnalysis({
      visibleObservations: joined('visibleObservations'),
      possibleIssues,
      notObservable: joined('notObservable'),
      requiredEvidence: joined('requiredEvidence'),
      applicableStandards: joined('applicableStandards'),
      confidence,
      needsHumanReview,
    }) };
  } catch (error) {
    const reason = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : 'invalid_observation';
    return { parsed: false, reason };
  }
}
