import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, type Evidence, type KnowledgeRetriever } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTool, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { agentConfig } from '@/lib/assistant/agent/config';
import { runRenovationAgent, type AgentCheckpoint } from '@/lib/assistant/agent/runtime';
import { agentRequestBudget, fitAgentContext } from '@/lib/assistant/agent/context-budget';
import { boundReportBodyFactCoverage, boundReportBodyFinal, boundReportBodyWire, boundReportFinalCarrier, boundReportGuidanceInput, boundReportGuidanceReview, reportBodyFinalProtocol, reportGuidanceOnlyProtocol, reportGuidanceTaskProtocol, reportPendingGuidanceProtocol, reportGuidanceReviewProtocol } from '@/lib/assistant/agent/report-native-final';
import { consultationRequestReservation, reserveConsultationDispatch, settleConsultationDispatch } from '@/lib/assistant/agent/consultation-usage';
import { businessSynthesisSources, knowledgeSynthesisSources, type SynthesisContext } from '@/lib/assistant/agent/synthesis';
import { synthesisContextAvailable } from '@/lib/assistant/agent/synthesis-sources';
import { reportFactText } from '@/lib/assistant/agent/report-context';
import type { BusinessSnapshot } from '@/lib/assistant/agent/business-tools';
import { conversationKnowledgeRetriever } from '@/lib/assistant/knowledge/retriever';
import { resolveEvidence } from '@/lib/assistant/knowledge/sources';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { consultationProfile } from '@/lib/assistant/contracts/consultation';
import { completeReportComposition, failRun, heartbeat, runContext, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { followupAvailable, followupProjects, type FollowupAudience, type ReportFacts } from './report-scope';
import { reportContextProtocol, resolveReportReference, type ReportReference } from './report-reference';
import { parseReportBody, projectReportBodyFinal, reportCompositionProtocol, reportFinalTool, reportFlatFinalTool, reportMessages } from './report-composition';
import { assertReportGuidanceReview, prepareReportGuidanceReview, reportGuidanceFactText, reportGuidanceProject } from './report-guidance-review';
import { projectReportGuidanceOnly, reportGuidanceFinalTool } from './report-guidance-final';

type ProjectContext = { projectId: string; selection: ReportReference; context: SynthesisContext };
type Composition = { protocol: typeof reportCompositionProtocol; reportId: string; revision: number; bindingId: string; dispatchEpoch: number; factsHash: string };
function selectedConversation(c: Row, selection: ReportReference): Row {
  // A private in-memory view for this run's original project. Never write the
  // selection to the user's current chat or consume their chat history/memory.
  return { ...c, entry_snapshot: { ...c.entry_snapshot as Row,
    reportContext: { protocol: reportContextProtocol, revision: 0, selection } } };
}
async function reportGuard(tx: PostgresTransaction, lease: Lease) {
  const context = await runContext(tx, lease), scope = (context.run.policy_snapshot as Row).reportComposition as Composition;
  if (context.run.purpose !== 'construction.report.compose' || scope?.protocol !== reportCompositionProtocol) fail('context_changed');
  const report = await one(tx, sql`select r.*,v.facts,v.facts_hash,v.generated_at,v.period_end as fact_period_end,v.cutoff_at as fact_cutoff_at,
    v.body_run_id from app.construction_reports r join app.construction_report_versions v
    on v.enterprise_id=r.enterprise_id and v.report_id=r.id join app.assistant_runs parent
    on parent.enterprise_id=v.enterprise_id and parent.id=v.run_id
    where r.enterprise_id=${lease.enterpriseId} and r.id=${scope.reportId} and r.binding_id=${scope.bindingId}
    and v.revision=${scope.revision} and v.status='facts_ready' and parent.status='succeeded'
    and parent.conversation_id=${String(context.conversation.id)} and v.body_run_id=${lease.runId} for share of v`);
  const plan = await one(tx, sql`select dispatch_epoch from app.construction_report_settings where enterprise_id=${lease.enterpriseId} and enabled for share`);
  const binding = await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${lease.enterpriseId}
    and id=${scope.bindingId} and status='enabled' and conversation_id=${String(context.conversation.id)} for share`);
  if (!report || report.facts_hash !== scope.factsHash || !binding || !plan || Number(plan.dispatch_epoch) !== scope.dispatchEpoch
    || !await followupAvailable(tx, lease.enterpriseId, binding)) fail('context_changed');
  const ids = (report.facts as ReportFacts).projects.map(p => p.id);
  const active = await followupProjects(tx, lease.enterpriseId, binding, true, ids);
  if (active.length !== ids.length || active.some(p => !ids.includes(String(p.id)))) fail('context_changed');
  return { ...context, scope, report, binding };
}
async function projectConversation(tx: PostgresTransaction, lease: Lease, project: ProjectContext) {
  const context = await reportGuard(tx, lease);
  if (!await resolveReportReference(tx, lease.actor, project.selection, project.selection)) fail('context_changed');
  return selectedConversation(context.conversation, project.selection);
}

/** Same Agent, provider dispatcher, KnowledgeRetriever/Evidence and tenant
 * ledger as chat, with a bounded scheduled-task context instead of chat history. */
export async function processReportComposition(lease: Lease, dependencies: {
  retriever?: KnowledgeRetriever;
  model?: (messages: ModelMessage[], tools: ModelTool[], turn: number) => Promise<ModelTurnOutput>;
} = {}) {
  let outcomeKnown = false;
  const scoped = <T>(work: (tx: PostgresTransaction, context: Awaited<ReturnType<typeof reportGuard>>) => Promise<T>) =>
    withTenantTransaction(lease.enterpriseId, async tx => work(tx, await reportGuard(tx, lease)));
  let projects: ProjectContext[] = [];
  try {
    const initial = await scoped(async (tx, context) => {
      const policy = context.run.policy_snapshot as Row;
      const config = agentConfig(policy.agent);
      if (!config) fail('context_changed');
      const reportFinalOutputTokens = boundReportBodyFinal(policy.reportBodyFinal, config);
      const factCoverage = boundReportBodyFactCoverage(policy.reportBodyFactCoverage, reportFinalOutputTokens);
      const reportBodyFinalCarrier = boundReportFinalCarrier(policy.reportBodyFinalCarrier, !!reportFinalOutputTokens, reportFinalOutputTokens);
      const wire = boundReportBodyWire(policy.reportBodyProjectSlots, reportBodyFinalCarrier);
      const reviewGuidance = boundReportGuidanceReview(policy.reportGuidanceReview, wire);
      const projectGuidanceInput = boundReportGuidanceInput(policy.reportGuidanceInput, reviewGuidance);
      const audience = context.binding.audience as FollowupAudience;
      const list: ProjectContext[] = [];
      for (const p of (context.report.facts as ReportFacts).projects) {
        const resolved = await resolveReportReference(tx, lease.actor, { reportId: context.scope.reportId,
          revision: context.scope.revision, bindingId: context.scope.bindingId, projectId: p.id });
        if (!resolved) fail('context_changed');
        const resultKey = `report:${lease.runId}:${p.id}`;
        const snapshot: BusinessSnapshot = { query: { domain: 'construction', leadId: resolved.leadId },
          ...(lease.actor.principal.kind === 'user' ? { customerId: lease.actor.principal.userId } : {}), leadIds: [resolved.leadId],
          version: resolved.selection.factsHash, queriedAt: resolved.selection.cutoffAt,
          reportReference: { selection: resolved.selection, principal: lease.actor.principal },
          data: [{ ...resolved.project, projectId: p.id, leadId: resolved.leadId }],
          displayText: projectGuidanceInput === reportGuidanceTaskProtocol ? reportGuidanceFactText(resolved.selection, resolved.project, audience)
            : reportFactText(resolved.selection, projectGuidanceInput ? reportGuidanceProject(resolved.project, audience) : resolved.project, factCoverage) };
        list.push({ projectId: p.id, selection: resolved.selection,
          context: { version: 1, knowledge: [], snapshots: [snapshot], sources: businessSynthesisSources(resultKey, snapshot) } });
      }
      const checkpoint = await one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq=1000 and kind='agent_checkpoint'`);
      return { config, run: context.run, conversation: context.conversation, projects: list, reportFinalOutputTokens, reportBodyFinalCarrier, wire, reviewGuidance, projectGuidanceInput,
        reportBodyProjectSlots: policy.reportBodyProjectSlots, reportBodyFactCoverage: policy.reportBodyFactCoverage,
        resume: checkpoint?.private_checkpoint as AgentCheckpoint | undefined,
        scope: { ...context.scope, audience, kind: context.report.kind, timezone: 'Asia/Shanghai',
          periodStart: context.report.period_start, periodEnd: context.report.fact_period_end, cutoffAt: context.report.fact_cutoff_at,
          factsGeneratedAt: context.report.generated_at, projectsTruncated: (context.report.facts as ReportFacts).projectsTruncated } };
    });
    projects = initial.projects;
    for (const [index, project] of projects.entries()) {
      const sequence = 800 + index;
      const saved = await scoped(async tx => one(tx, sql`select * from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq=${sequence}`));
      let evidence: Evidence[];
      if (saved) {
        if (saved.status !== 'succeeded' || fingerprint(saved.source_refs) !== fingerprint(project.selection)) fail('retrieval_outcome_unknown', 502);
        evidence = saved.private_checkpoint as Evidence[];
      } else {
        await scoped(async tx => {
          await projectConversation(tx, lease, project);
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,source_refs)
            values(${lease.enterpriseId},${lease.runId},${sequence},'agent_knowledge','knowledge.search.v1',1,'running',${JSON.stringify(project.selection)}::jsonb)`);
        });
        const gateway = embeddingGateway(), operation = `report-query:${lease.runId}:${project.projectId}`;
        const metered = { ...gateway, embed: async (...args: Parameters<typeof gateway.embed>) => {
          await scoped(async tx => tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,measurement_kind)
            values(${lease.enterpriseId},${lease.runId},${operation},'query_embedding','unavailable')`));
          const result = await gateway.embed(...args);
          if (result.usage) await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`update app.assistant_usage_records
            set quantity=${result.usage!.inputTokens},input_tokens=${result.usage!.inputTokens},measurement_kind='observed',updated_at=now(),version=version+1
            where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and operation_key=${operation} and category='query_embedding'`));
          return result;
        } };
        const retriever = dependencies.retriever || conversationKnowledgeRetriever(String(initial.conversation.id), metered,
          { authorize: tx => projectConversation(tx, lease, project) });
        const factProject = initial.projects[index].context.snapshots[0].data as Array<{ stageKey?: string }>;
        evidence = await retriever.retrieve(lease.actor, `施工${initial.scope.kind === 'weekly' ? '周报' : '日报'} ${factProject[0].stageKey || '阶段待确认'} 工艺要求 操作核对 验收注意事项`, Number(initial.run.knowledge_epoch));
        await scoped(async tx => {
          const c = await projectConversation(tx, lease, project);
          for (const e of evidence) if (!await resolveEvidence(tx, lease.actor, c, e)) fail('context_changed');
          await tx.execute(sql`update app.assistant_run_steps set status='succeeded',private_checkpoint=${JSON.stringify(evidence)}::jsonb
            where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${sequence}`);
        });
      }
      const titles = await scoped(async tx => {
        const c = await projectConversation(tx, lease, project), names: Record<string, string> = {};
        for (const e of evidence) {
          const source = await resolveEvidence(tx, lease.actor, c, e);
          if (!source || !String(source.text).includes(e.text)) fail('context_changed');
          names[e.ref.id] = String(source.title);
        }
        return names;
      });
      project.context.knowledge = evidence;
      project.context.sources.push(...knowledgeSynthesisSources(evidence, titles));
    }
    const authorize = () => scoped(async tx => {
      for (const p of projects) if (!await synthesisContextAvailable(tx, lease.actor, await projectConversation(tx, lease, p), p.context)) fail('context_changed');
    });
    const { reportFinalOutputTokens, reportBodyFinalCarrier, wire } = initial;
    const guidanceOnly = initial.projectGuidanceInput === reportGuidanceOnlyProtocol || initial.projectGuidanceInput === reportGuidanceTaskProtocol;
    const guidanceSection = !initial.reviewGuidance ? undefined : guidanceOnly || initial.projectGuidanceInput === reportPendingGuidanceProtocol ? 'pending' : 'arrangements';
    const citationList = wire === 'citation-list';
    const quotedSegments = wire === 'quoted' || citationList;
    const fixedSlots = wire !== 'legacy', flatSegments = wire === 'flat' || quotedSegments;
    const bodyTool = guidanceOnly ? reportGuidanceFinalTool(projects) : reportFinalTool(projects.map(p => p.projectId), projects, fixedSlots);
    const finalTool = flatSegments && !guidanceOnly ? reportFlatFinalTool(projects.length) : bodyTool;
    const canonical = flatSegments && !guidanceOnly ? { projectCount: projects.length, tool: bodyTool, citationList,
      ...(quotedSegments ? { quoteSources: projects.map(p => p.context.sources.filter(source => source.kind === 'knowledge')) } : {}) } : undefined;
    const budget = { profile: initial.config.consultation?.profile,
      ...(reportFinalOutputTokens ? { purpose: 'answer' as const, reportFinalOutputTokens } : {}) };
    const finalAllocation = reportFinalOutputTokens ? { reportBodyFinal: reportBodyFinalProtocol, maxOutputTokens: reportFinalOutputTokens,
      ...(reportBodyFinalCarrier ? { reportBodyFinalCarrier } : {}),
      ...(initial.reportBodyFactCoverage ? { reportBodyFactCoverage: initial.reportBodyFactCoverage } : {}),
      ...(initial.reviewGuidance ? { reportGuidanceReview: reportGuidanceReviewProtocol } : {}),
      ...(initial.projectGuidanceInput ? { reportGuidanceInput: initial.projectGuidanceInput } : {}),
      ...(fixedSlots ? { reportBodyProjectSlots: initial.reportBodyProjectSlots } : {}) } : {};
    async function dispatch(turn: number, messages: ModelMessage[], tool: ModelTool, reviewBinding?: string) {
        const purpose = reviewBinding ? 'grounding' : 'answer';
        const requestBudget = reviewBinding ? { purpose: 'grounding' as const } : budget;
        const limits = agentRequestBudget(requestBudget);
        const allocation = reviewBinding ? { reportGuidanceReview: reportGuidanceReviewProtocol, reviewBinding } : finalAllocation;
        await heartbeat(lease);
        const bounded = fitAgentContext(messages, [tool], requestBudget);
        const requestHash = fingerprint({ messages: bounded.messages, tool, config: initial.config, scope: initial.scope, ...allocation });
        const sequence = 1100 + turn * 10;
        const cached = await scoped(async tx => one(tx, sql`select * from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
          and run_id=${lease.runId} and step_seq=${sequence}`));
        if (cached) {
          if ((cached.input_summary as Row).requestHash !== requestHash) fail('context_changed');
          if (cached.status !== 'succeeded') {
            outcomeKnown = false;
            fail('provider_outcome_unknown', 502);
          }
          outcomeKnown = true;
          const output = cached.private_checkpoint as ModelTurnOutput;
          if (!output.usage) fail('provider_usage_unknown', 502);
          return output;
        }
        const beforeProviderCall = async () => {
          await scoped(async tx => {
          await authorizeSources(tx);
          if (await one(tx, sql`select id from app.assistant_usage_records where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}
            and category='query_embedding' and quantity is null limit 1`)) fail('provider_usage_unknown', 502);
          if (initial.config.consultation) await reserveConsultationDispatch(tx, { enterpriseId: lease.enterpriseId, runId: lease.runId,
            binding: initial.config.consultation, createdAt: String(initial.run.created_at), purpose: 'answer',
            estimatedRequestTokens: consultationRequestReservation(bounded.messages, [tool], limits.maxOutputTokens) });
          else {
            const q = await one(tx, sql`select reserved_tokens from app.assistant_quota_reservations where enterprise_id=${lease.enterpriseId}
              and run_id=${lease.runId} and status='held' for update`);
            const first = reviewBinding ? await one(tx, sql`select input_summary from app.assistant_run_steps
              where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1100 and status='succeeded'`) : null;
            const firstEstimate = (first?.input_summary as { budget?: { after?: { estimatedTokens?: number } } } | undefined)?.budget?.after?.estimatedTokens;
            if (reviewBinding && (!firstEstimate || !Number.isSafeInteger(firstEstimate))) fail('context_changed');
            if (!q || (firstEstimate || 0) + bounded.diagnostic.after.estimatedTokens > Number(q.reserved_tokens)) fail('assistant_quota_exceeded', 429);
          }
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
            values(${lease.enterpriseId},${lease.runId},${sequence},'agent_model','running',${JSON.stringify({ turn, purpose, requestHash,
              protocol: reportCompositionProtocol, scope: initial.scope, budget: bounded.diagnostic, ...allocation })}::jsonb)`);
          await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),updated_at=now() where enterprise_id=${lease.enterpriseId} and id=${lease.jobId}`);
          });
          outcomeKnown = false;
        };
        const packet = dependencies.model ? await (async () => { await beforeProviderCall(); return { attemptId: null,
          agentOutput: await dependencies.model!(bounded.messages, [tool], turn) }; })()
          : await executePostgresText({ enterpriseId: BigInt(lease.enterpriseId), owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
            logicalModelKey: 'chat.general', messages: [], maxTokens: limits.maxOutputTokens,
            agent: { config: initial.config, input: { messages: bounded.messages, tools: [tool], maxTokens: limits.maxOutputTokens,
              requireTool: true, ...(reviewBinding ? { outputMode: 'json_schema' as const } : reportFinalOutputTokens ? {
                outputMode: reportBodyFinalCarrier ? 'function_call' : 'json_schema', reportFinalOutputTokens } : {}),
              ...(initial.config.consultation ? { profile: initial.config.consultation.profile,
                deadlineAt: new Date(String(initial.run.created_at)).getTime() + consultationProfile(initial.config.consultation.profile)!.runTimeoutMs } : {}) } },
            metadata: { promptVersion: reportCompositionProtocol, runtime: initial.config.runtime, turn, purpose, reportId: initial.scope.reportId,
              revision: initial.scope.revision, probeVersion: initial.config.probeVersion, ...allocation }, beforeProviderCall });
        outcomeKnown = true;
        if (!packet.agentOutput) fail('invalid_model_answer', 502);
        const output = packet.agentOutput;
        await withTenantTransaction(lease.enterpriseId, async tx => {
          // Billing evidence survives source/member revocation after dispatch.
          await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
            values(${lease.enterpriseId},${lease.runId},${packet.attemptId ? String(packet.attemptId) : null},${`agent:${lease.runId}:${turn}`},'tokens',
              ${output.usage ? output.usage.inputTokens + output.usage.outputTokens : null},${output.usage ? 'observed' : 'unavailable'},
              ${output.usage?.inputTokens ?? null},${output.usage?.outputTokens ?? null}) on conflict do nothing`);
          if (initial.config.consultation) await settleConsultationDispatch(tx, lease.enterpriseId, lease.runId);
          await tx.execute(sql`update app.assistant_run_steps set status='succeeded',provider_attempt_id=${packet.attemptId ? String(packet.attemptId) : null},
            private_checkpoint=${JSON.stringify(output)}::jsonb where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${sequence} and status='running'`);
        });
        if (!output.usage) fail('provider_usage_unknown', 502);
        return output;
    }
    const result = await runRenovationAgent({ messages: reportMessages(initial.scope, projects, fixedSlots, flatSegments, quotedSegments, guidanceSection, guidanceOnly), tools: [], resume: initial.resume, ports: {
      authorize,
      tool: async () => fail('assistant_capability_forbidden', 403),
      checkpoint: state => scoped(async tx => {
        await authorizeSources(tx);
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint)
          values(${lease.enterpriseId},${lease.runId},1000,'agent_checkpoint','succeeded',${JSON.stringify(state)}::jsonb)
          on conflict(enterprise_id,run_id,step_seq) do update set private_checkpoint=excluded.private_checkpoint`);
      }),
      validateFinal: async raw => { parseReportBody(raw, projects, fixedSlots); return null; },
      model: async (turn, messages) => {
        if (initial.reviewGuidance && turn !== 0) fail('invalid_model_answer', 502);
        const output = await projectReportBodyFinal(await dispatch(turn, messages, finalTool), finalTool, !!reportBodyFinalCarrier, canonical);
        return guidanceOnly ? { ...output, text: projectReportGuidanceOnly(output.text, projects) } : output;
      },
    } });
    const body = parseReportBody(result.output?.text || '', projects, fixedSlots);
    if (guidanceSection) {
      const review = prepareReportGuidanceReview(body, initial.scope.audience, guidanceSection);
      const verdict = await dispatch(1, review.messages, review.tool, review.binding);
      await assertReportGuidanceReview(review, verdict);
      body.guidanceReviewed = guidanceSection === 'pending' ? 'pending' : true;
    }
    await completeReportComposition(lease, async tx => {
      await reportGuard(tx, lease); await authorizeSources(tx);
      await tx.execute(sql`update app.construction_report_versions set body=${JSON.stringify(body)}::jsonb,knowledge_status='ready',body_generated_at=now(),body_error_code=null
        where enterprise_id=${lease.enterpriseId} and report_id=${initial.scope.reportId} and revision=${initial.scope.revision} and body_run_id=${lease.runId}`);
      await tx.execute(sql`update app.construction_report_deliveries set read_at=null where enterprise_id=${lease.enterpriseId}
        and report_id=${initial.scope.reportId} and revision=${initial.scope.revision}`);
    });
    async function authorizeSources(tx: PostgresTransaction) {
      for (const p of projects) if (!await synthesisContextAvailable(tx, lease.actor, await projectConversation(tx, lease, p), p.context)) fail('context_changed');
    }
  } catch (error) {
    const code = error instanceof AssistantError ? error.code : 'model_unavailable';
    await failRun(lease, code, outcomeKnown).catch(() => undefined);
    await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`update app.construction_report_versions v set knowledge_status='failed',body_error_code=r.error_code
      from app.assistant_runs r where v.enterprise_id=${lease.enterpriseId} and v.body_run_id=${lease.runId} and r.enterprise_id=v.enterprise_id
      and r.id=v.body_run_id and r.status in ('failed','indeterminate','cancelled') and v.knowledge_status<>'ready'`)).catch(() => undefined);
  }
}
