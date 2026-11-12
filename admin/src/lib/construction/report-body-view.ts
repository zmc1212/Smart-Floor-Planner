import type { PostgresTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import type { ActorContext, Evidence } from '@/lib/assistant/contracts';
import { synthesisContextAvailable } from '@/lib/assistant/agent/synthesis-sources';
import { reportContextProtocol } from './report-reference';
import { reportCompositionProtocol, reportSectionKinds, type ReportBody } from './report-composition';
import { attachReportProjectCitations, noVerifiedCitationText, rejectedCitationText, serverSectionText, verifyReportCitation } from './report-citations';
import type { ReportFacts } from './report-scope';
import { citationProjection } from '@/lib/assistant/knowledge/sources';
import { evidenceOriginal } from '@/lib/assistant/knowledge/file-service';
import { fail } from '@/lib/assistant/contracts';
import { generalReportAdviceProtocol } from './report-general-advice';

type ReportOriginal = { sourceId: string; title: string; quote: string; location: Evidence['file'] | null };
function projectConversation(conversation: Row, selection: ReportBody['projects'][number]['selection']) {
  return { ...conversation, entry_snapshot: { ...conversation.entry_snapshot as Row,
    reportContext: { protocol: reportContextProtocol, revision: 0, selection } } };
}

/** Revalidate all consulted originals per project, not just cited snippets.
 * Return a display projection; private Evidence/contexts never go to the client. */
export async function reportBodyView(tx: PostgresTransaction, actor: ActorContext, conversation: Row, facts: ReportFacts, body: ReportBody | null) {
  if (body?.protocol !== reportCompositionProtocol || !Array.isArray(body.projects)) return [];
  const result = [];
  for (const p of body.projects) {
    const factsProject = facts.projects.find(f => f.id === p.projectId);
    if (!factsProject) continue;
    const c = projectConversation(conversation, p.selection);
    if (!await synthesisContextAvailable(tx, actor, c, p.context)) continue;
    const project = { projectId: p.projectId, selection: p.selection, context: p.context, facts: factsProject };
    // Older knowledge-off bodies stored no citations. Fill only the exact
    // server-written sentences from the current facts; never rewrite prose.
    const bodyProject = { ...p, sections: Object.fromEntries(reportSectionKinds.map(kind => [kind, {
      kind: p.sections[kind].kind, segments: p.sections[kind].segments.map(segment => ({ ...segment, citations: [...segment.citations] })),
    }])) } as ReportBody['projects'][number];
    attachReportProjectCitations(bodyProject, project);
    const sections = Object.fromEntries(reportSectionKinds.filter(kind => kind !== 'standards').map(kind => [kind,
      bodyProject.sections[kind].segments.map((s, i) => {
        const citations = s.citations.flatMap(citation => {
          const original = verifyReportCitation(project, citation);
          if (original === undefined) return [];
          const source = p.context.sources.find(candidate => candidate.sourceId === citation.sourceId)!;
          return [{ sourceId: source.sourceId, title: source.title, quote: citation.quote,
            location: source.evidence?.file || null, original }];
        });
        const rejected = citations.length !== s.citations.length;
        const noSource = !citations.length && s.text === serverSectionText[kind as keyof typeof serverSectionText];
        const labels = [...new Set(citations.map(citation => citation.original?.kind === 'record'
          ? `${citation.title} · 记录${citation.original.id}（版本${citation.original.version}）`
          : citation.location ? `${citation.title} · ${citation.location.label}` : citation.title))];
        return { key: `${kind}:${i}`, basis: s.basis, citationStatus: rejected ? 'rejected' : citations.length ? 'verified' : 'none',
          text: (s.basis === 'advice' ? '建议：' : s.basis === 'uncertainty' ? '待核实：' : '')
            + s.text + (labels.length ? '\n来源：' + labels.join('；') : '')
            + (rejected ? '\n' + rejectedCitationText : noSource ? '\n' + noVerifiedCitationText : ''), citations };
      })]));
    const originals = new Map<string, ReportOriginal>();
    for (const segment of p.sections.standards.segments) for (const citation of segment.citations) {
      const source = p.context.sources.find(s => s.sourceId === citation.sourceId && s.kind === 'knowledge' && s.evidence);
      if (source?.evidence && source.text.includes(citation.quote)) {
        originals.set(JSON.stringify([citation.sourceId, citation.quote]), { ...citation, title: source.title, location: source.evidence.file || null });
      }
    }
    const displayOriginal = (citation: ReportOriginal, index: number, stage?: string) => ({
      key: `standards:${index}`, basis: 'evidence', citations: [citation],
      text: (stage ? stage + ' · ' : '') + citation.quote + '\n来源：' + citation.title + (citation.location ? ` · ${citation.location.label}` : ''),
    });
    const standards = body.generalAdvice === generalReportAdviceProtocol && !p.context.knowledge.length
      ? p.sections.standards.segments.filter(s => s.basis === 'advice' && !s.citations.length).map((s, index) => ({
        key: `standards:${index}`, basis: 'advice', citations: [] as ReportOriginal[], text: '通用建议（模型知识）：' + s.text,
      })) : p.weekWorkmanship ? p.weekWorkmanship.stages.map((stage, index) => {
      const citation = [...originals.values()].find(original => original.sourceId === stage.sourceId);
      return citation ? displayOriginal(citation, index, stage.name)
        : { key: `standards:${index}`, basis: 'uncertainty', citations: [], text: stage.name + ' · 本次没有可引用的企业工艺依据。' };
    }) : [...originals.values()].map((citation, index) => displayOriginal(citation, index));
    if (p.weekWorkmanship?.truncated) standards.push({ key: 'standards:truncated', basis: 'uncertainty', citations: [], text: '阶段记录较多，本份简报未覆盖全部阶段的工艺依据。' });
    const cited = new Set(standards.flatMap(segment => segment.citations.map(c => c.sourceId)));
    const knowledgeSources = p.context.sources.filter(s => s.kind === 'knowledge' && s.evidence && cited.has(s.sourceId))
      .map(s => ({ sourceId: s.sourceId, title: s.title }));
    const reviewed = body.guidanceReviewed === 'pending' ? sections.pending : body.guidanceReviewed === true ? sections.arrangements : [];
    const guidance = reviewed.filter(s => s.basis === 'advice').map(s => ({ ...s, key: `guidance:${s.key}` }));
    result.push({ projectId: p.projectId, ...sections, standards, knowledgeSources, guidance });
  }
  return result;
}

/** Only a cited entry in this saved project catalog can resolve to an original.
 * The caller has already revalidated the recipient/report generation and facts. */
export async function reportKnowledgeSource(tx: PostgresTransaction, actor: ActorContext, conversation: Row, body: ReportBody,
  projectId: string, sourceId: string, original = false) {
  const p = body?.protocol === reportCompositionProtocol ? body.projects.find(p => p.projectId === projectId) : undefined;
  const source = p && p.context.sources.find(s => s.sourceId === sourceId && s.kind === 'knowledge' && s.evidence);
  const quotes = p ? [...new Set(reportSectionKinds.flatMap(kind => p.sections[kind].segments
    .flatMap(s => s.citations.filter(c => c.sourceId === sourceId).map(c => c.quote))))] : [];
  if (!p || !source?.evidence || !quotes.length) fail('assistant_resource_not_found', 404);
  const c = projectConversation(conversation, p.selection);
  if (!await synthesisContextAvailable(tx, actor, c, p.context)) fail('assistant_resource_not_found', 404);
  const e = source.evidence, file = await evidenceOriginal(tx, actor, c, e, original);
  if (original) { if (!file) fail('assistant_resource_not_found', 404); return file; }
  const citation = await citationProjection(tx, actor, c, { id: sourceId, chunk_id: e.ref.id, resource_type: e.ref.type,
    document_version_id: e.ref.version, source_hash: e.hash, quote_snapshot: quotes.join('\n'), locator: { synthesis: true }, is_draft: false });
  return { ...citation, originalAvailable: Boolean(file) };
}
