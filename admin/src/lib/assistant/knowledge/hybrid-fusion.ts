export const hybridFusionConfiguration = { perBranch: 30, rrfK: 60, rankSource: 'actual_branch_ranks_v1' } as const;
export type HybridBranchRanks = { semanticRank: number | null; lexicalRank: number | null };

/** Only actual branch members contribute. Candidates must already be authorized.
 * A lexical-only result must not acquire a semantic vote from the merged pool. */
export function fuseBranchCandidates<T extends { id: string }>(
  candidates: T[], ranks: ReadonlyMap<string, HybridBranchRanks>, limit = 5,
): T[] {
  const contribution = (rank: number | null | undefined) => typeof rank === 'number' && Number.isInteger(rank) && rank > 0 && rank <= hybridFusionConfiguration.perBranch
    ? 1 / (hybridFusionConfiguration.rrfK + rank) : 0;
  return candidates.map(row => {
    const rank = ranks.get(row.id);
    return { row, score: contribution(rank?.semanticRank) + contribution(rank?.lexicalRank) };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, limit).map(item => item.row);
}
