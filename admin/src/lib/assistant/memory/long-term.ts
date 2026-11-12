
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { customerPlans } from '@/lib/construction/site-plans';
import { customerSiteResults } from '@/lib/construction/site-results';
import { availableNeedMemory } from '../agent/memory-sources';
import { hasExplicitNeedCorrection, type NeedFact } from '../agent/memory';
import { fail, fingerprint, safeText, type MessageContent } from '../contracts';
import type { PrivateMemoryScope } from './scope';

type Category = 'preference' | 'project_fact' | 'decision' | 'delegation';
type MemoryState = 'current' | 'candidate' | 'conflict' | 'superseded' | 'invalidated' | 'deleted';
type MemoryRef = { key: string; revision: number };
type Source = { messageId: string; content: unknown };
type Input = {
  category: Category;
  topic: string;
  room?: string;
  value: string;
  quote: string;
  explicit: boolean;
  correction?: MemoryRef;
  needField?: NeedFact['field'];
};
export type MemoryEntry = MemoryRef & {
  category: Category;
  topic: string;
  room: string;
  state: MemoryState;
  value: string;
  sourceMessageId: string;
  sourceConversationId: string;
};

const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
function dto(row: Row): MemoryEntry {
  return {
    key: String(row.memory_key), revision: Number(row.revision), category: row.category as Category,
    topic: String(row.topic), room: String(row.room), state: row.state as MemoryState, value: String(row.value),
    sourceMessageId: String(row.source_message_id), sourceConversationId: String(row.source_conversation_id),
  };
}
function scopeFilter(scope: PrivateMemoryScope) {
  return sql`(category='preference' and project_id is null and lead_id is null
    or lead_id is not distinct from ${scope.leadId}::bigint
      and (project_id is null or project_id=${scope.projectId}::bigint)
      and (category='preference' or ${!scope.ambiguous}))`;
}

async function sourceAvailable(tx: PostgresTransaction, scope: PrivateMemoryScope, row: Row) {
  const source = await one(tx, sql`select m.content,c.entry_snapshot from app.assistant_messages m
    join app.assistant_conversations c on c.enterprise_id=m.enterprise_id and c.id=m.conversation_id
    join app.assistant_participants p on p.enterprise_id=m.enterprise_id and p.conversation_id=m.conversation_id and p.user_id=m.user_id
    where m.enterprise_id=${scope.enterpriseId} and m.conversation_id=${String(row.source_conversation_id)}
    and m.id=${String(row.source_message_id)} and m.author_kind='user' and m.user_id=${scope.ownerId}
    and c.purpose='customer_consultation' and c.mode='ai' and c.status in ('open','archived') and p.status='active' and p.participant_role='owner'
    for share of m,p`);
  if (!source || fingerprint(source.content) !== row.source_hash || (source.entry_snapshot as Row)?.retentionRedacted) return false;
  if (!row.topic || !String(row.topic).startsWith('need/')) return true;
  const memory = await availableNeedMemory(tx, scope.enterpriseId, String(row.source_conversation_id), source.entry_snapshot);
  return memory.facts.some(fact => fact.sourceMessageId === String(row.source_message_id)
    && fact.field === String(row.topic).slice('need/'.length) && fact.room === row.room && fact.value === row.value);
}

