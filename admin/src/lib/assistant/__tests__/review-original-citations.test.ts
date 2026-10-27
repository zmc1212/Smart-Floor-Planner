import assert from 'node:assert/strict';
import { test } from 'node:test';
// Match the application entry's module initialization order for the existing
// history/source/Worker dependency cycle.
import '../agent/worker';
import { historySynthesisSources } from '../agent/history';
import { parseSynthesis } from '../agent/synthesis';

test('review originals use existing history citations while uncited or invented numbers still fail', () => {
  const sources = historySynthesisSources({ query: 'review', beforeSeq: '8', hasMore: false, oversized: false, sources: [
    { messageId: '1', hash: 'old', memoryVersion: 1, seq: '1', text: '预算12万' },
    { messageId: '8', hash: 'new', memoryVersion: 1, seq: '8', text: '预算提高到15万，瓷砖和地暖先照旧。另外量房前要准备什么？' },
  ] });
  const raw = (text: string, citations: unknown[]) => JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice', text, citations }] });
  const text = '此前原话预算12万，本轮原话提出15万。量房前可准备户型图。';
  assert.throws(() => parseSynthesis(raw(text, []), sources), /unsupported_model_commitment/);
  const citations = sources.map(source => ({ sourceId: source.sourceId, quote: source.text }));
  assert.equal(parseSynthesis(raw(text, citations), sources).segments[0].text, text);
  assert.throws(() => parseSynthesis(raw(text + '现场面积90平。', citations), sources), /unsupported_model_commitment/);
  assert.throws(() => parseSynthesis(raw(text, [{ sourceId: 'Hother', quote: '预算12万' }]), sources), /invalid_model_citation/);
  assert.equal(sources[0].kind, 'history'); assert.equal(sources[0].history?.messageId, '1');
});
