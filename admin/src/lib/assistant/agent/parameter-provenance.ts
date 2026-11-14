/**
 * Construction-quantity provenance is a separate contract from citation
 * presence. A number can be quoted correctly and still be the wrong kind of
 * fact: a master's unverified field value must not become an enterprise rule,
 * and deleting the digits must not leave an endorsement of that value behind.
 */

export const parameterProvenanceContract = '施工量数来源合同：每个施工量数只能属于（1）标准原文明确规定；（2）企业工艺明确规定；（3）当前项目实际记录；（4）师傅或用户提供但尚未核实；（5）模型自行估计。第4、5类不得写成确定要求、标准值或已核实事实；删除数字后也不得用“这个高度可以/按此施工/没问题”等语句间接认可。企业资料没有该参数时写明企业资料缺项；公开规范本次没有查到参数时写明本次未查到依据，不能称规范不存在该要求。无依据的量数只删除该量数及其依赖结论，保留有依据的其余解释。';

export type UserStatedParameter = {
  /** Original surface form, e.g. “200 mm” or “30-50mm”. */
  text: string;
  /** Every numeric value in the mention. A range keeps both bounds. */
  values: string[];
  /** Normalized unit token used for comparison. */
  unit: string;
};

export type ParameterEndorsementIssue = {
  /** The user/master value being endorsed, when it is still present. */
  values: string[];
  /** The sentence that endorses it. */
  text: string;
  reason: 'unsupported_user_value' | 'indirect_endorsement';
};

const unitPattern = '毫米|mm|厘米|cm|公分|米|小时|分钟|天';
const quantityPattern = new RegExp(
  '(\\d+(?:\\.\\d+)?)\\s*(?:[-–—~～至到]\\s*(\\d+(?:\\.\\d+)?))?\\s*(' + unitPattern + ')', 'giu');

function normalizeUnit(unit: string) {
  const value = unit.toLowerCase();
  if (['毫米', 'mm'].includes(value)) return 'mm';
  if (['厘米', 'cm', '公分'].includes(value)) return 'cm';
  if (['米'].includes(value)) return 'm';
  return value;
}

function unitVariants(unit: string) {
  return unit === 'mm' ? ['毫米', 'mm'] : unit === 'cm' ? ['厘米', 'cm', '公分'] : unit === 'm' ? ['米'] : [unit];
}

/** Only literal user/master quantities. A question without a number states no
 * field value and can never make a generated number look user-provided. */
export function userStatedParameters(text: string): UserStatedParameter[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  return [...text.matchAll(quantityPattern)].map(match => ({
    text: match[0],
    values: [match[1], match[2]].filter((value): value is string => typeof value === 'string' && !!value),
    unit: normalizeUnit(match[3]),
  }));
}

/** Compare a generated sentence with one user-stated mention without unit
 * conversion. “200 mm” and “200毫米” are the same value; “0.2 米” is not
 * silently treated as 200 mm because that would authorize a conversion. */
