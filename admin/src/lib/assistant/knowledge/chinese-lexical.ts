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

/** Query-only expansion uses literal terms already indexed in existing documents. */
export function chineseQueryTerms(query:string):string[] {
  const terms=new Set(chineseTerms(query));
  if(/(?:签|订).{0,8}(?:合同|协议)|(?:合同|协议).{0,8}(?:签|订)/u.test(query)) {
    for(const term of chineseTerms('签约'))terms.add(term);
  }
  return [...terms].sort();
}

/** Only accepts candidates already filtered by tenant/version/audience in the database. */
export function fuseAuthorizedCandidates<T extends { id: string; distance: number; terms: string[] }>(candidates: T[], query: string, limit = 5): T[] {
  const terms = new Set(chineseQueryTerms(query));
  const lexical = candidates.map(row => ({ row, score: row.terms.filter(t => terms.has(t)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  const scores = new Map<string, number>();
  [...candidates].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .forEach((row, i) => scores.set(row.id, 1 / (60 + i + 1)));
  lexical.forEach(({ row }, i) => scores.set(row.id, scores.get(row.id)! + 1 / (60 + i + 1)));
  return [...candidates].sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.id.localeCompare(b.id)).slice(0, limit);
}
