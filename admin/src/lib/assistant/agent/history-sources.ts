import type { HistorySnapshot } from './history';
import type { SynthesisSource } from './synthesis';

/** Pure projection shared by the historical read and requirement claim views. */
export function historySynthesisSources(snapshot: HistorySnapshot): SynthesisSource[] {
  return snapshot.sources.map(({ messageId, hash, memoryVersion, text, seq }) => ({ sourceId: 'H' + messageId, kind: 'history',
    title: '本咨询客户历史原话', text, history: { messageId, hash, memoryVersion, seq } }));
}
