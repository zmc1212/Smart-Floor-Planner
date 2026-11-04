import { fail, fingerprint } from '@/lib/assistant/contracts';
import type { ModelTool } from '@/lib/assistant/contracts/model';
import { resolveCatalogCitation, sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import type { SynthesisAnswer } from '@/lib/assistant/agent/synthesis';
import type { ComposedProject } from './report-composition';

type Project = Pick<ComposedProject, 'context'>;
const key = (index: number, field: 'guidance' | 'standard') => `P${index + 1}_${field}`;
const knowledge = (project: Project) => project.context.sources.filter(source => source.kind === 'knowledge');
export function reportGuidanceStandardSources(project: Project, preferOriginal: boolean) {
  const sources = knowledge(project);
  if (!preferOriginal) return sources;
  const eligible = sources.filter(source => source.evidence?.professional?.applicability.status !== 'not_applicable'
    && sourceCitationCatalog(source).length);
  const originals = eligible.filter(source => source.evidence?.file);
  return originals.length ? originals : eligible;
}
const section = (text: string, basis: 'advice' | 'uncertainty' = 'uncertainty'): SynthesisAnswer =>
  ({ kind: 'synthesis', segments: [{ basis, text, citations: [] }] });

type GuidanceChoice = { id: string; text: string; citation?: { sourceId: string; quote: string } };
export function reportGuidanceChoices(project: Pick<ComposedProject, 'selection' | 'context'>, items: string[]): GuidanceChoice[] {
  const source = project.context.sources.find(s => s.kind === 'project');
  const choices = items.filter(text => text.trim().length >= 4 && text.length <= 400 && source?.text.includes(text))
    .map(text => ({ id: 'T' + fingerprint({ selection: project.selection, text }).slice(0, 16), text,
      citation: { sourceId: source!.sourceId, quote: text } }));
  return choices.length ? choices : [{ id: 'review_original', text: items.length
    ? '请按本项目的待核对记录逐项确认。' : '如需补充待核对事项，请先向现场团队核实。' }];
}

export function reportGuidanceFinalTool(projects: Project[], choices?: GuidanceChoice[][], preferOriginal = false): ModelTool {
  const properties: Record<string, unknown> = {};
  const required = projects.map((project, index) => {
    const guidance = key(index, 'guidance');
    properties[guidance] = choices ? { type: 'string', enum: choices[index].map(choice => choice.id) }
      : { type: 'string', minLength: 2, maxLength: 1200 };
    const standardIds = reportGuidanceStandardSources(project, preferOriginal).flatMap(sourceCitationCatalog).map(c => c.citationId);
    if (standardIds.length) properties[key(index, 'standard')] = { type: 'string', enum: [...new Set(standardIds)] };
    return guidance;
  });
  return { name: 'final_response', description: choices ? '只提交各项目的核对项编号和可选工艺引用编号。'
    : '只提交各项目给收件人的待核对建议和可选工艺引用编号。',
    parameters: { type: 'object', additionalProperties: false, required, properties } };
}

/** Project and arrangement facts remain in the authorized report snapshot.
 * Only validated guidance and an exact catalog reference reach body parsing. */
export function projectReportGuidanceOnly(raw: string, projects: Project[], choices?: GuidanceChoice[][], preferOriginal = false) {
  const value = JSON.parse(raw) as Record<string, string>;
  return JSON.stringify(Object.fromEntries(projects.map((project, index) => {
    const id = value[key(index, 'standard')];
    const sources = reportGuidanceStandardSources(project, preferOriginal);
    // Preserve retrieval order. An omitted selection may still display the
    // first exact, file-backed reference without asserting site applicability.
    const selected = id ?? (preferOriginal && sources[0]?.evidence?.file ? sourceCitationCatalog(sources[0])[0]?.citationId : undefined);
    const citation = selected ? resolveCatalogCitation({ citationId: selected }, sources) : null;
    if (id && !citation) fail('invalid_model_citation', 502);
    const guidance = value[key(index, 'guidance')];
    const choice = choices?.[index].find(item => item.id === guidance);
    if (choices && !choice) fail('invalid_model_citation', 502);
    const pending = choice?.citation
      ? { kind: 'synthesis', segments: [{ basis: 'advice', text: '请优先核对原记录中的这一项：“' + choice.text + '”。', citations: [choice.citation] }] }
      : section(choice?.text ?? guidance, 'advice');
    return ['P' + (index + 1), {
      progress: section('进展以本份报告的原记录为准。'),
      pending,
      standards: citation ? { kind: 'synthesis', segments: [{ basis: 'evidence', text: citation.quote, citations: [citation] }] }
        : section('本次没有选用工艺原文。'),
      arrangements: section('安排以本份报告中已确认的原记录为准。'),
    }];
  })));
}
