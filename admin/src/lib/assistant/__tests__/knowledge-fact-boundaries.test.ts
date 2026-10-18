import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { focusedSynthesisMessages, parseSynthesis, synthesisInstructions, type SynthesisAnswer, type SynthesisSource } from '../agent/synthesis';
import { agentChatBody } from '../../ai/providers/agent-chat';
import type { ModelMessage } from '../contracts/model';
import { compactSynthesisMessages, synthesisTextBytes } from '../agent/synthesis-projection';
import { assertConflictAttribution } from '../agent/synthesis-attribution';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/knowledge-fact-boundaries.json', import.meta.url), 'utf8')) as {
  cases: Array<{ runId: string; semanticPassed: boolean; answer: SynthesisAnswer; sources: SynthesisSource[] }>;
  blocked: { runId: string; triggerId: string; messages: ModelMessage[] };
};

for (const c of fixture.cases) test('actual knowledge answer ' + c.runId + ': ' + (c.semanticPassed ? 'preserve material boundaries and existing internal-copy guard' : 'reject one-sided attribution of both conflicting rules'), () => {
  if (c.semanticPassed) {
    // The knowledge review passed the bounded material semantics, not the later
    // v57 publication-copy gate. Keep the exact v51 output rejected by that gate.
    assert.match(JSON.stringify(c.answer), /最小待核实项/);
    assert.throws(() => parseSynthesis(JSON.stringify(c.answer), c.sources), /invalid_model_answer/);
    const specimen = structuredClone(c.answer);
    for (const segment of specimen.segments) segment.text = segment.text.replaceAll('最小待核实项：', '需要核对的是：');
    assert.doesNotThrow(() => parseSynthesis(JSON.stringify(specimen), c.sources));
  }
  else assert.throws(() => parseSynthesis(JSON.stringify(c.answer), c.sources), /unresolved_evidence_conflict/);
});

for (const currentPolicy of [false, true]) test('actual4242 ' + (currentPolicy ? 'current' : 'original') + ' policy fits without losing originals or selection identity', () => {
  const messages = structuredClone(fixture.blocked.messages);
  if (currentPolicy) for (const m of messages) if (m.role === 'system') for (const p of m.content)
    if (p.type === 'text' && p.text.includes('专业综合问答（本段替代')) p.text = synthesisInstructions;
  const before = JSON.stringify(messages);
  const focused = focusedSynthesisMessages(messages, fixture.blocked.triggerId);
  assert.doesNotThrow(() => agentChatBody({ model: 'deepseek-flash', messages: focused, tools: [], maxTokens: 2048 }, 'https://api.deepseek.com'));
  const oldPackets = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  const packets = focused.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  for (const old of oldPackets) {
    const packet = packets.find(p => p.synthesisSources?.some((s: SynthesisSource) => old.synthesisSources.some((o: SynthesisSource) => o.sourceId === s.sourceId)))!;
    for (const s of old.synthesisSources) {
      const retained = packet.synthesisSources.find((v: SynthesisSource) => v.sourceId === s.sourceId)!;
      assert.equal(retained.text, s.text);
      assert.deepEqual(retained.professional, s.professional);
      assert.deepEqual(retained.applicability, s.applicability);
      assert.deepEqual(retained.context, s.context);
      if (s.material) {
        const material = { ...s.material }; if (material.text === s.text) delete material.text;
        assert.deepEqual(retained.material, material);
      }
    }
    assert.equal(packet.evidence.length, old.evidence.length);
    for (const e of old.evidence) {
      const retained = packet.evidence.find((v: { selectionId: string }) => v.selectionId === e.selectionId);
      assert.equal(retained.sourceId, e.sourceId);
      if (typeof retained.text === 'string') assert.equal(retained.text, e.text);
      else {
        const source = packet.synthesisSources.find((s: SynthesisSource) => s.sourceId === 'K' + retained.sourceId)!;
        assert.equal(source.text.slice(retained.textRange[0], retained.textRange[1]), e.text);
      }
    }
  }
  assert.equal(JSON.stringify(messages), before);
});

test('a specimen can cite both actual prerequisite originals; one-rule attribution needs no second rule', () => {
  const c = fixture.cases.find(c => !c.semanticPassed)!;
  const answer = structuredClone(c.answer), segment = answer.segments[3];
  const other = c.sources.find(s => s.sourceId === 'K1002')!;
  segment.citations.push({ sourceId: other.sourceId, quote: '前置条件：现场尺寸、完整点位资料和团队核对均待确认' });
  assert.doesNotThrow(() => parseSynthesis(JSON.stringify(answer), c.sources));
  const one = structuredClone(c.answer);
  one.segments[3].text = one.segments[3].text.replace('两份规则都带同样的前置条件：', '口径甲的前置条件：');
  assert.doesNotThrow(() => parseSynthesis(JSON.stringify(one), c.sources));
});

