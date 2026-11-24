import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { citationWebSource } from '../agent/web-evidence';
import type { ActorContext } from '../contracts';

const retrievalPhases = {
  'knowledge.search.v1': 'enterprise_knowledge',
  'web.search.v1': 'public_search',
  'web.read.v1': 'public_read',
} as const;
type RetrievalPhase = (typeof retrievalPhases)[keyof typeof retrievalPhases];
type AnswerProcess = { elapsedSeconds: number; steps: RetrievalPhase[] };
type Citation = { id: string; available: boolean; title?: unknown; page?: number | null; knowledge?: { scope: string }; referenceCase?: boolean; locator?: unknown };

const replyPurpose = sql`r.purpose in ('reply', 'reply.regenerate')`;
const publicRetrieval = sql`s.kind='retrieval' and s.capability_name in ('knowledge.search.v1', 'web.search.v1', 'web.read.v1')`;
const phase = (name: unknown) => retrievalPhases[name as keyof typeof retrievalPhases];

export function showsAnswerProcess(actor: ActorContext, conversation: Row) {
  return actor.principal.kind === 'user' && conversation.purpose === 'customer_consultation'
    && !(conversation.entry_snapshot as Row)?.retentionRedacted;
}

/** Expose only a stage name for an observed in-flight retrieval. */
export async function answerProgress(tx: PostgresTransaction, actor: ActorContext, conversation: Row, run: Row) {
  if (!showsAnswerProcess(actor, conversation) || !['reply', 'reply.regenerate'].includes(String(run.purpose))) return {};
  if (run.status === 'queued') return { answerPhase: 'preparing' };
  if (run.status !== 'running') return {};
  const step = await one(tx, sql`select s.capability_name from app.assistant_run_steps s
    where s.enterprise_id=${actor.enterpriseId} and s.run_id=${String(run.id)} and s.status='running' and ${publicRetrieval}
    order by s.updated_at desc, s.step_seq desc limit 1`);
  return { answerPhase: phase(step?.capability_name) ?? 'writing' };
}

/** Batch the completed run projection for one authorized message window. */
export async function answerProcesses(tx: PostgresTransaction, enterpriseId: string, conversationId: string, messages: Row[]) {
  const result = new Map<string, AnswerProcess>();
  const ids = messages.filter(message => message.author_kind === 'assistant'
    && ['reply', 'agent.reply', 'reply.regenerate'].includes(String(message.purpose))).map(message => String(message.id));
  if (!ids.length) return result;
  const saved = await rows(tx, sql`select r.id::text as run_id, r.output_message_id::text as message_id,
      round(extract(epoch from r.completed_at - r.started_at)) as seconds, s.capability_name
    from app.assistant_runs r left join app.assistant_run_steps s
      on s.enterprise_id=r.enterprise_id and s.run_id=r.id and s.status='succeeded' and ${publicRetrieval}
    where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId} and r.status='succeeded'
      and ${replyPurpose} and r.started_at is not null and r.completed_at>=r.started_at
      and r.output_message_id in (${sql.join(ids.map(id => sql`${id}::bigint`), sql`, `)})
    order by r.id desc, s.created_at, s.step_seq`);
  const selected = new Map<string, string>();
  for (const row of saved) {
    const messageId = String(row.message_id), runId = String(row.run_id);
    const elapsedSeconds = Number(row.seconds);
    if (!Number.isSafeInteger(elapsedSeconds) || elapsedSeconds < 0) continue;
    if (!selected.has(messageId)) {
      selected.set(messageId, runId);
      result.set(messageId, { elapsedSeconds, steps: [] });
    }
    if (selected.get(messageId) !== runId) continue;
    const step = phase(row.capability_name), steps = result.get(messageId)!.steps;
    if (step && !steps.includes(step)) steps.push(step);
  }
  for (const process of result.values()) {
    if (process.steps.includes('public_read')) process.steps = process.steps.filter(step => step !== 'public_search');
  }
  return result;
}

/** Sources come from the same current projection that authorizes the reply. */
export function projectAnswerProcess(process: AnswerProcess, citations: Citation[]) {
  const sources = citations.flatMap(citation => {
    if (!citation.available || typeof citation.title !== 'string' || !citation.title) return [];
    const web = citationWebSource(citation);
    const site = web && URL.canParse(web.url) ? new URL(web.url).hostname : '';
    const knowledge = citation.knowledge?.scope;
    const label = citation.referenceCase ? '案例资料' : knowledge === 'platform' ? '平台资料'
      : knowledge === 'project' ? '项目资料' : '企业工艺';
    const page = citation.page && citation.page > 0 ? ` · 第 ${citation.page} 页` : '';
    return [{ id: citation.id, title: citation.title, kind: web ? 'web' : 'document',
      detail: web ? site || '公开资料' : label + page }];
  });
  return { elapsedSeconds: process.elapsedSeconds, steps: process.steps, sources };
}
