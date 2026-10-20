import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chineseTerms, fuseAuthorizedCandidates } from '../knowledge/chinese-lexical';
import { fuseBranchCandidates, type HybridBranchRanks } from '../knowledge/hybrid-fusion';

test('K01/11 disjoint thirty-result branches cannot manufacture a second RRF vote', () => {
  for (const terms of [[], ['瓷砖']]) {
    const semantic = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1).padStart(3, '0'), distance: .1 + i / 1000, terms }));
    const lexical = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 101), distance: .4 + i / 1000, terms: chineseTerms('瓷砖胶') }));
    const ranked = fuseAuthorizedCandidates([...semantic, ...lexical], '瓷砖胶', 60);
    // Both branch winners have one equal vote. Previously the lexical winner
    // received an additional invented semantic-rank-31 vote and displaced 001.
    assert.equal(ranked[0], semantic[0]); assert.equal(ranked[1], lexical[0]);
    assert.equal(ranked.length, 60); assert.equal(new Set(ranked).size, 60);
  }
});

test('K11 SQL branch ranks determine fusion, regardless of merged order or a lexical score outside its top thirty', () => {
  const rows = [{ id: 'semantic' }, { id: 'lexical' }, { id: 'both' }, { id: 'outside' }];
  const ranks = new Map<string, HybridBranchRanks>([
    ['semantic', { semanticRank: 1, lexicalRank: null }], ['lexical', { semanticRank: null, lexicalRank: 1 }],
    ['both', { semanticRank: 30, lexicalRank: 30 }], ['outside', { semanticRank: null, lexicalRank: null }],
  ]);
  const result = fuseBranchCandidates(rows, ranks, 60);
  assert.equal(result[0], rows[2]); assert.equal(result.length, 3);
  assert.deepEqual(fuseBranchCandidates([...rows].reverse(), ranks, 60), result);
  assert.deepEqual(fuseBranchCandidates(rows, ranks, 1), [rows[2]]);
});

test('K11 absent, zero, nonintegral and out-of-branch ranks never create a vote', () => {
  for (const rank of [null, 0, -1, 1.5, 31, NaN, Infinity]) {
    const row = { id: 'candidate' };
    assert.deepEqual(fuseBranchCandidates([row], new Map([[row.id, { semanticRank: rank, lexicalRank: null }]])), []);
  }
  assert.deepEqual(fuseBranchCandidates([{ id: 'unseen' }], new Map()), []);
});
