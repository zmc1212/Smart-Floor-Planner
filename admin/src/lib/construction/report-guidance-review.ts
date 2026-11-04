import { fail, fingerprint } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTool, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { prepareSourceAnswerReview } from '@/lib/assistant/agent/knowledge-explanation';
import { assertReportAnswerReview } from '@/lib/assistant/agent/report-answer-review';
import { sourceQuestionCoverageProtocol } from '@/lib/assistant/agent/source-question-plan';
import { toolSchemaIssue } from '@/lib/assistant/agent/tool-protocol';
import { reportGuidanceReviewProtocol } from '@/lib/assistant/agent/report-native-final';
import { reportLocalTime } from '@/lib/assistant/agent/report-time';
import type { ReportBody } from './report-composition';
import type { FollowupAudience, ReportProject } from './report-scope';
import type { ReportReference } from './report-reference';

/** Keep the published coordination record in the report. The homeowner's
 * guidance task receives the published pending field separately. */
export function reportGuidanceProject(project: ReportProject, audience: FollowupAudience): ReportProject {
  if (audience !== 'customer') return project;
  return { ...project, records: project.records.map(record => ({ ...record, data: { ...record.data, coordination: '' } })),
    publishedRecordItems: project.publishedRecordItems?.filter(item => item.pending).map(item => ({ ...item, coordination: '' })) };
}

/** Project progress, stage events and confirmed arrangements are rendered
 * from the original report. None is needed to phrase a check of pending work. */
export function reportGuidanceItems(project: ReportProject, audience: FollowupAudience, openOnly = false) {
  const pending = (project.publishedRecordItems ?? project.records.map(r => ({
    room: r.room, pending: String(r.data.pending || ''), coordination: String(r.data.coordination || ''),
  }))).flatMap(r => (audience === 'customer' ? [r.pending] : [r.pending, r.coordination])
    .filter(text => text.trim()).map(text => r.room ? `${r.room}：${text}` : text));
  const issues = audience === 'customer' ? [] : (project.issues || [])
    .filter(issue => !openOnly || !['cancelled', 'resolved', 'closed'].includes(issue.status)).map(issue => issue.text);
  return [...new Set([...pending, ...issues])];
}

export function reportGuidanceFactText(selection: ReportReference, project: ReportProject, audience: FollowupAudience) {
  const items = reportGuidanceItems(project, audience);
  return `报告所选项目：${project.name}。报告事实截止：${reportLocalTime(selection.cutoffAt)}。\n`
    + (items.length ? items.join('\n') : '本期没有可见的待核对记录。')
    + (project.recordsTruncated || project.publishedRecordItemsTruncated || project.issuesTruncated ? '\n本次未覆盖全部待核对记录。' : '');
}

const audienceFocus: Record<FollowupAudience, string> = {
  customer: '聚焦业主本人需要核对的事项。',
  worker: '聚焦现场需要核对或交接的事项。',
  designer: '聚焦设计端需要核对的点位和条件。',
  boss: '分别说明各工地值得优先协调的事项。',
};

export function prepareReportGuidanceReview(body: ReportBody, audience: FollowupAudience, section: 'pending' | 'arrangements' = 'arrangements') {
  const focus = audienceFocus[audience];
  if (!focus || !body.projects.length) fail('context_changed');
  const currentQuestion = focus + '提供一条适合当前受众、基于这份报告的待核对建议。有具体待核对事项时优先说明具体事项。'
    + '只有没有足够原始信息时才说明缺少什么并建议向现场团队核实。保留对象和原条件，避免新增已安装、已完成、排期、批准或验收的事实。';
  const drafts = body.projects.map((project, i) => {
    const segments = project.sections[section].segments.filter(s => s.basis === 'advice');
    if (segments.length !== 1) fail('incomplete_model_answer', 502);
    const answer = { kind: 'synthesis' as const, segments };
    const draft = prepareSourceAnswerReview(JSON.stringify({ selection: project.selection, answer }), answer, project.context.sources,
      { protocol: sourceQuestionCoverageProtocol, questions: [currentQuestion] }, { currentQuestion }, { Q1: segments }, [], reportGuidanceReviewProtocol);
    const parts = draft.reviewMessages[1].content as Extract<ModelMessage, { role: 'system' | 'user' }>['content'];
    const part = parts[0];
    if (part.type !== 'text') fail('context_changed');
    return { slot: 'P' + (i + 1), selection: project.selection, draft, packet: JSON.parse(part.text) };
  });
  const parts = drafts[0].draft.reviewMessages[0].content as Extract<ModelMessage, { role: 'system' | 'user' }>['content'];
  const instruction = parts[0];
  if (instruction.type !== 'text') fail('context_changed');
  const originalTool = drafts[0].draft.reviewTool;
  const properties = originalTool.parameters.properties as { checks: { properties: { Q1: unknown } } };
  const checks = { type: 'object', additionalProperties: false, required: drafts.map(d => d.slot),
    properties: Object.fromEntries(drafts.map(d => [d.slot, properties.checks.properties.Q1])) };
  const tool: ModelTool = { ...originalTool, parameters: { ...originalTool.parameters, properties: { ...properties, checks } } };
  const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: instruction.text
    + '当前任务为施工报告复核。逐项目核对，其他项目的资料不能支持本项目。questionsComplete表示全部项目均已检查。' }] },
  { role: 'user', content: [{ type: 'text', text: JSON.stringify({ audience, projects: Object.fromEntries(drafts.map(d =>
    [d.slot, { selection: d.selection, ...d.packet }])) }) }] }];
  return { drafts, tool, messages, binding: fingerprint({ audience, drafts: drafts.map(d => d.draft.binding) }) };
}

export async function assertReportGuidanceReview(review: ReturnType<typeof prepareReportGuidanceReview>, output: ModelTurnOutput) {
  if (output.finishReason !== 'stop' || output.toolCalls.length || await toolSchemaIssue(review.tool, output.text)) fail('native_schema_unverified', 502);
  const { questionsComplete, checks } = JSON.parse(output.text);
  for (const { slot, draft } of review.drafts) assertReportAnswerReview(draft,
    { ...output, text: JSON.stringify({ questionsComplete, checks: { Q1: checks[slot] } }) }, draft.binding);
}
