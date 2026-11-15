import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows, one } from '@/db/repositories/assistant-repository';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { enterpriseKnowledgeEnabled } from '@/lib/assistant/knowledge-policy';
import type { ActorContext } from '@/lib/assistant/contracts';
import { answerStageQuestion, unresolvedProjectAnswer, type EnterpriseKnowledgeItem, type StageAnswer } from './stage-answer';
import { isStageKnowledgeQuestion } from './stage-router';

/** Retained for existing callers/tests. Only an ordinary stage knowledge turn
 * may use the deterministic pack; status/progress/reminder/todo turns keep
 * their existing fact/model route. */
export function isStageChatQuestion(question: string) {
  return isStageKnowledgeQuestion(question);
}

type ProjectRow = { id: string; name: string; current_stage_key: string | null; customer_user_id: string };

const projectColumns = sql`p.id,p.name,p.current_stage_key,l.customer_user_id`;

async function linkedProjects(tx: PostgresTransaction, eid: string, conversationId: string, userId: string) {
  return rows<ProjectRow>(tx, sql`select ${projectColumns} from app.construction_links cl
    join app.construction_projects p on p.enterprise_id=cl.enterprise_id and p.id=cl.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where cl.enterprise_id=${eid} and cl.conversation_id=${conversationId} and p.status<>'archived' and l.archived_at is null
    and p.customer_access and l.customer_user_id=${userId} order by p.id`);
}
async function boundProjects(tx: PostgresTransaction, eid: string, userId: string) {
  return rows<ProjectRow>(tx, sql`select ${projectColumns} from app.construction_followup_bindings b
    join app.construction_projects p on p.enterprise_id=b.enterprise_id and p.id=b.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where b.enterprise_id=${eid} and b.principal_key=${'user:' + userId} and b.audience='customer'
    and b.status='enabled' and p.status<>'archived' and l.archived_at is null
    and p.customer_access and l.customer_user_id=${userId} order by b.id desc`);
}
async function accessibleProjects(tx: PostgresTransaction, eid: string, userId: string) {
  return rows<ProjectRow>(tx, sql`select ${projectColumns}
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.status='active' and l.archived_at is null and p.customer_access
    and l.customer_user_id=${userId} order by p.id`);
}

export type StageProjectResolution =
  | { status: 'resolved'; project: ProjectRow }
  | { status: 'ambiguous'; projects: ProjectRow[] }
  | { status: 'none' };

/** The original conversation link wins, then the customer follow-up binding,
 * then a single accessible project. More than one candidate is reported as
 * ambiguous and never guessed. */
export async function resolveStageProject(tx: PostgresTransaction, eid: string, conversationId: string, userId: string): Promise<StageProjectResolution> {
  for (const read of [() => linkedProjects(tx, eid, conversationId, userId), () => boundProjects(tx, eid, userId)]) {
    const projects = await read();
    if (projects.length === 1) return { status: 'resolved', project: projects[0] };
    if (projects.length > 1) return { status: 'ambiguous', projects };
  }
  const projects = await accessibleProjects(tx, eid, userId);
  if (projects.length === 1) return { status: 'resolved', project: projects[0] };
  return projects.length ? { status: 'ambiguous', projects } : { status: 'none' };
}

/** Retained for pilot-readiness callers that only need a unique project. */
export async function stageProjectForConversation(tx: PostgresTransaction, eid: string, conversationId: string, userId: string) {
  const resolution = await resolveStageProject(tx, eid, conversationId, userId);
  return resolution.status === 'resolved' ? resolution.project : null;
}

export function composeStageChatAnswer(answer: StageAnswer) {
  const lines = [answer.answer];
  if (answer.citations.length) {
    lines.push('', '参考：');
    for (const citation of answer.citations.slice(0, 3)) lines.push('· ' + citation.title + '：' + citation.quote);
  }
  lines.push('', '这是小K按当前装修阶段的通用知识说明，不替代企业书面标准、正式图纸和现场验收。');
  return lines.join('\n');
}

export type StageEnterpriseKnowledge = {
  items: EnterpriseKnowledgeItem[];
  status: 'not_configured' | 'available' | 'unavailable';
};

/** Existing enterprise knowledge is quoted with its real source title. No
 * configured corpus is labelled general knowledge; a failed read is marked
 * unavailable instead of pretending the standard was checked. */
async function configuredEnterpriseKnowledge(input: {
  tx: PostgresTransaction; actor?: ActorContext; conversationId: string; knowledgeEpoch?: number;
  question: string;
}): Promise<StageEnterpriseKnowledge> {
  if (!input.actor || input.knowledgeEpoch === undefined) return { items: [], status: 'not_configured' };
  const settings = await one(input.tx, sql`select agent_config from app.assistant_enterprise_settings
    where enterprise_id=${input.actor.enterpriseId} for share`);
  if (!settings || !enterpriseKnowledgeEnabled(settings.agent_config)) return { items: [], status: 'not_configured' };
  try {
    const retrieved = await retrieveKnowledge(input.conversationId, input.actor, input.question, input.knowledgeEpoch,
      undefined, undefined, 'document_coverage', { mode: 'keyword', topK: 3 }, input.tx);
    const items = retrieved.evidence.filter(item => item.knowledge)
      .map(item => ({ sourceId: item.ref.id, title: item.knowledge!.title,
        quote: Array.from(item.text).slice(0, 220).join('') }));
    return { items, status: items.length ? 'available' : 'not_configured' };
  } catch {
    return { items: [], status: 'unavailable' };
  }
}

/** Answer one C01 turn from the current project stage. Returns null when this
 * turn must stay on the existing specialist/model/fact route. */
export async function stageChatForConversation(input: {
  tx: PostgresTransaction; enterpriseId: string; conversationId: string; userId: string;
  actor?: ActorContext; knowledgeEpoch?: number; question: string;
  enterpriseKnowledge?: (input: { question: string }) => Promise<StageEnterpriseKnowledge>;
}) {
  if (!isStageChatQuestion(input.question)) return null;
  const resolution = await resolveStageProject(input.tx, input.enterpriseId, input.conversationId, input.userId);
  if (resolution.status !== 'resolved') {
    return composeStageChatAnswer(unresolvedProjectAnswer(resolution.status,
      resolution.status === 'ambiguous' ? resolution.projects.map(project => String(project.name)) : []));
  }
  const project = resolution.project;
  const enterprise = input.enterpriseKnowledge
    ? await input.enterpriseKnowledge({ question: input.question })
    : await configuredEnterpriseKnowledge({ tx: input.tx, actor: input.actor, conversationId: input.conversationId,
      knowledgeEpoch: input.knowledgeEpoch, question: input.question });
  const answer = answerStageQuestion({ constructionStageKey: project.current_stage_key as string | null,
    question: input.question, audience: 'owner', enterpriseKnowledge: enterprise.items,
    enterpriseKnowledgeStatus: enterprise.status });
  if (answer.handoff) return null;
  return composeStageChatAnswer(answer);
}
