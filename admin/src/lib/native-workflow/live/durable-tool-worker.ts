import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rows } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { WorkflowOperationError } from '../errors';
import {
  createDelegationReminderPort, delegationReminderResult, delegationReminderTool,
  durableDelegationToolEnabled, nativeToolResultConsumer,
} from './delegation-reminder-tool';
import { appendDelegationEvent, delegationEnterprises, linkDelegationEvent } from './delegation-store';
import { createPostgresDurableTaskStore } from './durable-task-postgres-store';
import { createDurableTaskRuntime } from './durable-task-runtime';
import type { DurableTaskListQuery } from './durable-task-types';
import { createDurableToolExecutor, type DurableToolExecutor } from './durable-tool-execution';

interface ResultDelivery {
  readonly id: string;
  readonly event_id: string;
  readonly task_id: string;
  readonly dispatch_id: string;
  readonly message_id: string | null;
  readonly error_code: string | null;
}

async function consumeResults(enterpriseId: string, executor: DurableToolExecutor) {
  const deliveries = await withTenantTransaction(enterpriseId, (tx) => rows<ResultDelivery>(tx, sql`
    select d.id::text,d.event_id::text,e.payload->>'taskId' as task_id,e.payload->>'dispatchId' as dispatch_id,
      e.payload->>'messageId' as message_id,e.payload->>'errorCode' as error_code
    from app.domain_event_deliveries d
    join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
    where d.enterprise_id=${enterpriseId} and d.consumer_key=${nativeToolResultConsumer}
      and e.type=${delegationReminderResult} and d.status in ('pending','retry_wait') and d.available_at<=clock_timestamp()
    order by d.available_at,d.id limit 12`));
  let applied = 0;
  for (const delivery of deliveries) {
    const result = await executor.handleCallback({
      enterpriseId, taskId: delivery.task_id, dispatchId: delivery.dispatch_id,
      callbackId: 'outbox-' + delivery.event_id,
      status: delivery.message_id ? 'succeeded' : 'failed',
      result: delivery.message_id ? { eventId: delivery.event_id, messageId: delivery.message_id } : undefined,
      errorCode: delivery.error_code ?? undefined,
    }).catch(() => null);
    if (result?.applied) applied++;
    const handled = result?.applied || (result?.reason !== undefined && result.reason !== null
      && ['duplicate', 'already_settled', 'terminal'].includes(result.reason));
    const busy = result?.reason === 'busy';
    await withTenantTransaction(enterpriseId, async (tx) => {
      if (handled) {
        await tx.execute(sql`update app.domain_event_deliveries set status='delivered', attempts=attempts+1,
          last_error=null,updated_at=clock_timestamp() where enterprise_id=${enterpriseId} and id=${delivery.id}
          and consumer_key=${nativeToolResultConsumer} and status in ('pending','retry_wait')`);
      } else {
        await tx.execute(sql`update app.domain_event_deliveries
          set status=case when ${busy} or attempts<7 then 'retry_wait' else 'dead' end,
            attempts=attempts+case when ${busy} then 0 else 1 end,
            available_at=clock_timestamp()+interval '5 seconds',
            last_error=${result?.reason ?? 'tool_callback_failed'},updated_at=clock_timestamp()
          where enterprise_id=${enterpriseId} and id=${delivery.id} and consumer_key=${nativeToolResultConsumer}
            and status in ('pending','retry_wait') and available_at<=clock_timestamp()`);
      }
    });
  }
  return applied;
}

