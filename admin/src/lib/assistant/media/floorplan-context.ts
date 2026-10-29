import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, requireCapability, type ActorContext } from '../contracts';
import { idempotent } from '../core/conversation';
import { runUsageReconciled } from '../core/usage-review';
import { AssistantMediaService } from './service';
import { floorplanContext, floorplanContextProtocol, selectedFormalPlan, type FloorplanSelection } from './floorplan-selection';
import { formalFloorplanText } from '../agent/formal-floorplan-context';

export function parseFloorplanChoice(input: unknown) {
  const body = input as Row;
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !['expectedVersion','selection'].includes(k))
    || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 || !Object.hasOwn(body, 'selection')) fail('invalid_message', 422);
  if (body.selection === null) return { expectedVersion: Number(body.expectedVersion), selection: null };
  const value = body.selection as FloorplanSelection;
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !['leadId','floorPlanId','layoutHash'].includes(k))
    || typeof value.leadId !== 'string' || typeof value.floorPlanId !== 'string' || typeof value.layoutHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.layoutHash)) fail('invalid_message', 422);
  id(value.leadId); id(value.floorPlanId);
  return { expectedVersion: Number(body.expectedVersion), selection: value };
}

export class FloorplanContextService {
  constructor(readonly actor: ActorContext, readonly conversationId: string, private transaction?: PostgresTransaction) {
    id(conversationId); requireCapability(actor, 'assistant.chat.self');
    if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  }
  private scope<T>(run: (repo: AssistantRepository, c: Row) => Promise<T>, write = false) {
    const execute = async (tx: PostgresTransaction) => {
      const repo = new AssistantRepository(tx, this.actor);
      await repo.settings(write);
      const c = await repo.conversation(this.conversationId);
      if ((c.entry_snapshot as Row)?.retentionRedacted) fail('assistant_resource_not_found', 404);
      return run(repo, c);
    };
    return this.transaction ? execute(this.transaction) : withTenantTransaction(this.actor.enterpriseId, execute);
  }
  private async projection(repo: AssistantRepository, c: Row) {
    const stored = floorplanContext(c.entry_snapshot);
    const plan = await selectedFormalPlan(repo.tx, this.actor, c.entry_snapshot);
    const invalidated = !!stored.selection && !plan;
    const revision = stored.revision + (invalidated ? 1 : 0);
    if (invalidated) await this.save(repo, { revision, selection: null });
    return { version: revision, invalidated,
      selected: plan ? { ...plan.selection, name: String(plan.name) } : null };
  }
  private async save(repo: AssistantRepository, value: { revision: number; selection: FloorplanSelection | null }) {
    await repo.tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{floorplanContext}',
      ${JSON.stringify({ protocol: floorplanContextProtocol, ...value })}::jsonb),context_revision=context_revision+1,version=version+1,updated_at=now()
      where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
  }
  read() {
    return this.scope(async (repo, c) => {
      const current = await this.projection(repo, c);
      const list = await new AssistantMediaService(this.actor, repo.tx).floorPlans(this.conversationId);
      const entry = c.entry_snapshot as Row;
      return { ...current, items: list.items.filter(item => entry.kind !== 'lead' || item.leadId === String(entry.id)) };
    });
  }
  detail(leadId: string, floorPlanId: string, layoutHash: string) {
    id(leadId); id(floorPlanId);
    if (!/^[a-f0-9]{64}$/.test(layoutHash)) fail('invalid_message', 422);
    return this.scope(async (repo, c) => {
      const entry = { ...(c.entry_snapshot as Row), floorplanContext: { protocol: floorplanContextProtocol, revision: 0, selection: { leadId, floorPlanId, layoutHash } } };
      const plan = await selectedFormalPlan(repo.tx, this.actor, entry);
      if (!plan) fail('assistant_resource_not_found', 404);
      return { ...plan.selection, name: String(plan.name), text: formalFloorplanText(String(plan.name), plan.layout_data) };
    });
  }
  select(requestKey: string, input: unknown) {
    const body = parseFloorplanChoice(input);
    return this.scope(async (repo, c) => {
      await idempotent(repo.tx, this.actor, 'floorplan-context:' + this.conversationId, requestKey, body, async () => {
        if (c.status !== 'open' || c.mode !== 'ai') fail('conversation_read_only');
        if (floorplanContext(c.entry_snapshot).revision !== body.expectedVersion) fail('version_conflict');
        if (await one(repo.tx, sql`select r.id from app.assistant_runs r where r.enterprise_id=${this.actor.enterpriseId} and r.conversation_id=${this.conversationId}
          and (r.status in ('queued','running') or r.status='indeterminate' and not ${runUsageReconciled()}) limit 1`)) fail('conversation_busy');
        if (body.selection && !await selectedFormalPlan(repo.tx, this.actor, {
          ...(c.entry_snapshot as Row), floorplanContext: { protocol: floorplanContextProtocol, revision: 0, selection: body.selection },
        })) fail('assistant_resource_not_found', 404);
        await this.save(repo, { revision: body.expectedVersion + 1, selection: body.selection });
        return { version: body.expectedVersion + 1 };
      });
      return this.projection(repo, await repo.conversation(this.conversationId));
    }, true);
  }
}
