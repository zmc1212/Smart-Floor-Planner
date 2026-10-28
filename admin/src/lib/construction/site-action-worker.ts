import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { agentConfig } from '@/lib/assistant/agent/config';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { isSafeProviderFallback } from '@/lib/ai/provider-types';
import { completeRun, failRun, heartbeat, runContext, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { SiteChatService } from './site-chat';
import { proposeSiteAction, siteActionContext, siteActionRequest, siteActionWaiting } from './site-actions';
import { parseSiteAction, siteActionPrompt, siteActionPromptVersion, siteActionTool } from './site-action-contract';

type Model = (messages: ModelMessage[]) => Promise<ModelTurnOutput>;
/** One existing metered model request prepares a proposal, never a business
 * action. The original staff member confirms through the existing chat. */
export async function processSiteAction(lease: Lease, model?: Model) {
  let returned = false;
  const scoped = <T>(work: (tx: Parameters<typeof runContext>[0], c: Row, request: Awaited<ReturnType<typeof siteActionRequest>>, permission: { manage: boolean; write: boolean }) => Promise<T>) =>
    withTenantTransaction(lease.enterpriseId, async tx => {
      const context = await runContext(tx, lease);
      if (context.run.purpose !== 'site.action' || context.conversation.purpose !== 'project_collaboration' || lease.actor.principal.kind !== 'admin') fail('context_changed');
      const request = await siteActionRequest(tx, lease.actor, String(context.conversation.id), lease.runId);
      const service = new SiteChatService({ enterpriseId: lease.enterpriseId, adminId: lease.actor.principal.adminId,
        miniProgramUserId: lease.actor.entry?.miniProgramUserId as string | undefined, miniProgramContextVersion: lease.actor.entry?.miniProgramContextVersion as number | undefined }, tx);
      return service.withWriteScope(request.projectId, (tx, c, _p, permission) => work(tx, c, request, permission));
    });
  try {
    const initial = await scoped(async (tx, c, request, permission) => {
      const context = await runContext(tx, lease), input = await siteActionContext(tx, lease.enterpriseId, request.projectId, request.versions);
      const candidates = { records: input.records.map(r => r.id), issues: input.issues.map(i => i.id), plans: input.plans.map(p => p.id) };
      const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: siteActionPrompt }] },
        { role: 'user', content: [{ type: 'text', text: JSON.stringify({ actorId: lease.actor.principal.kind === 'admin' ? lease.actor.principal.adminId : '',
          originalText: (request.row.content as { blocks: { text?: string }[] }).blocks.map(b => b.text || '').join('\n'), attachmentCount: request.mediaIds.length,
          permissions: { manage: permission.manage }, ...input }) }] }];
      if (Buffer.byteLength(JSON.stringify(messages), 'utf8') > 48000) fail('model_input_limit', 422);
      const cached = await one(tx, sql`select status,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1110`);
      if (cached && (cached.status !== 'succeeded' || (cached.input_summary as Row)?.promptVersion !== siteActionPromptVersion)) fail('provider_outcome_unknown');
      const config = agentConfig((context.run.policy_snapshot as Row).agent); if (!config?.tools) fail('assistant_disabled', 403);
      return { config, messages, candidates, projectId: request.projectId, cached: cached?.private_checkpoint as ModelTurnOutput | undefined };
    });
    await heartbeat(lease);
    const before = () => scoped(async tx => {
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
        values(${lease.enterpriseId},${lease.runId},1110,'agent_model','running',${JSON.stringify({ promptVersion: siteActionPromptVersion })}::jsonb)`);
      await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),updated_at=now() where enterprise_id=${lease.enterpriseId} and id=${lease.jobId}`);
    });
    let attemptId: string | null = null, output = initial.cached;
    if (!output) {
      if (model) { await before(); output = await model(initial.messages); }
      else {
        const result = await executePostgresText({ enterpriseId: BigInt(lease.enterpriseId), owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
          logicalModelKey: 'chat.general', maxTokens: 512, temperature: 0,
          messages: initial.messages.map(m => ({ role: m.role as 'system' | 'user', content: Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : m.content })),
          agent: { config: initial.config, input: { messages: initial.messages, tools: [siteActionTool(initial.candidates)], maxTokens: 512, requireTool: true } },
          metadata: { promptVersion: siteActionPromptVersion, projectId: initial.projectId }, beforeProviderCall: before });
        attemptId = String(result.attemptId); output = result.agentOutput || { text: result.content, toolCalls: [], finishReason: null, providerRequestId: null, usage: null };
      }
      returned = true;
      // Account even if the staff member corrects/cancels or loses access while
      // inference is in flight. Never resend an unknown provider outcome.
      await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
        values(${lease.enterpriseId},${lease.runId},${attemptId},${'run:' + lease.runId},'tokens',${output!.usage ? output!.usage.inputTokens + output!.usage.outputTokens : null},
          ${output!.usage ? 'observed' : 'unavailable'},${output!.usage?.inputTokens ?? null},${output!.usage?.outputTokens ?? null}) on conflict do nothing`));
      await scoped(async tx => { await tx.execute(sql`update app.assistant_run_steps set status='succeeded',provider_attempt_id=${attemptId},private_checkpoint=${JSON.stringify(output)}::jsonb
        where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1110`); });
    } else returned = true;
    const selection = await parseSiteAction(output, initial.candidates);
    await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text: siteActionWaiting }] }, usage: output.usage, attemptId: attemptId || undefined }, async (tx, run, messageId) => {
      if (lease.actor.principal.kind !== 'admin') fail('context_changed');
      const service = new SiteChatService({ enterpriseId: lease.enterpriseId, adminId: lease.actor.principal.adminId,
        miniProgramUserId: lease.actor.entry?.miniProgramUserId as string | undefined, miniProgramContextVersion: lease.actor.entry?.miniProgramContextVersion as number | undefined }, tx);
      await service.withWriteScope(initial.projectId, async (tx, c, _p, permission) => {
        const text = await proposeSiteAction(tx, lease.actor, c, initial.projectId, lease.runId, selection, permission.manage);
        await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify({ version: 1, blocks: [{ type: 'text', text }] })}::jsonb
          where enterprise_id=${lease.enterpriseId} and conversation_id=${String(run.conversation_id)} and id=${messageId}`);
      });
    });
  } catch (error) {
    try { await failRun(lease, error instanceof AssistantError ? error.code : 'site_organization_failed', returned || isSafeProviderFallback(error)); }
    catch (failure) { if (!(failure instanceof AssistantError && failure.code === 'context_changed')) throw failure; }
  }
}
