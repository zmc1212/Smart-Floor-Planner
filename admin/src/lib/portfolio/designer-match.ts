import type { Candidate } from './public-query';

export type DesignerMatch = {
  candidate: Candidate;
  reason: string;
  match: 'community_style' | 'layout_style' | 'city_style';
  score: number;
};

/** Ranking is deterministic: verified community, then layout, then style.
 * One author appears at most once so multiple works cannot occupy the card list. */
export function matchDesigners(candidates: Candidate[], input: { community?: string | null; style?: string; layout?: string }): DesignerMatch[] {
  const community = input.community ?? null, style = input.style || '', layout = input.layout || '';
  const score = (candidate: Candidate) => Number(community !== null && candidate.work.community?.id === community) * 4
    + Number(Boolean(layout) && candidate.content.layoutTypes.includes(layout)) * 2
    + Number(Boolean(style) && (candidate.content.primaryStyle === style || candidate.content.secondaryStyles.includes(style)));
  const seen = new Set<string>(), matches: DesignerMatch[] = [];
  for (const candidate of [...candidates].sort((a, b) => score(b) - score(a))) {
    if (seen.has(candidate.work.authorId)) continue;
    seen.add(candidate.work.authorId);
    const sameCommunity = community !== null && candidate.work.community?.id === community;
    const layoutMatch = Boolean(layout) && candidate.content.layoutTypes.includes(layout);
    const specialty = Boolean(layout) && candidate.profile.layoutSpecialties.includes(layout);
    const descriptor = style + (layout ? `${layout}作品` : '作品');
    matches.push({
      candidate, score: score(candidate),
      reason: sameCommunity ? `在同一已核验小区有${style}${layout}作品`
        : specialty ? `擅长${layout}，服务${candidate.work.cityName}，有${style ? `${style}公开作品` : '公开作品'}`
        : layoutMatch ? `服务${candidate.work.cityName}，有${descriptor}` : `服务${candidate.work.cityName}，有${style}公开作品`,
      match: sameCommunity ? 'community_style' : layoutMatch || specialty ? 'layout_style' : 'city_style',
    });
    if (matches.length === 3) break;
  }
  return matches;
}