async function sourceForWrite(tx: PostgresTransaction, scope: PrivateMemoryScope, messageId: string): Promise<Source> {
  const row = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${scope.enterpriseId}
    and conversation_id=${scope.conversationId} and id=${messageId} and author_kind='user' and user_id=${scope.ownerId} for share`);
  if (!row) fail('memory_source_unavailable', 404);
  return { messageId, content: row.content };
}

export class MemoryService {
  constructor(private readonly tx: PostgresTransaction, private readonly scope: PrivateMemoryScope) {}

  private async lock(key: string) {
    await this.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'assistant-memory:' + this.scope.enterpriseId + ':' + this.scope.ownerId + ':' + key},0))`);
  }

  private async versions(key: string) {
    return rows(this.tx, sql`select * from app.assistant_long_term_memories
      where enterprise_id=${this.scope.enterpriseId} and owner_id=${this.scope.ownerId} and memory_key=${key}
      and ${scopeFilter(this.scope)} order by revision desc limit 32`);
  }

  async remember(messageId: string, input: Input): Promise<MemoryEntry> {
    return this.write(await sourceForWrite(this.tx, this.scope, messageId), input);
  }

  private async write(source: Source, input: Input): Promise<MemoryEntry> {
    const { enterpriseId, ownerId, conversationId, leadId, projectId, ambiguous } = this.scope;
    const { category, correction } = input;
    const topic = input.topic.trim(), room = input.room?.trim() || '', value = input.value.trim();
    const quote = input.quote.trim(), original = safeText(source.content as MessageContent);
    if (!topic || topic.length > 80 || room.length > 80 || !value || value.length > 500 || !quote || !original.includes(quote)
      || (!input.needField && !quote.includes(value)) || (category !== 'preference' && (!leadId || ambiguous))
      || (!input.needField && topic.startsWith('need/'))) fail('memory_source_mismatch', 422);
    // Use the lead as the stable project key across the handoff from preconstruction.
    // An actual project id remains an additional visibility boundary.
    const scopeLead = category === 'preference' ? null : leadId;
    const scopeProject = category === 'preference' ? null : projectId;
    const key = correction?.key ?? fingerprint({ category, topic: normalize(topic), room: normalize(room), leadId: scopeLead, projectId: scopeProject });
    const operationKey = fingerprint({ key, messageId: source.messageId, value: normalize(value), correction });
    await this.lock(key);
    const existing = await this.versions(key), latest = existing[0];
    const replay = existing.find(item => item.operation_key === operationKey);
    if (replay) {
      if (replay.state === 'deleted') fail('memory_version_conflict');
      return dto(replay);
    }
    const active = existing.filter(item => ['current','conflict','candidate'].includes(String(item.state)));
    const explicitCorrection = Boolean(correction || input.needField && hasExplicitNeedCorrection(original));
    if (explicitCorrection && !input.needField && !/更正|纠正|改成|改为|不再|调整为|换成/u.test(quote)) fail('memory_correction_required', 422);
    if (correction && (!latest || Number(latest.revision) !== correction.revision || !active.length
      || latest.category !== category || latest.topic !== topic || latest.room !== room)) fail('memory_version_conflict');
    const duplicate = active.find(item => normalize(String(item.value)) === normalize(value));
    if (duplicate && !explicitCorrection && (duplicate.state !== 'candidate' || !input.explicit)
      && await sourceAvailable(this.tx, this.scope, duplicate)) return dto(duplicate);
    const current = active.some(item => item.state === 'current' || item.state === 'conflict');
    const state: MemoryState = !input.explicit ? 'candidate' : explicitCorrection || !current ? 'current' : 'conflict';
    if (state === 'current') {
      await this.tx.execute(sql`update app.assistant_long_term_memories set state='superseded'
        where enterprise_id=${enterpriseId} and owner_id=${ownerId} and memory_key=${key}
        and state in ('current','conflict','candidate')`);
    }
    const row = await one(this.tx, sql`insert into app.assistant_long_term_memories
      (enterprise_id,owner_id,memory_key,revision,project_id,lead_id,category,topic,room,state,value,
       source_conversation_id,source_message_id,source_hash,operation_key)
      values(${enterpriseId},${ownerId},${key},${Number(latest?.revision ?? 0) + 1},${scopeProject},${scopeLead},
        ${category},${topic},${room},${state},${value},${conversationId},${source.messageId},${fingerprint(source.content)},${operationKey})
      returning *`);
    return dto(row!);
  }

  async rememberNeeds(messageId: string, facts: readonly NeedFact[]) {
    if (!this.scope.leadId || this.scope.ambiguous) return;
    const source = await sourceForWrite(this.tx, this.scope, messageId);
    // Canonical requirements and their source-validation continue to live in
    // record_need. This index only selects their authorized cross-thread revisions.
    for (const fact of facts.filter(fact => fact.field !== 'budget').sort((a, b) => (a.room + a.field).localeCompare(b.room + b.field))) {
      await this.write(source, { category: 'project_fact', topic: 'need/' + fact.field, room: fact.room, value: fact.value,
        quote: fact.quote, explicit: true, needField: fact.field });
    }
  }

  async retire(ref: MemoryRef, action: 'invalidate' | 'delete', messageId: string, quote: string) {
    const original = safeText((await sourceForWrite(this.tx, this.scope, messageId)).content as MessageContent);
    const command = action === 'delete' ? /^(?:请|帮我|麻烦你)?\s*(?:删掉|删除|忘掉|忘记)/u
      : /^(?:请|帮我|麻烦你)?\s*(?:作废|别再沿用)/u;
    if (!quote || !original.includes(quote) || !command.test(quote) || /[？?]/u.test(original)) fail('memory_source_mismatch', 422);
    await this.lock(ref.key);
    const latest = (await this.versions(ref.key))[0];
    if (!latest || Number(latest.revision) !== ref.revision) fail('memory_version_conflict');
    const labels = [String(latest.topic).split('/')[0], String(latest.room), String(latest.value)].filter(Boolean);
    if (latest.state !== 'deleted' && !labels.some(label => label !== 'need' && quote.includes(label))) fail('memory_source_mismatch', 422);
    const state = action === 'delete' ? 'deleted' : 'invalidated';
    await this.tx.execute(sql`update app.assistant_long_term_memories set state=${state},value=case when ${action}='delete' then null else value end,
        topic=case when ${action}='delete' then '' else topic end,room=case when ${action}='delete' then '' else room end
      where enterprise_id=${this.scope.enterpriseId} and owner_id=${this.scope.ownerId} and memory_key=${ref.key} and state<>'deleted'
      and (${action}='delete' or state in ('candidate','current','conflict'))`);
    return { ...ref, state };
  }

  async retrieve(question: string, limit = 8, includeLocalNeeds = false) {
    const { enterpriseId, ownerId, conversationId } = this.scope;
    const query = normalize(question);
    const candidates = await rows(this.tx, sql`select * from app.assistant_long_term_memories
      where enterprise_id=${enterpriseId} and owner_id=${ownerId} and state in ('current','candidate','conflict')
      and (${includeLocalNeeds} or source_conversation_id<>${conversationId} or topic not like 'need/%')
      and ${scopeFilter(this.scope)} order by created_at desc,revision desc limit 100`);
    const keywords = query.match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu) ?? [];
    const tokens = new Set(keywords.flatMap(word => /\p{Script=Han}/u.test(word)
      ? Array.from({ length: Math.min(word.length - 1, 80) }, (_, i) => word.slice(i, i + 2)) : [word]));
    const recall = /记得|记过|记住|记录|更正|纠正|忘|删除|偏好|以前|之前|说过|上次|历史/u.test(question);
    const ranked = candidates.map(row => {
      const text = normalize([row.topic, row.room, row.value].join(' '));
      const score = (row.room && query.includes(normalize(String(row.room))) ? 8 : 0)
        + [...tokens].filter(token => text.includes(token)).length
        + (row.category === 'preference' && String(row.topic).startsWith('沟通') ? 2 : 0)
        + (recall ? 1 : 0);
      return { row, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    const result: MemoryEntry[] = [];
    for (const { row } of ranked) {
      if (result.length >= limit) break;
      if (await sourceAvailable(this.tx, this.scope, row)) result.push(dto(row));
    }
    return result;
  }

  async refsAvailable(refs: MemoryRef[], allowSuperseded = false) {
    for (const ref of refs) {
      const row = (await this.versions(ref.key)).find(version => Number(version.revision) === ref.revision);
      if (!row || ['deleted','invalidated'].includes(String(row.state)) || !allowSuperseded && row.state === 'superseded'
        || !await sourceAvailable(this.tx, this.scope, row)) return false;
    }
    return true;
  }

  async projectContext(question: string) {
    const { enterpriseId, ownerId, conversationId, projectId, leadId } = this.scope;
    if (!projectId || !/工地|项目|现场|房间|房子|阶段|施工|方案|图纸|决定|设计师|工人|需求|插座|点位/u.test(question)) return null;
    const project = await one(this.tx, sql`select p.id::text,p.name,p.version,p.current_stage_key,l.community_name,
      f.id::text as floor_plan_id,f.name as floor_plan_name,f.updated_at::text as floor_plan_revision
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      left join app.floor_plans f on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id and f.status='completed'
      where p.enterprise_id=${enterpriseId} and p.id=${projectId} and l.id=${leadId} and l.customer_user_id=${ownerId}
      and l.archived_at is null and p.customer_access and p.status='active'`);
    if (!project) return null;
    const rooms = await rows(this.tx, sql`select id::text,name from app.construction_rooms
      where enterprise_id=${enterpriseId} and project_id=${projectId} order by id limit 24`);
    const plans = [], decisions = [];
    if (/方案|图纸|决定|确认|变更|设计师|核对|点位/u.test(question)) {
      const threads = await rows(this.tx, sql`select c.id::text,max(e.id) as latest from app.domain_event_outbox e
        join app.assistant_conversations c on c.enterprise_id=e.enterprise_id and c.id::text=e.payload->>'conversationId'
        join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id
          and ap.user_id=${ownerId} and ap.participant_role='owner' and ap.status='active'
        where e.enterprise_id=${enterpriseId} and e.payload->>'projectId'=${projectId} and e.payload->>'customerId'=${ownerId}
          and e.type in ('construction.plan.published.v1','construction.site.issue.result.v1')
          and c.purpose='customer_consultation' and c.mode='ai' and c.status in ('open','archived')
          and c.entry_snapshot->>'retentionRedacted' is distinct from 'true' and c.entry_snapshot->>'id'=${leadId}
        group by c.id order by max(e.id) desc limit 4`);
      for (const cid of new Set([conversationId, ...threads.map(thread => String(thread.id))])) {
        for (const plan of await customerPlans(this.tx, enterpriseId, ownerId, cid)) {
          if (plan.projectId !== projectId || plans.length >= 4) continue;
          const source = await one(this.tx, sql`select e.created_at::text,e.actor_ref from app.assistant_messages m join app.domain_event_outbox e
            on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
            where m.enterprise_id=${enterpriseId} and m.conversation_id=${cid} and m.id=${plan.messageId}`);
          plans.push({ id: plan.id, revision: plan.revision, title: plan.title, change: plan.difference, reason: plan.reason,
            status: plan.status, publisherId: plan.publisherId, decidedBy: (source?.actor_ref as Row)?.kind,
            recordedAt: source?.created_at, sourceConversationId: cid, sourceMessageId: plan.messageId, hash: plan.hash });
        }
        for (const result of await customerSiteResults(this.tx, enterpriseId, ownerId, cid)) {
          if (result.projectId !== projectId || result.status === 'invalidated' || decisions.length >= 4) continue;
          decisions.push({ issueId: result.issueId, revision: result.revision, status: result.status,
            sourceConversationId: cid, sourceMessageId: result.messageId, sourceVersion: result.sourceVersion });
        }
      }
    }
    return { project, rooms, plans, decisions };
  }
}
