import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import { AiProviderError } from '@/lib/ai/provider-types';
import { AssistantError, fail, fingerprint, type Evidence, type MessageContent } from '../../contracts';
import { businessSynthesisSources, knowledgeSynthesisSources } from '../../agent/synthesis';
import { synthesisContextAvailable } from '../../agent/synthesis-sources';
import { queryBusiness, type BusinessQuery, type BusinessSnapshot } from '../../agent/business-tools';
import { guardAnswerCommitments } from '../../agent/context';
import { saveKnowledgeCitation } from '../../knowledge/save-citation';
import { retrieveKnowledge } from '../../knowledge/retrieval';
import { embeddingGateway } from '../../infrastructure/embedding-gateway';
import { completeRun, failRun, heartbeat, markProviderStarted, runContext, type Lease } from '../../infrastructure/job-queue';
import { fastGPTAgentV2Configuration, fastGPTAgentV2Protocol } from './config';
import { resolveSuggestions, type SuggestionResolution } from './suggestions';
import { fastGPTWorkflows } from '../runtime';
import type { AgentV2ToolInput, AgentV2Usage } from './runtime';
import { nativeConversation } from '../rag-session';
import { ragAnswerParts, type RagCitationSource } from '../native-rag';
import { nativeCites } from '../native-cites';

const citationId = (chunkId: string) => 'K' + chunkId;
const quoteOf = (text: string) => Array.from(text).length > 600 ? Array.from(text).slice(0, 600).join('') : text;

/** FastGPT Agent V2 orchestrates the conversation and model calls. XiaoK keeps
 * the authorized enterprise search behind the HTTP tool, CITE persistence,
 * durable run state and usage receipts. */
