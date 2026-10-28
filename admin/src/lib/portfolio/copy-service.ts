import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { AssistantError, fail, fingerprint, id, key } from '@/lib/assistant/contracts';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { executeAgentChat } from '@/lib/ai/providers/agent-chat';
import { bailianBinding } from '@/lib/ai/providers/bailian-capabilities';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import type { ModelTurnInput, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { portfolioCopyBudget } from '@/lib/assistant/core/model-task-budget';
import { portfolioAccess, type PortfolioActor } from './service';
import { object, shortText, workContent } from './contracts';
import { copyFacts, copyInput, copySource, parseCopy, portfolioCopyProtocol } from './copy-contract';

export type CopyPorts = {
  runtime(): Promise<AiProviderRuntimeConfig | null>;
  generate(runtime: AiProviderRuntimeConfig, input: ModelTurnInput): Promise<ModelTurnOutput>;
  beforeDispatch?(task: Row): Promise<void>;
};
const defaultPorts: CopyPorts = { runtime: () => getPlatformLlmOverrideRuntime('chat'), generate: executeAgentChat };
function binding(runtime: AiProviderRuntimeConfig | null) {
  if (!runtime || runtime.adapterType !== 'openai_compatible') fail('portfolio_copy_unconfigured', 409);
  const value = bailianBinding(runtime.baseUrl, runtime.modelMappings['chat.general'] || '', false);
  if (!value) fail('portfolio_copy_unconfigured', 409);
  return { ...value, providerId: String(runtime.id), protocol: portfolioCopyProtocol };
}
/** The usual portfolio authorization is rechecked before every read/adoption
 * and around dispatch. Only the creator can read their private generated task. */
export async function copyWork(tx: PostgresTransaction, actor: PortfolioActor, workId: string, requireRights = true) {
  const manager = await portfolioAccess(tx, actor);
  const work = await one(tx, sql`select w.*,v.status,v.content from app.portfolio_works w join app.portfolio_versions v
    on v.enterprise_id=w.enterprise_id and v.id=w.head_version_id where w.enterprise_id=${actor.enterpriseId} and w.id=${id(workId)}
    ${manager ? sql`` : sql`and w.author_id=${actor.adminId} and w.kind='designer_work'`} for update of w,v`);
  if (!work) fail('portfolio_not_found', 404);
  if (work.withdrawn) fail('portfolio_copy_stale', 409);
  if (work.author_id && !await one(tx, sql`select id from app.admin_users where enterprise_id=${actor.enterpriseId}
    and id=${String(work.author_id)} and role='designer' and status='active' for share`)) fail('portfolio_author_unavailable', 409);
  const content = workContent(work.content);
  if (requireRights && (!content.source || !content.authorization)) fail('portfolio_copy_source_required', 409);
  if (requireRights && content.rightsUntil && Date.parse(content.rightsUntil) <= Date.now()) fail('portfolio_rights_expired', 409);
  return { work, content, sourceHash: copySource(content, work) };
}
export function assertCopyCurrent(task: Row, current: Awaited<ReturnType<typeof copyWork>>, adoption = false) {
  const request = task.request as Row, result = task.result as Row | null;
  if (task.revoked_at || request.sourceHash !== current.sourceHash && (!result?.adoptedHash || result.adoptedHash !== current.sourceHash)
    || adoption && (request.sourceHash !== current.sourceHash || Number(request.workVersion) !== Number(current.work.version))) fail('portfolio_copy_stale', 409);
}
function dto(task: Row) {
  return { id: String(task.id), state: task.state, error: task.last_error, createdAt: task.created_at,
    workVersion: (task.request as Row).workVersion, result: (task.result as Row | null)?.output || null,
    adopted: Boolean((task.result as Row | null)?.adoptedHash) };
}
export class PortfolioCopyService {
  constructor(readonly actor: PortfolioActor, readonly ports: CopyPorts = defaultPorts) {}
  async create(workId: string, input: Row, operationKey: string) {
    object(input, ['expectedVersion', 'instruction']); key(operationKey);
    const instruction = shortText(input.instruction, 500, true);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const settings = await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId} for update`);
      const current = await copyWork(tx, this.actor, workId);
      const requestHash = fingerprint({ workId, input });
      const old = await one(tx, sql`select * from app.assistant_model_tasks where enterprise_id=${this.actor.enterpriseId}
        and created_by=${this.actor.adminId} and operation_key=${operationKey}`);
      if (old) { if (old.kind !== 'portfolio_copy' || old.request_hash !== requestHash) fail('idempotency_conflict', 409); assertCopyCurrent(old, current); return dto(old); }
      const bound = binding(await this.ports.runtime());
      if (!settings?.enabled) fail('assistant_disabled', 409);
      if (input.expectedVersion !== Number(current.work.version)) fail('version_conflict', 409);
      if (!['draft', 'returned'].includes(String(current.work.status))) fail('portfolio_draft_required', 409);
      const pending = await one(tx, sql`select id from app.assistant_model_tasks where enterprise_id=${this.actor.enterpriseId} and kind='portfolio_copy'
        and request->>'workId'=${workId} and state in ('prepared','running','submitting','indeterminate') and revoked_at is null`);
      if (pending) fail('portfolio_copy_pending', 409);
      const facts = copyFacts(current.content, String(current.work.kind));
      if (Buffer.byteLength(JSON.stringify(facts)) > 12000) fail('invalid_portfolio', 422);
      const held = await portfolioCopyBudget(tx, this.actor.enterpriseId);
      const chat = (await one(tx, sql`select coalesce(sum(reserved_requests),0) requests,
        coalesce(sum(case when status='settled' then coalesce(settled_tokens,reserved_tokens) else reserved_tokens end),0) tokens,
        coalesce(sum(case when status='settled' then coalesce(settled_cost_micros,reserved_cost_micros) else reserved_cost_micros end),0) cost
        from app.assistant_quota_reservations where enterprise_id=${this.actor.enterpriseId} and status!='released'
        and (budget_date=(now() at time zone 'UTC')::date or status in ('held','reconciling'))`))!;
      const tokens = 16000, cost = 1000000; // Existing conservative hold; not a price or invoice.
      if (Number(held.requests) + Number(chat.requests) + 1 > Number(settings.daily_requests)
        || BigInt(String(held.tokens)) + BigInt(String(chat.tokens)) + BigInt(tokens) > BigInt(String(settings.daily_tokens))
        || BigInt(String(held.cost)) + BigInt(String(chat.cost)) + BigInt(cost) > BigInt(String(settings.daily_cost_micros))) fail('assistant_quota_exceeded', 429);
      const request = { workId, workVersion: current.work.version, sourceHash: current.sourceHash, facts, instruction, policyVersion: settings.policy_version };
      const task = (await one(tx, sql`insert into app.assistant_model_tasks(enterprise_id,created_by,operation_key,kind,binding,request,request_hash,reserved_tokens,reserved_cost_micros)
        values(${this.actor.enterpriseId},${this.actor.adminId},${operationKey},'portfolio_copy',${JSON.stringify(bound)}::jsonb,${JSON.stringify(request)}::jsonb,${requestHash},${tokens},${cost}) returning *`))!;
      await tx.execute(sql`insert into app.assistant_model_task_items(enterprise_id,task_id,custom_id,request,reserved_tokens,reserved_cost_micros)
        values(${this.actor.enterpriseId},${String(task.id)},'copy',${JSON.stringify({ facts, instruction })}::jsonb,${tokens},${cost})`);
      return dto(task);
    });
  }
  async latest(workId: string) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const current = await copyWork(tx, this.actor, workId, false);
      const task = await one(tx, sql`select * from app.assistant_model_tasks where enterprise_id=${this.actor.enterpriseId} and created_by=${this.actor.adminId}
        and kind='portfolio_copy' and request->>'workId'=${workId} order by id desc limit 1`);
      if (!task) return { task: null };
      if (!current.content.source || !current.content.authorization || current.content.rightsUntil && Date.parse(current.content.rightsUntil) <= Date.now()) return { task: { ...dto(task), state: 'stale', result: null } };
      try { assertCopyCurrent(task, current); } catch { return { task: { ...dto(task), state: 'stale', result: null } }; }
      return { task: dto(task) };
    });
  }
  async process(taskId: string) {
    const started = await withTenantTransaction(this.actor.enterpriseId, async tx => {
      let task = await one(tx, sql`select * from app.assistant_model_tasks where enterprise_id=${this.actor.enterpriseId} and created_by=${this.actor.adminId}
        and id=${id(taskId)} and kind='portfolio_copy'`);
      if (!task || task.state !== 'prepared') return null;
      const runtime = await this.ports.runtime();
      try {
        const settings = await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId} for update`);
        if (!settings?.enabled || settings.policy_version !== (task.request as Row).policyVersion) fail('context_changed');
        if (fingerprint(binding(runtime)) !== fingerprint(task.binding)) fail('context_changed');
        assertCopyCurrent(task, await copyWork(tx, this.actor, String((task.request as Row).workId)), true);
        task = (await one(tx, sql`select * from app.assistant_model_tasks where enterprise_id=${this.actor.enterpriseId} and id=${taskId} for update`))!;
        if (task.state !== 'prepared') return null;
      } catch (error) {
        await tx.execute(sql`update app.assistant_model_tasks set state='cancelled',last_error=${error instanceof AssistantError ? error.code : 'context_changed'},updated_at=now(),version=version+1 where enterprise_id=${this.actor.enterpriseId} and id=${taskId}`);
        return null;
      }
      const attempt = await new AiCreationRepository(tx).createProviderAttempt({ enterpriseId: BigInt(this.actor.enterpriseId), providerConfigId: BigInt(runtime!.id),
        providerKey: runtime!.key, adapterType: runtime!.adapterType, capability: 'chat', logicalModelKey: 'chat.general', remoteModel: 'qwen3.8-flash', status: 'unknown', accepted: true,
        requestFingerprint: fingerprint(task.request), estimatedCost: { measurementKind: 'reserved', micros: String(task.reserved_cost_micros) },
        metadata: { portfolioCopy: { taskId, sourceHash: (task.request as Row).sourceHash, protocol: portfolioCopyProtocol } } });
      await tx.execute(sql`update app.assistant_model_task_items set state='submitted',attempt_id=${String(attempt.id)} where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId}`);
      await tx.execute(sql`update app.assistant_model_tasks set state='running',authorization_id=${'portfolio:' + taskId},updated_at=now(),version=version+1 where enterprise_id=${this.actor.enterpriseId} and id=${taskId}`);
      return { task, runtime: runtime!, attemptId: String(attempt.id) };
    });
    if (!started) return false;
    const { task, runtime, attemptId } = started, request = task.request as Row;
    let output: ModelTurnOutput | undefined;
    try {
      await this.ports.beforeDispatch?.(task);
      output = await this.ports.generate(runtime, copyInput(request.facts as ReturnType<typeof copyFacts>, String(request.instruction), 'qwen3.8-flash'));
      // Persist the exact original response/usage even if parsing or permission
      // revalidation subsequently fails. Never regenerate to repair a result.
      await withTenantTransaction(this.actor.enterpriseId, async tx => {
        await new AiCreationRepository(tx).updateProviderAttempt(BigInt(attemptId), { status: 'succeeded', accepted: true,
          actualCost: { measurementKind: 'unavailable' }, metadata: { portfolioCopy: { taskId, protocol: portfolioCopyProtocol }, output } });
        await tx.execute(sql`update app.assistant_model_task_items set state='succeeded',result=${JSON.stringify(output)}::jsonb,response_hash=${fingerprint(output)}
          where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId}`);
      });
      const parsed = await parseCopy(output, request.facts as ReturnType<typeof copyFacts>);
      await withTenantTransaction(this.actor.enterpriseId, async tx => {
        const settings = await one(tx, sql`select enabled,policy_version from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId} for share`);
        if (!settings?.enabled || settings.policy_version !== request.policyVersion) fail('context_changed');
        assertCopyCurrent(task, await copyWork(tx, this.actor, String(request.workId)), true);
        await tx.execute(sql`update app.assistant_model_tasks set state='completed',result=${JSON.stringify({ output: parsed })}::jsonb,updated_at=now(),version=version+1
          where enterprise_id=${this.actor.enterpriseId} and id=${taskId} and state='running'`);
      });
    } catch (error) {
      await withTenantTransaction(this.actor.enterpriseId, async tx => {
        await tx.execute(sql`update app.assistant_model_tasks set state=${output ? 'failed' : 'indeterminate'},last_error=${output ? error instanceof AssistantError ? error.code : 'portfolio_copy_invalid' : 'provider_outcome_unknown'},
          updated_at=now(),version=version+1 where enterprise_id=${this.actor.enterpriseId} and id=${taskId} and state='running'`);
      });
    }
    return true;
  }
}
/** Same internal Worker endpoint; one durable copy at a time. An expired
 * running marker means an unknown outcome, never permission to resend. */
export async function processPortfolioCopy() {
  if (!(await withPlatformTransaction(tx => one(tx, sql`select to_regclass('app.assistant_model_tasks') is not null as ready`)))?.ready) return false;
  const task = await withPlatformTransaction(tx => one(tx, sql`select id,enterprise_id,created_by,state from app.assistant_model_tasks where kind='portfolio_copy'
    and (state='prepared' or state='running' and updated_at<now()-interval '150 seconds') order by id limit 1`));
  if (!task) return false;
  if (task.state === 'running') {
    await withTenantTransaction(String(task.enterprise_id), tx => tx.execute(sql`update app.assistant_model_tasks set state='indeterminate',last_error='provider_outcome_unknown',version=version+1,updated_at=now()
      where enterprise_id=${String(task.enterprise_id)} and id=${String(task.id)} and state='running' and updated_at<now()-interval '150 seconds'`));
    return true;
  }
  return new PortfolioCopyService({ enterpriseId: String(task.enterprise_id), adminId: String(task.created_by) }).process(String(task.id));
}
