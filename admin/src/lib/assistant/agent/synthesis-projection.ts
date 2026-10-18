import { agentModelLimits, type ModelMessage } from '../contracts/model';
import type { SynthesisSource } from './synthesis';

type Packet = Record<string, unknown> & { synthesisSources: Array<SynthesisSource & Record<string, unknown>> };

/** The official DeepSeek system format adds newlines between text parts. This
 * conservative count also fits providers that keep those parts separate. */
export function synthesisTextBytes(messages: ModelMessage[]) {
  return messages.reduce((n, m) => n + Buffer.byteLength(typeof m.content === 'string' ? m.content
    : m.content.filter(p => p.type === 'text').map(p => p.text).join(m.role === 'system' ? '\n' : '')), 0);
}

/** Model view only. A range replaces a duplicate excerpt, never an original.
 * Selection IDs, complete source text, scope/version metadata and aliases stay
 * intact. Unrecognized fields are not assumed to be disposable copy hints. */
export function compactSynthesisMessages(messages: ModelMessage[]): ModelMessage[] {
  if (synthesisTextBytes(messages) <= agentModelLimits.maxTextBytes) return messages;
  const packets = messages.map(m => {
    if (m.role !== 'tool') return null;
    try { const p = JSON.parse(m.content); return Array.isArray(p?.synthesisSources) ? p as Packet : null; }
    catch { return null; }
  });
  const sources = new Map<string, SynthesisSource>();
  for (const p of packets) for (const s of p?.synthesisSources || []) sources.set(s.sourceId, s);
  for (const p of packets) if (Array.isArray(p?.sourceAliases)) for (const alias of p.sourceAliases) {
    const source = sources.get(alias.canonicalSourceId);
    if (source) sources.set(alias.sourceId, source);
  }
  return messages.map((message, index) => {
    const packet = packets[index];
    if (!packet || message.role !== 'tool') return message;
    const projected: Packet = { ...packet };
    delete projected.answerContext; delete projected.instructions;
    projected.synthesisSources = packet.synthesisSources.map(source => {
      if (!source.citationQuotes?.every(q => source.text.includes(q))) return source;
      const copy = { ...source }; delete copy.citationQuotes; return copy;
    });
    if (Array.isArray(packet.evidence)) projected.evidence = packet.evidence.map(e => {
      if (!e || typeof e !== 'object' || Object.keys(e).some(k => !['sourceId', 'text', 'selectionId'].includes(k))
        || typeof e.sourceId !== 'string' || typeof e.text !== 'string' || !e.text.trim()
        || typeof e.selectionId !== 'string' || !/^E\d+$/.test(e.selectionId)) return e;
      const source = sources.get('K' + e.sourceId);
      const start = source?.kind === 'knowledge' ? source.text.indexOf(e.text) : -1;
      if (start < 0) return e;
      return { sourceId: e.sourceId, selectionId: e.selectionId, textRange: [start, start + e.text.length] };
    });
    return { ...message, content: JSON.stringify(projected) };
  });
}