export async function processAgentV2Answer(lease: Lease) {
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const bound = fastGPTAgentV2Configuration(lease.enterpriseId);
    if (!bound) fail('context_changed');
    const authorize = () => withTenantTransaction(lease.enterpriseId, async tx => {
      const state = await runContext(tx, lease), policy = state.run.policy_snapshot as Row;
      if ((policy.agentRuntime as Row)?.protocol !== fastGPTAgentV2Protocol || (policy.agentRuntime as Row)?.binding !== bound.binding
        || fastGPTAgentV2Configuration(lease.enterpriseId)?.binding !== bound.binding || lease.actor.principal.kind !== 'user'
        || state.conversation.purpose !== 'customer_consultation' || state.run.purpose !== 'reply') fail('context_changed');
      return state;
    });
    await authorize();
    const workflows = fastGPTWorkflows();
    if (!workflows?.agentV2) fail('context_changed');
    await workflows.ready();
    if (workflows.agentV2.busy()) fail('conversation_busy');
    const { context, messages } = await nativeConversation(lease, [], fastGPTAgentV2Protocol);
    const catalog = new Map<string, RagCitationSource>();
    const guard = async () => {
      await authorize();
      await withTenantTransaction(lease.enterpriseId, async tx => {
        const state = await runContext(tx, lease);
        if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
      });
    };
    const searches = new Map<string, Promise<Record<string, unknown>>>();
    const search = async (query: string, sequence: number): Promise<Record<string, unknown>> => {
      const state = await authorize();
      const operation = 'agent-v2-query:' + lease.runId + ':' + sequence;
      await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records
        (enterprise_id,run_id,operation_key,category,measurement_kind) values(${lease.enterpriseId},${lease.runId},${operation},'query_embedding','unavailable')`));
      const gateway = embeddingGateway();
      const metered = { ...gateway, embed: async (...args: Parameters<typeof gateway.embed>) => {
        const result = await gateway.embed(...args);
        if (result.usage) await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`update app.assistant_usage_records
          set quantity=${result.usage!.inputTokens},input_tokens=${result.usage!.inputTokens},measurement_kind='observed',updated_at=now(),version=version+1
          where enterprise_id=${lease.enterpriseId} and operation_key=${operation} and category='query_embedding'`));
        return result;
      } };
      const retrieved = await retrieveKnowledge(String(state.conversation.id), lease.actor, query, Number(state.run.knowledge_epoch), metered);
      const evidence = retrieved.evidence;
      const sources: RagCitationSource[] = evidence.map(e => ({ nativeId: citationId(e.ref.id), sourceId: citationId(e.ref.id),
        quote: quoteOf(e.text), evidence: e }));
      for (const s of sources) catalog.set(s.nativeId, s);
      context.knowledge.push(...evidence); context.sources.push(...knowledgeSynthesisSources(evidence));
      await withTenantTransaction(lease.enterpriseId, async tx => {
        const current = await runContext(tx, lease);
        if (!await synthesisContextAvailable(tx, lease.actor, current.conversation, context)) fail('context_changed');
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,source_refs,private_checkpoint,input_summary)
          values(${lease.enterpriseId},${lease.runId},${1300 + sequence},'retrieval','knowledge.search.v1',1,'succeeded',
            ${JSON.stringify(evidence.map(e => ({ ref: e.ref, hash: e.hash })))}::jsonb,${JSON.stringify(evidence)}::jsonb,
            ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, tool: 'search_enterprise', query,
              candidates: retrieved.diagnostic.candidates.length, selected: evidence.length })}::jsonb)`);
      });
      return { status: evidence.length ? 'ready' : 'empty', kind: 'enterprise',
        ...(evidence.length ? nativeCites(sources.map(s => ({ id: s.nativeId, sourceName: '企业工艺｜PPT原文', content: s.quote! }))) : {}) };
    };
    const delivered: BusinessSnapshot[] = [];
    const businesses = new Map<string, Promise<Record<string, unknown>>>();
    const business = async (query: BusinessQuery, sequence: number): Promise<Record<string, unknown>> => {
      const key = query.domain + ':' + query.leadId;
      let pending = businesses.get(key);
      if (!pending) {
        pending = (async () => {
          await authorize();
          const { snapshot, selected } = await withTenantTransaction(lease.enterpriseId, async tx => {
            const current = await runContext(tx, lease);
            if (!await synthesisContextAvailable(tx, lease.actor, current.conversation, context)) fail('context_changed');
            const entry = current.conversation.entry_snapshot as Row;
            const boundLead = entry.kind === 'lead' ? String(entry.id) : '';
            if (boundLead && query.leadId && query.leadId !== boundLead) fail('assistant_resource_not_found', 404);
            const scoped: BusinessQuery = { ...query, leadId: boundLead || query.leadId };
            const snapshot = await queryBusiness(tx, lease.actor, scoped, String(current.conversation.id));
            const selected = Array.isArray(snapshot.data) ? snapshot.data.length : 0;
            if (scoped.domain === 'construction') for (const project of snapshot.data as Row[])
              await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id)
                values(${lease.enterpriseId},${String(project.projectId)},${String(current.conversation.id)}) on conflict do nothing`);
            await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,private_checkpoint,input_summary)
              values(${lease.enterpriseId},${lease.runId},${1400 + sequence},'agent_tool','query_business',1,'succeeded',
                ${JSON.stringify(snapshot)}::jsonb,
                ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, tool: 'query_business', domain: scoped.domain,
                  leadId: scoped.leadId, selected })}::jsonb)`);
            return { snapshot, selected };
          });
          delivered.push(snapshot);
          // The synthesis guard revalidates every snapshot version before delivery.
          context.snapshots.push(snapshot);
          context.sources.push(...businessSynthesisSources('F1:' + lease.runId + ':' + sequence, snapshot));
          return { status: selected ? 'ready' : 'empty', resultKey: snapshot.version, text: snapshot.displayText };
        })();
        businesses.set(key, pending);
      }
      return pending;
    };
    const tool = async (input: AgentV2ToolInput, sequence: number) => {
      if (input.name === 'query_business') return business(input, sequence);
      let pending = searches.get(input.query);
      if (!pending) { pending = search(input.query, sequence); searches.set(input.query, pending); }
      return pending;
    };
    await heartbeat(lease);
    await markProviderStarted(lease);
    timer = setInterval(() => { heartbeat(lease).catch(() => undefined); }, 30000);
    const result = await workflows.agentV2.run(messages, { authorize: guard, tool });
    await guard();
    for (const key of ['knowledge', 'snapshots', 'sources'] as const)
      (context[key] as unknown[]) = [...new Map((context[key] as unknown[]).map(v => [fingerprint(v), v])).values()];
    // Business facts are delivered from the authorized snapshot, never from
    // free-form prose; the model's draft stays in the audit step.
    const businessText = delivered.map(s => s.displayText).join('\n');
    const text = businessText || result.text;
    if (!businessText) guardAnswerCommitments(text);
    // Follow-up questions are ancillary: a provider or parsing failure keeps
    // the delivered answer and falls back to the configured presets.
    let suggestions: SuggestionResolution = resolveSuggestions(null, bound.configuration.presets ?? []);
    let suggestionsAttempted = false, suggestionUsage: AgentV2Usage | null = null;
    if (bound.configuration.suggestionAppId) {
      suggestionsAttempted = true;
      try {
        const generated = await workflows.agentV2.suggest(text);
        suggestionUsage = generated.usage;
        suggestions = resolveSuggestions(generated.text, bound.configuration.presets ?? []);
      } catch { /* presets remain the honest fallback */ }
    }
    if (suggestionsAttempted || suggestions.questions.length)
      await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records
        (enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
        values(${lease.enterpriseId},${lease.runId},${'agent-v2-suggest:' + lease.runId},'suggestion_tokens',
        ${suggestionUsage ? suggestionUsage.inputTokens + suggestionUsage.outputTokens : null},${suggestionUsage ? 'observed' : 'unavailable'},
        ${suggestionUsage?.inputTokens ?? null},${suggestionUsage?.outputTokens ?? null}) on conflict do nothing`));
    const parts = ragAnswerParts(text, [...catalog.values()]);
    await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text }] }, usage: result.usage }, async (tx, run, messageId) => {
      const state = await runContext(tx, lease);
      if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
      const blocks: MessageContent['blocks'] = [], saved = new Map<string, string>();
      for (const p of parts) {
        if ('text' in p) { blocks.push({ type: 'text', text: p.text }); continue; }
        const e: Evidence = p.source.evidence;
        let citation = saved.get(p.source.nativeId);
        if (!citation) {
          citation = await saveKnowledgeCitation(tx, lease.actor, state.conversation, lease.runId, messageId, e, p.source.quote || e.text);
          saved.set(p.source.nativeId, citation);
        }
        blocks.push({ type: 'citation', citationId: citation, fallbackText: '知识来源' });
      }
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs,private_checkpoint,input_summary)
        values(${lease.enterpriseId},${lease.runId},1006,'agent_synthesis_context','succeeded',${JSON.stringify(context)}::jsonb,
          ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, raw: result.text, citations: [...catalog.values()] })}::jsonb,
          ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, runtime: 'fastgpt-agent-v2' })}::jsonb)`);
      if (suggestionsAttempted || suggestions.questions.length)
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint,input_summary)
          values(${lease.enterpriseId},${lease.runId},1007,'agent_suggestions','succeeded',
            ${JSON.stringify({ questions: suggestions.questions, source: suggestions.source })}::jsonb,
            ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, runtime: 'fastgpt-agent-v2', generated: suggestions.source === 'model' })}::jsonb)`);
      await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify({ version: 1, blocks })}::jsonb,
        answer_kind=${saved.size ? 'grounded' : null} where enterprise_id=${lease.enterpriseId} and id=${messageId}`);
      await tx.execute(sql`update app.assistant_runs set answer_kind=${saved.size ? 'grounded' : null} where enterprise_id=${lease.enterpriseId} and id=${String(run.id)}`);
    });
  } catch (error) {
    const known = error instanceof AssistantError || error instanceof AiProviderError && !['accepted', 'unknown'].includes(error.disposition);
    await failRun(lease, error instanceof AssistantError || error instanceof AiProviderError ? error.code : 'fastgpt_workflow_unavailable', known);
  } finally { if (timer) clearInterval(timer); }
}
