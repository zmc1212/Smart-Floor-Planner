import { fail } from '@/lib/assistant/contracts';
import type { ModelTool } from '@/lib/assistant/contracts/model';
import { resolveCatalogCitation, sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import type { SynthesisAnswer } from '@/lib/assistant/agent/synthesis';
import type { ComposedProject } from './report-composition';

type Project = Pick<ComposedProject, 'context'>;
const key = (index: number, field: 'guidance' | 'standard') => `P${index + 1}_${field}`;
const knowledge = (project: Project) => project.context.sources.filter(source => source.kind === 'knowledge');
const section = (text: string, basis: 'advice' | 'uncertainty' = 'uncertainty'): SynthesisAnswer =>
  ({ kind: 'synthesis', segments: [{ basis, text, citations: [] }] });

export function reportGuidanceFinalTool(projects: Project[]): ModelTool {
  const properties: Record<string, unknown> = {};
  const required = projects.map((project, index) => {
    const guidance = key(index, 'guidance');
    properties[guidance] = { type: 'string', minLength: 2, maxLength: 1200 };
    const standardIds = knowledge(project).flatMap(sourceCitationCatalog).map(c => c.citationId);
    if (standardIds.length) properties[key(index, 'standard')] = { type: 'string', enum: [...new Set(standardIds)] };
    return guidance;
  });
  return { name: 'final_response', description: '只提交各项目给收件人的待核对建议和可选工艺引用编号。',
    parameters: { type: 'object', additionalProperties: false, required, properties } };
}

/** Project and arrangement facts remain in the authorized report snapshot.
 * Only validated guidance and an exact catalog reference reach body parsing. */
export function projectReportGuidanceOnly(raw: string, projects: Project[]) {
  const value = JSON.parse(raw) as Record<string, string>;
  return JSON.stringify(Object.fromEntries(projects.map((project, index) => {
    const id = value[key(index, 'standard')];
    const citation = id ? resolveCatalogCitation({ citationId: id }, knowledge(project)) : null;
    if (id && !citation) fail('invalid_model_citation', 502);
    return ['P' + (index + 1), {
      progress: section('进展以本份报告的原记录为准。'),
      pending: section(value[key(index, 'guidance')], 'advice'),
      standards: citation ? { kind: 'synthesis', segments: [{ basis: 'evidence', text: citation.quote, citations: [citation] }] }
        : section('本次没有选用工艺原文。'),
      arrangements: section('安排以本份报告中已确认的原记录为准。'),
    }];
  })));
}