async function linkManualOutcomes(enterpriseId: string) {
  await withTenantTransaction(enterpriseId, async (tx) => {
    const tasks = await rows<{ id: string; delegation_id: string; code: string }>(tx, sql`
      select t.id,d.id::text as delegation_id,t.state#>>'{manual,code}' as code
      from app.native_workflow_durable_tasks t join app.native_workflow_delegations d
        on d.enterprise_id=t.enterprise_id and d.id::text=t.state#>>'{delegation,delegationId}'
      where t.enterprise_id=${enterpriseId} and t.kind='tool.call' and t.state#>>'{data,tool}'=${delegationReminderTool}
        and t.state->'manual'<>'null'::jsonb and t.state#>>'{manual,resolvedAt}' is null
        and not exists (select 1 from app.domain_event_outbox e where e.enterprise_id=t.enterprise_id
          and e.type='native.delegation.reminder.attention.v1' and e.aggregate_type='native_workflow_delegation'
          and e.aggregate_id=t.id and e.aggregate_version=1)
      order by t.updated_at,t.id limit 12`);
    for (const task of tasks) {
      const eventId = await appendDelegationEvent(tx, enterpriseId, 'native.delegation.reminder.attention.v1', task.id, 1,
        { taskId: task.id, delegationId: task.delegation_id, code: task.code });
      if (eventId) await linkDelegationEvent(tx, { enterpriseId, id: task.delegation_id }, eventId, 'unavailable',
        { taskId: task.id, code: task.code });
    }
  });
}

/** Invoked by the existing authenticated assistant job endpoint. */
export async function runNativeDurableToolTick(env = process.env) {
  if (!durableDelegationToolEnabled(env)) return { enabled: false, enterprises: [] };
  const enterprises = delegationEnterprises(env);
  const runtime = createDurableTaskRuntime({ store: createPostgresDurableTaskStore() });
  const executor = createDurableToolExecutor({
    runtime, port: createDelegationReminderPort(env), callbackWaitMs: 5_000,
  });
  const summaries = [];
  for (const enterpriseId of enterprises) {
    let callbacks = 0;
    let processed = 0;
    const errors: string[] = [];
    try {
      callbacks = await consumeResults(enterpriseId, executor);
      const ready: DurableTaskListQuery = {
        enterpriseId, kind: 'tool.call', tool: delegationReminderTool,
        readyAt: runtime.now(), limit: 6, statuses: ['pending', 'queued', 'retrying', 'running', 'waiting'],
      };
      const recovered = await runtime.recover(enterpriseId, ready);
      errors.push(...recovered.errors.map((error) => error.code));
      for (const record of await runtime.list(ready)) {
        try {
          if (record.status === 'running') continue;
          if (record.data.dispatch || record.data.receipt) await executor.reconcile(enterpriseId, record.taskId);
          else await executor.dispatchPrepared(enterpriseId, record.taskId, `assistant-worker:${randomUUID()}`);
          processed++;
        } catch (error) {
          errors.push(error instanceof WorkflowOperationError ? error.code : 'durable_tool_advance_failed');
        }
      }
      await linkManualOutcomes(enterpriseId);
    } catch (error) {
      errors.push(error instanceof WorkflowOperationError ? error.code : 'durable_tool_tick_unavailable');
    }
    summaries.push({ enterpriseId, callbacks, processed, errors });
  }
  return { enabled: enterprises.length > 0, enterprises: summaries };
}

export async function readNativeToolManualQueue(enterpriseId: string, env = process.env) {
  // Inspection remains available while dispatch is disabled.
  const taskStore = nativeToolTaskStore(env);
  if (!taskStore) throw new WorkflowOperationError('durable_tool_postgres_required', 503, 'the PostgreSQL task store is disabled');
  const records = await taskStore.list({ enterpriseId, kind: 'tool.call', tool: delegationReminderTool, manualOnly: true, limit: 50 });
  return records.map((record) => ({
    taskId: record.taskId,
    delegationId: record.delegation.delegationId,
    status: record.data.dispatch && !record.data.receipt ? 'unknown' : record.status,
    code: record.manual?.code ?? null,
    queuedAt: record.manual?.queuedAt ?? null,
  }));
}

function nativeToolTaskStore(env: NodeJS.ProcessEnv) {
  return env.NATIVE_WORKFLOW_TASK_STORE?.trim() === 'postgres' ? createPostgresDurableTaskStore() : null;
}
