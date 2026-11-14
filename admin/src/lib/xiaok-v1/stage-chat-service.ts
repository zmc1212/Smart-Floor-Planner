import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { answerStageQuestion, type StageAnswer } from './stage-answer';

const stageQuestion = /阶段|需要注意|注意什么|准备什么|要准备|材料|工艺|施工|水电|泥木|油漆|安装|软装|入住|完工|拆改|防水|点位|验收|进度|提醒|周报|现场记录|拍照/u;

/** Only an ordinary stage question enters the deterministic pack. Deep
 * professional topics keep the existing specialist/model route. */
export function isStageChatQuestion(question: string) {
  return stageQuestion.test(question);
}

async function linkedProject(tx: PostgresTransaction, eid: string, conversationId: string, userId: string) {
  const projects = await rows(tx, sql`select p.id,p.name,p.current_stage_key,l.customer_user_id from app.construction_links cl
    join app.construction_projects p on p.enterprise_id=cl.enterprise_id and p.id=cl.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where cl.enterprise_id=${eid} and cl.conversation_id=${conversationId} and p.status<>'archived' and l.archived_at is null
    and p.customer_access and l.customer_user_id=${userId} order by p.id limit 2`);
  return projects.length === 1 ? projects[0] : null;
}

async function boundProject(tx: PostgresTransaction, eid: string, userId: string) {
  const projects = await rows(tx, sql`select p.id,p.name,p.current_stage_key,l.customer_user_id from app.construction_followup_bindings b
    join app.construction_projects p on p.enterprise_id=b.enterprise_id and p.id=b.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where b.enterprise_id=${eid} and b.principal_key=${'user:' + userId} and b.audience='customer'
    and b.status='enabled' and p.status<>'archived' and l.archived_at is null
    and p.customer_access and l.customer_user_id=${userId} order by b.id desc limit 2`);
  return projects.length === 1 ? projects[0] : null;
}

async function onlyAccessibleProject(tx: PostgresTransaction, eid: string, userId: string) {
  const projects = await rows(tx, sql`select p.id,p.name,p.current_stage_key,l.customer_user_id
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.status='active' and l.archived_at is null and p.customer_access
    and l.customer_user_id=${userId} order by p.id limit 2`);
  return projects.length === 1 ? projects[0] : null;
}

/** Resolve the project from the original conversation, then the customer
 * binding, then the single accessible project. Ambiguity is never guessed. */
export async function stageProjectForConversation(tx: PostgresTransaction, eid: string, conversationId: string, userId: string) {
  return await linkedProject(tx, eid, conversationId, userId)
    || await boundProject(tx, eid, userId)
    || await onlyAccessibleProject(tx, eid, userId);
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

/** Answer one C01 turn from the current project stage. Returns null when this
 * turn must stay on the existing model/specialist route. */
export async function stageChatForConversation(input: {
  tx: PostgresTransaction; enterpriseId: string; conversationId: string; userId: string; question: string;
}) {
  if (!isStageChatQuestion(input.question)) return null;
  const project = await stageProjectForConversation(input.tx, input.enterpriseId, input.conversationId, input.userId);
  if (!project) return null;
  const answer = answerStageQuestion({ constructionStageKey: project.current_stage_key as string | null,
    question: input.question, audience: 'owner' });
  if (answer.handoff) return null;
  return composeStageChatAnswer(answer);
}