test('lossless overflow projection round-trips every actual4242 excerpt without changing source metadata or persisted messages', () => {
  const messages = structuredClone(fixture.blocked.messages);
  for (const m of messages) if (m.role === 'system') for (const p of m.content)
    if (p.type === 'text' && p.text.includes('专业综合问答（本段替代')) p.text = synthesisInstructions;
  const focused = focusedSynthesisMessages(messages, fixture.blocked.triggerId);
  // The integrated focus function now compacts automatically. Restore the
  // exact stored duplicate excerpts to exercise the helper's overflow branch.
  const tool = focused.find(m => m.role === 'tool')!;
  const packetWithExcerpts = JSON.parse(tool.content);
  packetWithExcerpts.evidence = JSON.parse(fixture.blocked.messages.find(m => m.role === 'tool')!.content).evidence;
  tool.content = JSON.stringify(packetWithExcerpts);
  const before = JSON.stringify(focused);
  assert.ok(synthesisTextBytes(focused) > 48000);
  const compacted = compactSynthesisMessages(focused);
  assert.doesNotThrow(() => agentChatBody({ model: 'deepseek-flash', messages: compacted, tools: [], maxTokens: 2048 }, 'https://api.deepseek.com'));
  const old = JSON.parse(focused.find(m => m.role === 'tool')!.content);
  const packet = JSON.parse(compacted.find(m => m.role === 'tool')!.content);
  assert.equal(packet.synthesisSources.length, old.synthesisSources.length);
  for (const s of old.synthesisSources) {
    const original = { ...s }; delete original.citationQuotes;
    assert.deepEqual(packet.synthesisSources.find((v: SynthesisSource) => v.sourceId === s.sourceId), original);
  }
  assert.equal(packet.evidence.length, old.evidence.length);
  for (const e of old.evidence) {
    const retained = packet.evidence.find((v: { selectionId: string }) => v.selectionId === e.selectionId);
    const source = packet.synthesisSources.find((v: SynthesisSource) => v.sourceId === 'K' + retained.sourceId)!;
    assert.equal(source.text.slice(retained.textRange[0], retained.textRange[1]), e.text);
  }
  assert.equal(JSON.stringify(focused), before);
  const short: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'short' }] }];
  assert.equal(compactSynthesisMessages(short), short);
});

test('bounded attribution guard requires both opposed prerequisite originals, not just two quotations from one side', () => {
  for (const c of fixture.cases.filter(c => !c.semanticPassed)) {
    assert.throws(() => assertConflictAttribution(c.answer, c.sources), /unresolved_evidence_conflict/);
    const supported = structuredClone(c.answer);
    supported.segments[3].citations.push({ sourceId: 'K1002', quote: '前置条件：现场尺寸、完整点位资料和团队核对均待确认' });
    assert.doesNotThrow(() => assertConflictAttribution(supported, c.sources));
    const unrelatedQuote = structuredClone(c.answer);
    unrelatedQuote.segments[3].citations.push({ sourceId: 'K1002', quote: '办公屏幕必须正对强光窗户，不采用侧向布置。' });
    assert.throws(() => assertConflictAttribution(unrelatedQuote, c.sources), /unresolved_evidence_conflict/);
  }
});

test('overflow projection preserves unfamiliar evidence metadata and unresolved text; irreducible input still fails the original budget', () => {
  const focused = focusedSynthesisMessages(structuredClone(fixture.blocked.messages), fixture.blocked.triggerId);
  const tool = focused.find(m => m.role === 'tool')!;
  const packet = JSON.parse(tool.content);
  packet.evidence[0].permissionVersion = 'synthetic-metadata-must-remain';
  packet.evidence[1].text = 'synthetic text absent from the original; keep it for the existing validator';
  packet.answerContext = { responseRules: 'synthetic repeated copy hint '.repeat(2000) };
  tool.content = JSON.stringify(packet);
  assert.ok(synthesisTextBytes(focused) > 48000);
  const compacted = JSON.parse(compactSynthesisMessages(focused).find(m => m.role === 'tool')!.content);
  assert.deepEqual(compacted.evidence[0], packet.evidence[0]);
  assert.deepEqual(compacted.evidence[1], packet.evidence[1]);
  const tooLarge: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(48001) }] }];
  assert.throws(() => agentChatBody({ model: 'offline-only', messages: compactSynthesisMessages(tooLarge), tools: [], maxTokens: 128 }), /agent_input_limit/);
});

test('equal knowledge wording and descriptive metadata cannot merge different canonical chunk identities', () => {
  const original = JSON.parse(fixture.blocked.messages.find(m => m.role === 'tool')!.content).synthesisSources.find((s: SynthesisSource) => s.kind === 'knowledge');
  const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'same-words', text: '核对原件' }) }] },
    { role: 'tool', callId: 'source-identity', content: JSON.stringify({ synthesisSources: [{ ...original, sourceId: 'Kcanonical-a' }, { ...original, sourceId: 'Kcanonical-b' }] }) }];
  const projected = JSON.parse(focusedSynthesisMessages(messages, 'same-words').find(m => m.role === 'tool')!.content);
  assert.deepEqual(projected.synthesisSources.map((s: SynthesisSource) => s.sourceId), ['Kcanonical-a', 'Kcanonical-b']);
  assert.ok(projected.synthesisSources.every((s: SynthesisSource) => s.text === original.text));
});
