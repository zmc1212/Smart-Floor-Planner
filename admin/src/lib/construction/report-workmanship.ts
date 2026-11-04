import type { Evidence } from '@/lib/assistant/contracts';
import type { KnowledgeContext, ReportWorkmanshipStage } from '@/lib/assistant/contracts/professional';
import type { ReportProject } from './report-scope';
import { defaultConstructionStages } from './stages';

export const reportWorkmanshipProtocol = 'weekly-stage-workmanship-v1';
export const reminderWorkmanshipProtocol = 'reminder-stage-workmanship-v1';
const stageLimit = 4;
const defaultNames = new Map(defaultConstructionStages.map(({ key, name }) => [key, name]));
const standardHeadings = new Map([
  ['demolition', ['拆除', '拆改']], ['utilities', ['水电']], ['masonry_carpentry', ['泥木', '瓦工', '木工']],
]);

/** The stage history is a recorded-time boundary, independent of today's project stage. */
export function reportWorkmanshipStages(project: ReportProject) {
  const stages = new Map<string, ReportWorkmanshipStage>();
  const remember = (stage: ReportWorkmanshipStage) => {
    stages.delete(stage.key);
    stages.set(stage.key, stage);
  };
  if (project.weekOpeningStage) remember(project.weekOpeningStage);
  for (const event of project.stageEvents) remember({ key: event.stageKey, revision: event.revision });
  if (project.stageKey) remember({ key: project.stageKey, revision: project.progressRevision });
  return { stages: [...stages.values()].slice(-stageLimit), truncated: project.stageEventsTruncated || stages.size > stageLimit };
}

export function reportWorkmanshipName(stage: ReportWorkmanshipStage, project: ReportProject) {
  const configured = project.weekStageNames?.[stage.key] ?? (stage.key === project.stageKey ? project.reminderStageName : undefined);
  return typeof configured === 'string' ? configured : defaultNames.get(stage.key) || stage.key;
}

export function reportWorkmanshipQuery(stage: ReportWorkmanshipStage, project: ReportProject, kind: 'weekly' | 'stage' = 'weekly') {
  const name = reportWorkmanshipName(stage, project);
  const waterproof = kind === 'weekly' && stage.key === 'masonry_carpentry' && project.records.some(record =>
    record.publishedStageKey === stage.key && ['title', 'completed', 'pending', 'coordination', 'note'].some(field => String(record.data[field] || '').includes('防水')));
  return { query: `施工${kind === 'weekly' ? '周报' : '阶段提醒'} ${name}${waterproof ? ' 防水' : ''} 工艺标准 操作核对 验收注意事项`, waterproof };
}

/** A search hit alone cannot prove that a standard belongs to a stage. Use an
 * explicit published condition or a heading that names the actual work. */
export function reportWorkmanshipMatches(source: Evidence, stage: ReportWorkmanshipStage, name: string, waterproof: boolean) {
  const professional = source.professional;
  if (professional && (professional.entry.kind !== 'construction' || professional.applicability.status === 'not_applicable')) return false;
  const heading = /^([^：:\r\n]{1,32})(?:施工|工艺)标准[：:]/u.exec(source.text.trim())?.[1];
  const classified = !!professional?.entry.conditions.some(c => c.field === 'stage' && c.operator === 'in' && c.values.includes(stage.key));
  const waterproofTopic = !!professional?.entry.topics.includes('防水');
  if (waterproof) return heading === '防水' || classified && waterproofTopic;
  if (stage.key === 'masonry_carpentry' && (heading === '防水' || waterproofTopic)) return false;
  return classified || !!heading && [name, ...(standardHeadings.get(stage.key) || [])].includes(heading);
}

export function reminderWorkmanshipStage(project: ReportProject): ReportWorkmanshipStage | undefined {
  const [event] = project.stageEvents;
  if (event?.stageKey && project.stageEvents.length === 1 && project.stageKey === event.stageKey && project.progressRevision === event.revision)
    return { key: event.stageKey, revision: event.revision };
}

export function reportWorkmanshipKnowledgeContext(project: ReportProject, leadId: string, stage: ReportWorkmanshipStage, kind: 'weekly' | 'stage' = 'weekly'): KnowledgeContext | undefined {
  const stages = kind === 'weekly' ? reportWorkmanshipStages(project).stages : [reminderWorkmanshipStage(project)];
  if (!stages.some(candidate => candidate?.key === stage.key && candidate.revision === stage.revision)) return;
  return { leadId, projectId: project.id, stage: stage.key, revision: stage.revision };
}