export function mentionsParameter(text: string, parameter: UserStatedParameter) {
  const variants = unitVariants(parameter.unit);
  return parameter.values.some(value => new RegExp(
    value.replace(/\./gu, '\\.') + '\\s*(?:' + variants.map(unit => unit.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|') + ')', 'iu').test(text));
}

/** Record version labels and photo counts describe provenance metadata, not
 * construction quantities. Every numeric claim view uses this projection; the
 * customer-facing answer and the original records are never rewritten. */
export function provenanceMetadataText(text: string) {
  return text
    .replace(/版本\s*[#第]?\s*\d+(?:\.\d+)*/gu, '版本')
    .replace(/第\s*\d+\s*版/gu, '版本')
    .replace(/(?:记录)?(?:编号|流水号)\s*[#:：]?\s*\d+/gu, '记录编号')
    .replace(/记录\s*[#:：]?\s*\d+/gu, '记录')
    .replace(/\d+\s*张(?:[^\s，,。；;、！？!?\n]{0,8})?(?:照片|图片|图)/gu, '照片')
    .replace(/(?:照片|图片|图)\s*[，,]?\s*\d+\s*张/gu, '照片');
}

/** The cited originals of the sentence. A number is supported only by a quote
 * that contains the same value and unit; another segment's quote never counts. */
export function parameterSupportedBy(quotes: readonly string[], parameter: UserStatedParameter) {
  return quotes.some(quote => mentionsParameter(quote, parameter));
}

const affirmative = /(?:可以|没问题|足够|符合|满足|达标|合格|就行|能用|可用|按(?:这个|此|该|你|师傅)|就(?:按|用|这么做|这样做)|建议|应当|应该|需要|必须|须|要求|标准|规定|做到|刷到|做到位)/u;
const uncertainty = /(?:不能|不可|无法|不确定|未核实|尚未|待核实|待确认|不宜|不建议|不代表|仅供参考|尚需|无法确认|不能确认)/u;
const sourceAttribution = /(?:你|您|师傅|工长|施工人员|提供人)(?:说|讲|提供|报|提到|给出|发)/u;
/** Deictic phrases that refer back to a previously stated user value. */
const deicticParameter = /(?:这个|该|这么|这样|上述|刚才|前面)(?:个)?(?:高度|宽度|厚度|深度|尺寸|数值|参数|量数|做法)|按(?:这个|此|该|你(?:说|提供|报)的|师傅(?:说|提供|报)的)|照(?:这个|你(?:说|提供)|师傅(?:说|提供))|(?:你|您|师傅)(?:说|提供|报)的(?:高度|宽度|厚度|尺寸|数值|参数)/u;
const commitmentVerb = /(?:可以|没问题|足够|符合|满足|达标|合格|能用|可用|行|就按|建议按|应当|应该|需要|必须|须|采用|按照|照着|这样做|这么施工)/u;

/** Bounded semantic bypass check. It does not rewrite the answer and does not
 * count another segment's citation as support for this claim. */
export function unverifiedParameterEndorsements(text: string, question: string, quotes: readonly string[] = []): ParameterEndorsementIssue[] {
  const parameters = userStatedParameters(question);
  if (!text || !parameters.length) return [];
  const cited = quotes.join('\n');
  const issues: ParameterEndorsementIssue[] = [];
  for (const sentence of text.split(/[。！？!?\n]/u)) {
    const clause = sentence.trim();
    if (!clause || uncertainty.test(clause)) continue;
    const credited = sourceAttribution.test(clause) && /(?:未核实|尚未核实|待核实|不能作为|不作为|不能当作|仅供参考)/u.test(clause);
    const stated = parameters.filter(parameter => mentionsParameter(clause, parameter));
    for (const parameter of stated) {
      if (parameterSupportedBy([cited], parameter) || !affirmative.test(clause) || /(?:未核实|尚未核实|待核实|不能作为|不作为|不能当作|仅供参考)/u.test(clause)) continue;
      issues.push({ values: parameter.values, text: clause, reason: 'unsupported_user_value' });
    }
    // After the digits are deleted, a deictic sentence can still endorse the
    // same unverified value. Require both a reference and a positive use.
    if (!stated.length && !credited && deicticParameter.test(clause) && commitmentVerb.test(clause)
      && !/(?:未核实|尚未核实|待核实|不能作为|不作为|不能当作|仅供参考|需(?:要)?现场|以现场|以设计|以方案为准)/u.test(clause)) {
      issues.push({ values: parameters.flatMap(parameter => parameter.values), text: clause, reason: 'indirect_endorsement' });
    }
  }
  return issues;
}

/** One repair instruction shared by native and synthesis paths. It names the
 * unsupported kind, never a replacement number. */
export function parameterEndorsementFeedback(issues: readonly ParameterEndorsementIssue[]) {
  const values = [...new Set(issues.flatMap(issue => issue.values))];
  return '施工量数来源不足：' + (values.length ? '用户或师傅提供的 ' + values.join('、') + ' 尚未核实。' : '本段用“这个高度/按此施工”等语句间接认可了尚未核实的数值。')
    + '删除该量数及其依赖结论，或明确写成“你/师傅提供但尚未核实”；不能改称行业惯例、企业标准或建议值，也不能只删数字保留“这个高度可以/没问题/就按这个做”。'
    + '保留其余有原文依据的解释；企业资料缺项就写明企业资料缺项。';
}
