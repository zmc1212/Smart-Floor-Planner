import { fingerprint } from '../contracts';
import type { FileLocator } from '../contracts/source-file';
import type { ManagedSlice } from './managed-provider';
import { knowledgeTextAllowed } from './provenance';

export type ApprovedPassage = { text: string; original: string; start: number; end: number; file?: FileLocator };
export type ManagedChunk = ApprovedPassage & { slice: { id: string; hash: string; section: string[] } };

const compact = (text: string) => text.normalize('NFKC').replace(/\s/gu, '');

/** The citation is the complete approved local clause or table row. A vendor
 * boundary may bisect it. Never cite remote text as original business policy. */
export function bindManagedSlices(passages: ApprovedPassage[], slices: ManagedSlice[],
  target: { workspaceId: string; indexId: string; documentId: string }) {
  const sources = passages.map(p => ({ passage: p, original: compact(p.original), full: compact(p.text) }));
  const result: ManagedChunk[] = [], seen = new Set<string>();
  for (const slice of slices) {
    if (slice.workspaceId !== target.workspaceId || slice.indexId !== target.indexId || slice.documentId !== target.documentId
      || !knowledgeTextAllowed(slice.text, ...slice.section)) continue;
    const candidate = compact(slice.text);
    const full = sources.filter(s => s.original && (candidate.includes(s.full) || candidate.includes(s.original)));
    // Duplicate short lines on different pages need their reviewed context.
    const matches = full.filter(s => s.full !== s.original && candidate.includes(s.full)
      || sources.filter(x => x.original === s.original).length === 1);
    if (!matches.length && candidate.length >= 12) {
      const partial = sources.filter(s => s.original.includes(candidate));
      if (partial.length === 1) matches.push(partial[0]);
    }
    for (const match of matches) {
      const key = slice.id + ':' + match.passage.start;
      if (seen.has(key) || !knowledgeTextAllowed(match.passage.text)) continue;
      seen.add(key);
      result.push({ ...match.passage, slice: { id: slice.id, hash: fingerprint(slice.text),
        section: match.passage.file?.section ?? [] } });
    }
  }
  return result;
}

export function approvedTextPassages(text: string): ApprovedPassage[] {
  let start = 0;
  return (text.match(/[\s\S]+?(?:\r?\n[ \t]*\r?\n|$)/gu) ?? []).map(paragraph => {
    const end = start + Array.from(paragraph).length;
    const result = { start, end, text: paragraph, original: paragraph };
    start = end;
    return result;
  });
}
