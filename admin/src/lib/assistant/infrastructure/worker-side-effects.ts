import { sql } from 'drizzle-orm';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { previewAssistantQueue } from './job-preview';
import { workerTaskScope, nativeWorkflowScope, type NativeWorkflowScope } from './worker-scope';
import { evaluateWorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';
import { nativeWorkflowEnabled, nativeWorkflowEnterpriseIds } from '@/lib/native-workflow/live/tenant-allowlist';
import { delegationEnterprises } from '@/lib/native-workflow/live/delegation-config';

/** Static consequence labels used by the dry-run. They describe what a task can
 * do when it actually runs; the count next to them is only a preflight
 * candidate estimate, never a delivery or execution receipt. */
export type WorkerSideEffectKind =
  | 'in_app_notification'
  | 'model_call'
  | 'business_write'
  | 'knowledge_write'
  | 'internal_receipt';

export type WorkerSideEffectTask = {
  task: string;
  label: string;
  scope: 'pilot_enterprise' | 'none';
  wouldRun: boolean;
  pending: number | null;
  productionLimit: number | null;
  sideEffects: WorkerSideEffectKind[];
  reason?: string;
  detail?: Record<string, unknown>;
};

export type WorkerSideEffectsPreview = {
  generatedAt: string;
  gate: { status: string; reason: string; enterpriseId: string | null; pilotId: string | null };
  scope: { mode: 'pilot' | 'none'; enterpriseId: string | null };
  tasks: WorkerSideEffectTask[];
  nativeWorkflow: {
    schedule: NativeWorkflowScope;
    delegations: NativeWorkflowScope;
    durableTools: NativeWorkflowScope;
  };
};

type CountQuery = (tx: PostgresTransaction) => Promise<Row | undefined>;

/** Optional tables can be absent on an older database. A missing table or
 * column is reported as `null`, never as zero, and never aborts the preflight. */
async function safeCount(table: string, query: CountQuery): Promise<number | null> {
  try {
    return await withPlatformTransaction(async tx => {
      const ready = await one(tx, sql`select to_regclass(${table}) is not null as ready`);
      if (!ready?.ready) return null;
      const row = await query(tx);
      return row ? Number(row.n ?? 0) : 0;
    }, { readOnly: true });
  } catch {
    return null;
  }
}

export async function previewWorkerSideEffects(input: {
  env?: Record<string, string | undefined>;
  now?: Date;
} = {}): Promise<WorkerSideEffectsPreview> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const gate = evaluateWorkerSafetyGate(env);
  const execution = workerTaskScope(gate);
  const eid = execution.enterpriseId;
  const scope = eid ? sql`and enterprise_id=${eid}` : sql``;
  const recordScope = eid ? sql`and r.enterprise_id=${eid}` : sql``;
  const siteScope = eid ? sql`and s.enterprise_id=${eid}` : sql``;
  const eventScope = eid ? sql`and e.enterprise_id=${eid}` : sql``;

  const queue = await previewAssistantQueue({ enterpriseId: eid, now });
  const knowledgeBatches = await safeCount('app.assistant_knowledge_batches', tx => one(tx, sql`select count(*)::int as n
    from app.assistant_knowledge_batches b where b.state='active' ${eid ? sql`and b.enterprise_id=${eid}` : sql``} and exists(
      select 1 from app.assistant_knowledge_batch_items i join app.assistant_knowledge_evaluations e
      on e.enterprise_id=i.enterprise_id and e.id=i.evaluation_id left join app.assistant_runs r on r.enterprise_id=e.enterprise_id and r.id=e.run_id
      where i.enterprise_id=b.enterprise_id and i.batch_id=b.id
      and (i.state='pending' and e.run_id is null or r.status in ('queued','running')))`));
  const sitePublications = await safeCount('app.construction_site_records', tx => one(tx, sql`select count(distinct r.id)::int as n
    from app.domain_event_outbox e join app.construction_site_records r
      on r.enterprise_id=e.enterprise_id and r.id::text=e.aggregate_id and r.published_version=e.aggregate_version
    join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.customer_user_id=r.published_customer_id and l.archived_at is null
    join app.enterprises ent on ent.id=r.enterprise_id and ent.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=r.enterprise_id and s.enabled
    where e.type='construction.record.publish.v1' and r.status='published' and r.audience='customer'
      and p.status='active' and p.customer_access and r.source_message_id is not null ${recordScope}
      and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id
        and d.consumer_key='construction:record:user:' || r.published_customer_id::text)
      and exists(select 1 from app.construction_watches w join app.assistant_messages m
        on m.enterprise_id=w.enterprise_id and m.id=w.source_message_id
        join app.assistant_conversations c on c.enterprise_id=m.enterprise_id and c.id=m.conversation_id
        join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id
          and ap.user_id=r.published_customer_id and ap.status='active'
        where w.enterprise_id=r.enterprise_id and w.project_id=r.project_id and w.customer_id=r.published_customer_id
          and w.active and w.started_at<=r.published_at and c.purpose='customer_consultation' and c.status='open' and c.mode='ai'
          and (w.room_id is null or (w.room_id=r.room_id and w.room_name_snapshot=r.room_name_snapshot)))`));
  const siteResults = await safeCount('app.domain_event_outbox', tx => one(tx, sql`select count(distinct e.id)::int as n
    from app.domain_event_outbox e join app.enterprises ent on ent.id=e.enterprise_id and ent.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=e.enterprise_id and s.enabled
    join app.assistant_conversations c on c.enterprise_id=e.enterprise_id and c.id::text=e.payload->>'conversationId'
      and c.status='open' and c.mode='ai'
    where e.type='construction.site.issue.result.v1' ${eventScope}
      and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id
        and d.consumer_key='construction:result:' || c.id::text)`));
  const sitePlans = await safeCount('app.domain_event_outbox', tx => one(tx, sql`select count(distinct e.id)::int as n
    from app.domain_event_outbox e join app.enterprises ent on ent.id=e.enterprise_id and ent.status='active'
    join app.assistant_enterprise_settings s on s.enterprise_id=e.enterprise_id and s.enabled
    join app.assistant_conversations c on c.enterprise_id=e.enterprise_id and c.id::text=e.payload->>'conversationId'
      and c.status='open' and c.mode='ai'
    where e.type='construction.plan.published.v1' ${eventScope}
      and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id
        and d.consumer_key='construction:plan:' || c.id::text)`));
  const publicConsents = await safeCount('app.construction_public_sites', tx => one(tx, sql`select count(distinct s.id)::int as n
    from app.construction_public_sites s join app.users u on u.id=s.customer_id
    join app.construction_projects p on p.enterprise_id=s.enterprise_id and p.id=s.project_id
    where s.status<>'draft' ${siteScope}
      and exists(select 1 from app.domain_event_outbox e where e.enterprise_id=s.enterprise_id and e.aggregate_id=s.id::text
        and e.aggregate_version=s.revision and e.type in ('construction.public.consent.v1','construction.public.status.v1')
        and not exists(select 1 from app.domain_event_deliveries d where d.enterprise_id=e.enterprise_id and d.event_id=e.id
          and d.consumer_key='public-consent:user:' || s.customer_id::text))
      and exists(select 1 from app.assistant_conversations c join app.assistant_participants ap
        on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.user_id=s.customer_id and ap.status='active'
        where c.enterprise_id=s.enterprise_id and c.purpose='customer_consultation' and c.status='open')`));
  const portfolioCopy = await safeCount('app.assistant_model_tasks', tx => one(tx, sql`select count(*)::int as n
    from app.assistant_model_tasks where kind='portfolio_copy' ${scope}
      and (state='prepared' or state='running' and updated_at<now()-interval '150 seconds')`));
  const metrics = await safeCount('app.domain_event_deliveries', tx => one(tx, sql`select count(*)::int as n
    from app.domain_event_deliveries where consumer_key in ('assistant.run.metrics.v1','assistant.knowledge.visibility.v1')
      and status in ('pending','retry_wait') and available_at<=now() ${scope}`));

  const scheduleEnabled = nativeWorkflowEnabled(env.NATIVE_WORKFLOW_SCHEDULE_ENABLED)
    || nativeWorkflowEnabled(env.NATIVE_WORKFLOW_TASK_RECOVERY_ENABLED);
  const delegationEnabled = nativeWorkflowEnabled(env.NATIVE_WORKFLOW_DELEGATION_ENABLED);
  const durableToolEnabled = nativeWorkflowEnabled(env.NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED);
  const nativeSchedule = execution.enabled
    ? nativeWorkflowScope(nativeWorkflowEnterpriseIds(env.NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS), eid, scheduleEnabled)
    : { allowed: false, reason: 'worker_safety_gate' as const, enterpriseIds: [] };
  const processEnv = env as NodeJS.ProcessEnv;
  const nativeDelegations = execution.enabled
    ? nativeWorkflowScope(delegationEnterprises(processEnv), eid, delegationEnabled)
    : { allowed: false, reason: 'worker_safety_gate' as const, enterpriseIds: [] };
  const nativeDurableTools = execution.enabled
    ? nativeWorkflowScope(delegationEnterprises(processEnv), eid, durableToolEnabled)
    : { allowed: false, reason: 'worker_safety_gate' as const, enterpriseIds: [] };

  const task = (
    name: string, label: string, pending: number | null, limit: number | null,
    sideEffects: WorkerSideEffectKind[], enabled = execution.enabled,
    detail?: Record<string, unknown>,
  ): WorkerSideEffectTask => ({
    task: name, label, scope: eid ? 'pilot_enterprise' : 'none',
    wouldRun: enabled && execution.enabled, pending, productionLimit: limit, sideEffects,
    ...(enabled ? {} : { reason: gate.reason }),
    ...(detail ? { detail } : {}),
  });

  return {
    generatedAt: now.toISOString(),
    gate: { status: gate.status, reason: gate.reason, enterpriseId: gate.enterpriseId, pilotId: gate.pilotId },
    scope: { mode: eid ? 'pilot' : 'none', enterpriseId: eid },
    tasks: [
      task('assistant_jobs', 'Assistant 对话/站点/报告任务', queue.counts.queued + queue.counts.running, null,
        ['model_call', 'business_write', 'in_app_notification'], execution.enabled,
        { queued: queue.counts.queued, running: queue.counts.running, failed: queue.counts.failed,
          indeterminate: queue.counts.indeterminate, reclaimable: queue.reclaimable.total }),
      task('knowledge_batches', '知识库评测批次', knowledgeBatches, 1,
        ['model_call', 'knowledge_write']),
      task('site_publications', '施工进展公开通知', sitePublications, 20,
        ['in_app_notification', 'business_write']),
      task('site_results', '问题处理结果通知', siteResults, 20,
        ['in_app_notification', 'business_write']),
      task('site_plans', '方案发布通知', sitePlans, 20,
        ['in_app_notification', 'business_write']),
      task('public_consents', '公开材料业主确认通知', publicConsents, 20,
        ['in_app_notification', 'business_write']),
      task('portfolio_copy', '作品文案生成', portfolioCopy, 1,
        ['model_call', 'business_write']),
      task('assistant_metrics', 'Assistant 指标回执', metrics, 50,
        ['internal_receipt']),
      task('stage_reminders', '阶段提醒生成/投递', null, null,
        ['business_write', 'in_app_notification'], execution.enabled,
        { note: 'dedicated worker resolves the pilot project scope and reports its own counts' }),
      task('weekly_reports', '周报生成/投递', null, null,
        ['business_write', 'in_app_notification'], execution.enabled,
        { note: 'dedicated worker resolves the pilot project scope and reports its own counts' }),
      task('native_workflow_schedule', '原生工作流周期调度', null, null,
        ['model_call', 'business_write', 'in_app_notification'], execution.enabled && nativeSchedule.allowed,
        { scope: nativeSchedule }),
      task('native_workflow_delegations', '原生工作流委派', null, null,
        ['model_call', 'business_write', 'in_app_notification'], execution.enabled && nativeDelegations.allowed,
        { scope: nativeDelegations }),
      task('native_workflow_durable_tools', '原生工作流持久工具', null, null,
        ['business_write', 'in_app_notification'], execution.enabled && nativeDurableTools.allowed,
        { scope: nativeDurableTools }),
    ],
    nativeWorkflow: {
      schedule: nativeSchedule,
      delegations: nativeDelegations,
      durableTools: nativeDurableTools,
    },
  };
}
