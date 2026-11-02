import type { PostgresTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import type { ActorContext } from '@/lib/assistant/contracts';
import { synthesisContextAvailable } from '@/lib/assistant/agent/synthesis-sources';
import { reportContextProtocol } from './report-reference';
import { reportCompositionProtocol, reportSectionKinds, type ReportBody } from './report-composition';
import type { ReportFacts } from './report-scope';

/** Revalidate all consulted originals per project, not just cited snippets.
 * Return a display projection; private Evidence/contexts never go to the client. */
export async function reportBodyView(tx: PostgresTransaction, actor: ActorContext, conversation: Row, facts: ReportFacts, body: ReportBody | null) {
  if (body?.protocol !== reportCompositionProtocol || !Array.isArray(body.projects)) return [];
  const result = [];
  for (const p of body.projects) {
    if (!facts.projects.some(f => f.id === p.projectId)) continue;
    const c = { ...conversation, entry_snapshot: { ...conversation.entry_snapshot as Row,
      reportContext: { protocol: reportContextProtocol, revision: 0, selection: p.selection } } };
    if (!await synthesisContextAvailable(tx, actor, c, p.context)) continue;
    const sections = Object.fromEntries(reportSectionKinds.map(kind => [kind, p.sections[kind].segments.map((s, i) => {
      const citations = s.citations.map(citation => {
        const source = p.context.sources.find(source => source.sourceId === citation.sourceId)!;
        return { sourceId: source.sourceId, title: source.title, quote: citation.quote, location: source.evidence?.file || null };
      });
      const labels = [...new Set(citations.map(c => c.location ? `${c.title} · ${c.location.label}` : c.title))];
      return { key: `${kind}:${i}`, basis: s.basis, text: (s.basis === 'advice' ? '建议：' : s.basis === 'uncertainty' ? '待核实：' : '')
        + s.text + (labels.length ? '\n来源：' + labels.join('；') : ''), citations };
    })]));
    result.push({ projectId: p.projectId, ...sections });
  }
  return result;
}
