import { fuseBranchCandidates, hybridFusionConfiguration, type HybridBranchRanks } from './hybrid-fusion';

/** Versioned dependency-free Chinese segmentation with renovation synonyms and bigrams. */
const groups = [
  ['水电', '水路', '电路', '电线', '管线'], ['防水', '闭水', '漏水', '渗水'],
  ['拆除', '拆墙', '承重墙', '砸墙'], ['报价', '预算', '费用', '收费'],
  ['工期', '进度', '完工', '延期'], ['甲醛', '环保', '空气', '污染'],
  ['质保', '保修', '售后', '维修'], ['验收', '检查', '合格'],
  ['瓷砖', '地砖', '墙砖', '空鼓'], ['橱柜', '台面', '柜体'],
  ['量房', '测量', '上门'], ['垃圾', '清运', '渣土'],
  ['隔音', '噪音', '静音'], ['地暖', '供暖', '采暖'],
];
export function chineseTerms(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const terms = new Set<string>();
  for (const part of new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(normalized)) {
    if (part.isWordLike && part.segment.length > 1) terms.add(part.segment);
  }
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
  }
  for (let i = 0; i < groups.length; i++) if (groups[i].some(word => normalized.includes(word))) terms.add(`renovation:${i}`);
  return [...terms].sort();
}

export const queryExpansionConfiguration = {
  version: 'renovation-terms-v1', maxRules: 8, maxAddedTerms: 64,
  originalWeight: 3, expandedWeight: 1,
} as const;

// These are retrieval spellings, never engineering equivalences or project facts.
// In particular, tile back-coating, grout, adhesive grades and tests stay distinct.
const professionalAliases = [
  { rule: 'tile_adhesive', forms: ['瓷砖胶', '瓷砖粘结剂', '瓷砖黏结剂', '瓷砖粘合剂'] },
  { rule: 'water_retention_test', forms: ['闭水试验', '闭水实验', '闭水测试', '蓄水试验', '蓄水测试'] },
  { rule: 'equipotential_bonding', forms: ['等电位联结', '等电位连接'] },
  { rule: 'putty_application', forms: ['刮腻子', '批腻子', '批刮腻子'] },
] as const;

export type QueryExpansionTrace = {
  version: typeof queryExpansionConfiguration.version;
  matches: Array<{ rule: string; matched: string; addedTerms: string[]; weight: number }>;
  addedTerms: string[];
};
export type ExpandedChineseQuery = { terms: string[]; originalTerms: string[]; expansion: QueryExpansionTrace };

/** Query-only additions work against existing literal indexes; no reindex or LLM call. */
export function expandChineseQuery(query: string): ExpandedChineseQuery {
  const normalized = query.normalize('NFKC').toLowerCase(), originalTerms = chineseTerms(query);
  const original = new Set(originalTerms), added = new Set<string>();
  const matches: QueryExpansionTrace['matches'] = [];
  const add = (rule: string, matched: string, alternatives: readonly string[], weight: number = queryExpansionConfiguration.expandedWeight) => {
    if (matches.length >= queryExpansionConfiguration.maxRules) return;
    const emitted: string[] = [];
    for (const alternative of alternatives) {
      for (const term of chineseTerms(alternative)) {
        if (added.size >= queryExpansionConfiguration.maxAddedTerms) break;
        // Related-topic markers are not synonym expansions.
        if (!term.startsWith('renovation:') && !original.has(term) && !added.has(term)) {
          added.add(term); emitted.push(term);
        }
      }
    }
    if (emitted.length) matches.push({ rule, matched, addedTerms: emitted.sort(), weight });
  };
  const signing = normalized.match(/(?:签|订).{0,8}(?:合同|协议)|(?:合同|协议).{0,8}(?:签|订)/u);
  if (signing) {
    // The existing explicit signing intent keeps its original lexical weight.
    add('contract_signing', signing[0], ['签约'], queryExpansionConfiguration.originalWeight);
  }
  for (const { rule, forms } of professionalAliases) {
    const matched = forms.find(form => normalized.includes(form));
    if (matched) add(rule, matched, forms);
  }
  // Only compact the spelling of an explicit C1/C2 designation. Never drop its
  // T/E/S1/S2 suffix, infer a grade, or merge an arbitrary manufacturer's model.
  for (const match of normalized.matchAll(/(?<![a-z0-9._/-])c[a-z0-9\t ._/-]*/gu)) {
    const spelling = match[0].trim(), compact = spelling.replace(/[\t ]/g, '');
    // Consume the entire ASCII designation before validating, so an unsupported
    // suffix or manufacturer model cannot backtrack into a valid shorter grade.
    if (/[\t ]/.test(spelling) && /^c[12]t?e?(?:s[12])?$/.test(compact)) {
      add('adhesive_designation_spacing', spelling, [compact]);
    }
  }
  const addedTerms = [...added].sort();
  return { terms: [...originalTerms, ...addedTerms].sort(), originalTerms,
    expansion: { version: queryExpansionConfiguration.version, matches, addedTerms } };
}

export function chineseQueryTerms(query: string): string[] { return expandChineseQuery(query).terms; }

export function queryTermWeights(query: ExpandedChineseQuery): Record<string, number> {
  const weights = new Map(query.originalTerms.map(term => [term, queryExpansionConfiguration.originalWeight as number]));
  for (const term of query.expansion.addedTerms) {
    const match = query.expansion.matches.find(m => m.addedTerms.includes(term));
    weights.set(term, match?.weight ?? queryExpansionConfiguration.expandedWeight);
  }
  return Object.fromEntries(weights);
}

export function queryLexicalScore(terms: readonly string[], query: ExpandedChineseQuery): number {
  const weights = new Map(Object.entries(queryTermWeights(query)));
  return terms.reduce((score, term) => score + (weights.get(term) ?? 0), 0);
}

/** Only accepts candidates already filtered by tenant/version/audience in the database. */
export function fuseAuthorizedCandidates<T extends { id: string; distance: number; terms: string[] }>(candidates: T[], query: string | ExpandedChineseQuery, limit = 5): T[] {
  const expanded = typeof query === 'string' ? expandChineseQuery(query) : query;
  const weights = new Map(Object.entries(queryTermWeights(expanded)));
  const lexical = candidates.map(row => ({ row, score: row.terms.reduce((score, term) => score + (weights.get(term) ?? 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  const ranks = new Map<string, HybridBranchRanks>();
  [...candidates].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, hybridFusionConfiguration.perBranch).forEach((row, i) => ranks.set(row.id, { semanticRank: i + 1, lexicalRank: null }));
  lexical.slice(0, hybridFusionConfiguration.perBranch).forEach(({ row }, i) => ranks.set(row.id,
    { semanticRank: ranks.get(row.id)?.semanticRank ?? null, lexicalRank: i + 1 }));
  return fuseBranchCandidates(candidates, ranks, limit);
}
