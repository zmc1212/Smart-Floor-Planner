import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { type Row } from '@/db/repositories/assistant-repository';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { AiProviderError } from '@/lib/ai/provider-types';
import { AssistantError, fail, type MessageContent } from '../contracts';
import { agentConfig } from '../agent/config';
import { knowledgeSynthesisSources } from '../agent/synthesis';
import { synthesisContextAvailable } from '../agent/synthesis-sources';
import { resolveEvidence } from '../knowledge/sources';
import { saveKnowledgeCitation } from '../knowledge/save-citation';
import { completeRun, failRun, heartbeat, markProviderStarted, recordRunUsage, runContext, type Lease } from '../infrastructure/job-queue';
import { fastGPTRagConfiguration, fastGPTRagProtocol, type RagSource } from './rag-config';
import { fastGPTWorkflows } from './runtime';
import { nativeConversation } from './rag-session';
import { processUnifiedAnswer } from './unified-worker';

export async function processNativeRagAnswer(lease: Lease) {
  let returned = false, attemptId: string | undefined;
  try {
    const bound = fastGPTRagConfiguration(lease.enterpriseId);
    if (!bound) fail('context_changed');
    // Earlier queued dataset runs may predate the admission guard. Their
    // workflow cannot bind a selected site to its model response.
    const { conversation } = await withTenantTransaction(lease.enterpriseId, tx => runContext(tx, lease));
    if ((conversation.entry_snapshot as Row).activePublicSite) fail('context_changed');
    if (bound.configuration.mode === 'unified') return await processUnifiedAnswer(lease, bound);
    const authorize = () => withTenantTransaction(lease.enterpriseId, async tx => {
      const state = await runContext(tx, lease), policy = state.run.policy_snapshot as Row;
      if ((policy.nativeRag as Row)?.protocol !== fastGPTRagProtocol || (policy.nativeRag as Row)?.binding !== bound.binding
        || fastGPTRagConfiguration(lease.enterpriseId)?.binding !== bound.binding || lease.actor.principal.kind !== 'user'
        || state.conversation.purpose !== 'customer_consultation' || state.run.purpose !== 'reply') fail('context_changed');
      // The fixed native dataset is all-or-nothing at admission. The native
      // search-result callback rechecks every actual candidate before the LLM.
      for (const s of bound.configuration.sources) {
        const row = await resolveEvidence(tx, lease.actor, state.conversation, s.evidence);
        if (!row || !String(row.text).includes(s.evidence.text) || !s.q.includes(s.evidence.text)) fail('context_changed');
      }
      return state;
    });
    const initial = await authorize(), config = agentConfig((initial.run.policy_snapshot as Row).agent);
    if (!config || config.model !== bound.configuration.model || config.providerKey !== 'dashscope') fail('context_changed');
    const { context, messages } = await nativeConversation(lease, bound.configuration.sources);
    const workflows = fastGPTWorkflows();
    if (!workflows?.rag) fail('context_changed');
    await workflows.ready(); await heartbeat(lease);
    // Native search invokes the paid embedding provider first. Reserve and mark
    // before any workflow I/O; unknown search/model outcomes must not auto-retry.
    await markProviderStarted(lease, bound.configuration.sources.map(s => s.evidence));
    await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records
      (enterprise_id,run_id,operation_key,category,measurement_kind) values(${lease.enterpriseId},${lease.runId},${'rag-query:' + lease.runId},'query_embedding','unavailable')`));
    const result = await workflows.rag.run(messages, {
      authorize: async () => { await authorize(); await heartbeat(lease);
        await withTenantTransaction(lease.enterpriseId, async tx => {
          const state = await runContext(tx, lease);
          if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
        });
      },
      sources: async (sources: RagSource[]) => {
        await authorize();
        await withTenantTransaction(lease.enterpriseId, async tx => {
          const { conversation } = await runContext(tx, lease);
          for (const source of sources) if (!await resolveEvidence(tx, lease.actor, conversation, source.evidence)) fail('context_changed');
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,source_refs,private_checkpoint,input_summary)
            values(${lease.enterpriseId},${lease.runId},1000,'retrieval','knowledge.search.v1',1,'succeeded',
              ${JSON.stringify(sources.map(s => ({ ref: s.evidence.ref, hash: s.evidence.hash })))}::jsonb,${JSON.stringify(sources.map(s => s.evidence))}::jsonb,
              ${JSON.stringify({ protocol: fastGPTRagProtocol, model: bound.configuration.embeddingModel })}::jsonb) on conflict do nothing`);
        });
      },
      model: async input => {
        const output = await executePostgresText({ enterpriseId: BigInt(lease.enterpriseId), owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
          logicalModelKey: 'chat.general', messages: [], maxTokens: input.maxTokens,
          metadata: { protocol: fastGPTRagProtocol, turn: 0 }, beforeProviderCall: async () => { await authorize(); },
          agent: { config, input: { ...input, tools: [] } } });
        returned = true; attemptId = String(output.attemptId);
        if (!output.agentOutput) fail('invalid_model_answer', 502);
        await withTenantTransaction(lease.enterpriseId, async tx => {
          await recordRunUsage(tx, lease, { attemptId, usage: output.agentOutput!.usage });
          await tx.execute(sql`insert into app.assistant_run_steps
          (enterprise_id,run_id,step_seq,kind,status,provider_attempt_id,private_checkpoint) values
          (${lease.enterpriseId},${lease.runId},1001,'fastgpt_rag_model','succeeded',${attemptId},${JSON.stringify({ input, output: output.agentOutput })}::jsonb)`);
        });
        return output.agentOutput;
      },
      checkpoint: packet => withTenantTransaction(lease.enterpriseId, async tx => {
        await tx.execute(sql`insert into app.assistant_run_steps
          (enterprise_id,run_id,step_seq,kind,status,private_checkpoint) values(${lease.enterpriseId},${lease.runId},1002,'fastgpt_rag_response','succeeded',${JSON.stringify(packet)}::jsonb)`);
        const steps = (packet as { responseData?: Array<{ moduleType: string; embeddingTokens?: number }> })?.responseData;
        const search = steps?.filter(s => s.moduleType === 'datasetSearchNode');
        if (search?.length === 1 && Number.isSafeInteger(search[0].embeddingTokens) && search[0].embeddingTokens! >= 0) {
          await tx.execute(sql`update app.assistant_usage_records set quantity=${search[0].embeddingTokens},input_tokens=${search[0].embeddingTokens},measurement_kind='observed'
            where enterprise_id=${lease.enterpriseId} and operation_key=${'rag-query:' + lease.runId} and category='query_embedding'`);
        }
      }),
    });
    const evidence = result.sources.map(s => s.evidence);
    context.knowledge.push(...evidence); context.sources.push(...knowledgeSynthesisSources(evidence));
    await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text: result.text }] }, usage: result.output.usage, attemptId }, async (tx, run, messageId) => {
      const state = await runContext(tx, lease);
      if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
      const blocks: MessageContent['blocks'] = [], saved = new Map<string, string>();
      for (const part of result.parts) {
        if ('text' in part) { blocks.push({ type: 'text', text: part.text }); continue; }
        const e = part.source.evidence;
        let citationId = saved.get(e.ref.id);
        if (!citationId) { citationId = await saveKnowledgeCitation(tx, lease.actor, state.conversation, lease.runId, messageId, e, e.text); saved.set(e.ref.id, citationId); }
        blocks.push({ type: 'citation', citationId, fallbackText: '知识来源' });
      }
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs,private_checkpoint,input_summary)
        values(${lease.enterpriseId},${lease.runId},1006,'agent_synthesis_context','succeeded',${JSON.stringify(context)}::jsonb,
          ${JSON.stringify({ raw: result.text, sources: result.sources.map(s => s.nativeId) })}::jsonb,${JSON.stringify({ protocol: fastGPTRagProtocol })}::jsonb)`);
      await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify({ version: 1, blocks })}::jsonb,
        answer_kind=${saved.size ? 'grounded' : null} where enterprise_id=${lease.enterpriseId} and id=${messageId}`);
      await tx.execute(sql`update app.assistant_runs set answer_kind=${saved.size ? 'grounded' : null} where enterprise_id=${lease.enterpriseId} and id=${String(run.id)}`);
      if (result.embeddingTokens !== null) await tx.execute(sql`update app.assistant_usage_records set quantity=${result.embeddingTokens},input_tokens=${result.embeddingTokens},measurement_kind='observed'
        where enterprise_id=${lease.enterpriseId} and operation_key=${'rag-query:' + lease.runId} and category='query_embedding'`);
    });
  } catch (error) {
    const known = returned || error instanceof AssistantError || error instanceof AiProviderError && !['accepted','unknown'].includes(error.disposition);
    await failRun(lease, error instanceof AssistantError || error instanceof AiProviderError ? error.code : 'fastgpt_workflow_unavailable', known);
  }
}
