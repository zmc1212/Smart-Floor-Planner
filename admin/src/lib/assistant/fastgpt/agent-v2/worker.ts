import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import { AiProviderError } from '@/lib/ai/provider-types';
import { AssistantError, fail, fingerprint, type Evidence, type MessageContent } from '../../contracts';
import { synthesisContextAvailable } from '../../agent/synthesis-sources';
import type { BusinessSnapshot } from '../../agent/business-tools';
import { guardAnswerCommitments } from '../../agent/context';
import { dialogueBusinessQuery, dialogueEnterpriseSearch, quoteOf, snapshotHeading, type DialogueToolRuntime } from '../../agent/dialogue-tools';
import { dialogueWebResearch, type WebToolRuntime } from '../../agent/dialogue-web-tools';
import { dialogueDesignerRecommendation, dialoguePublicSitesRecommendation, publicSitesDelivery,
  type RecommendToolRuntime } from '../../agent/dialogue-recommend-tools';
import { saveKnowledgeCitation } from '../../knowledge/save-citation';
import { completeRun, enterpriseConcurrency, failRun, heartbeat, markProviderStarted, runContext, type Lease } from '../../infrastructure/job-queue';
import { fastGPTAgentV2Configuration, fastGPTAgentV2Protocol } from './config';
import { resolveSuggestions, type SuggestionResolution } from './suggestions';
import { fastGPTWorkflows } from '../runtime';
import type { AgentV2ToolInput, AgentV2Usage } from './runtime';
import { nativeConversation } from '../rag-session';
import { ragAnswerParts, type RagCitationSource, type RagPart } from '../native-rag';
import { webAnswerQuoteSpans } from '../../agent/web-evidence';
import { openingScene, sceneForOpeningPurpose } from './openings';
import { publicIntroFacts, publicIntroPrompt, validatePublicIntro } from '@/lib/construction/public-intro';
import { publishedPublicMaterial } from '@/lib/construction/public-read';
import type { PublicContent } from '@/lib/construction/public-contract';

// The public-site wordings moved to the shared recommendation module; the
// gateway contract still exposes them from here.
export { nearbyPublicSitesText, nearbyPublicSitesReceipt, publicSitesDeliveryText } from '../../agent/dialogue-recommend-tools';

/** Authorized business snapshots stay authoritative. A cited model answer may
 * accompany them; an uncited or rejected draft never replaces them. Knowledge
 * evidence retrieved in this turn without any model CITE fails closed instead
 * of shipping a source answer that carries no verifiable citation. */
export function composeAgentV2Delivery(modelText: string, snapshotText: string, modelCitations: number, knowledgeRetrieved: boolean, webRetrieved = false) {
  if (!snapshotText) {
    if (!modelCitations && (knowledgeRetrieved || webRetrieved)) fail('missing_citation', 502);
    guardAnswerCommitments(modelText);
    return { text: modelText, modelIncluded: true };
  }
  if (!modelCitations || !modelText.trim()) return { text: snapshotText, modelIncluded: false };
  try { guardAnswerCommitments(modelText); }
  catch (error) {
    if (!(error instanceof AssistantError) || error.code !== 'unsupported_model_commitment') throw error;
    return { text: snapshotText, modelIncluded: false };
  }
  return { text: `${modelText}\n\n${snapshotHeading}\n${snapshotText}`, modelIncluded: true };
}

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
        || state.conversation.purpose !== 'customer_consultation'
        || !['reply', 'public.site.intro'].includes(String(state.run.purpose))) fail('context_changed');
      return state;
    });
    const initial = await authorize();
    const workflows = fastGPTWorkflows();
    if (!workflows?.agentV2) fail('context_changed');
    await workflows.ready();
    // An opening is a system event, not a conversation turn: no history, no
    // tools, no ticket. It never takes the single bridge slot away from a
    // customer's reply.
    if (String(initial.run.purpose) !== 'reply') {
      const sceneKey = sceneForOpeningPurpose(String(initial.run.purpose));
      const scene = sceneKey ? openingScene(lease.enterpriseId, sceneKey) : undefined;
      if (!scene) fail('context_changed');
      const ref = (initial.conversation.entry_snapshot as Row).activePublicSite as { siteId: string; versionId: string } | undefined;
      if (!ref) fail('context_changed');
      const content = await withTenantTransaction(lease.enterpriseId, async tx => {
        const material = await publishedPublicMaterial(tx, lease.enterpriseId, ref.siteId, String(ref.versionId));
        if (!material) fail('public_site_unavailable', 404);
        return material.version.content as PublicContent;
      });
      await markProviderStarted(lease);
      const result = await workflows.agentV2.intro(lease.enterpriseId, scene.appId, publicIntroFacts(content, scene.input),
        publicIntroPrompt(scene.constraints.maxChars));
      if (scene.constraints.noCommitments) guardAnswerCommitments(result.text);
      const text = validatePublicIntro(result.text, scene.constraints);
      await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records
        (enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
        values(${lease.enterpriseId},${lease.runId},${'agent-v2-intro:' + lease.runId},'intro_tokens',
        ${result.usage ? result.usage.inputTokens + result.usage.outputTokens : null},${result.usage ? 'observed' : 'unavailable'},
        ${result.usage?.inputTokens ?? null},${result.usage?.outputTokens ?? null}) on conflict do nothing`));
      await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text }] }, usage: result.usage }, async tx => {
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
          values(${lease.enterpriseId},${lease.runId},1006,'agent_intro','succeeded',
            ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, scene: scene.key, chars: Array.from(text).length })}::jsonb)`);
      });
      return;
    }
    // The queue owns the per-enterprise limit. This guard only keeps the
    // default single-slot contract for callers outside the queue.
    if (enterpriseConcurrency() === 1 && workflows.agentV2.busy(lease.enterpriseId)) fail('conversation_busy');
    const { context, messages, citations } = await nativeConversation(lease, [], fastGPTAgentV2Protocol);
    // Prior answers keep their still-authorized sources citable, matching the
    // unified worker; only this turn's retrieval sets knowledgeRetrieved.
    const catalog = new Map<string, RagCitationSource>(citations.map(c => [c.nativeId, c]));
    const guard = async () => {
      await authorize();
      await withTenantTransaction(lease.enterpriseId, async tx => {
        const state = await runContext(tx, lease);
        if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
      });
    };
    let knowledgeRetrieved = false;
    const delivered: BusinessSnapshot[] = [];
    // The six authorized tools are shared with the XiaoK native executor; this
    // bridge only differs in its protocol tag and its authorize port.
    const toolRuntime: DialogueToolRuntime = { lease, protocol: fastGPTAgentV2Protocol, authorize, context, catalog,
      messages, markKnowledgeRetrieved: () => { knowledgeRetrieved = true; }, delivered };
    const search = dialogueEnterpriseSearch(toolRuntime);
    const business = dialogueBusinessQuery(toolRuntime);
    let webRetrieved = false;
    // The web/designer/public-site tools are the shared factories; this bridge
    // only differs in its protocol tag, its authorize port and the 120s
    // research deadline that the factories default to.
    const webRt: WebToolRuntime = { lease, protocol: fastGPTAgentV2Protocol, authorize, context, catalog, messages,
      markWebRetrieved: () => { webRetrieved = true; } };
    const web = dialogueWebResearch(webRt);
    const recommendRt: RecommendToolRuntime = { lease, protocol: fastGPTAgentV2Protocol, authorize, context, messages };
    const designers = dialogueDesignerRecommendation(recommendRt);
    const sites = dialoguePublicSitesRecommendation(recommendRt);
    const tool = async (input: AgentV2ToolInput, sequence: number) => {
      if (input.name === 'query_business') return business(input, sequence);
      if (input.name === 'search_web' || input.name === 'read_web') return web(input, sequence);
      if (input.name === 'recommend_designers') return designers();
      if (input.name === 'recommend_public_sites') return sites.call();
      return search(input.query, sequence);
    };
    await heartbeat(lease);
    await markProviderStarted(lease);
    timer = setInterval(() => { heartbeat(lease).catch(() => undefined); }, 30000);
    const result = await workflows.agentV2.run(lease.enterpriseId, messages, { authorize: guard, tool }, { runId: lease.runId });
    await guard();
    for (const key of ['knowledge', 'snapshots', 'sources'] as const)
      (context[key] as unknown[]) = [...new Map((context[key] as unknown[]).map(v => [fingerprint(v), v])).values()];
    const snapshotText = delivered.map(s => s.displayText).join('\n');
    let modelParts: RagPart[] | null = null;
    if (result.text.trim()) {
      try { modelParts = ragAnswerParts(result.text, [...catalog.values()]); }
      catch (error) { if (!snapshotText) throw error; }
    }
    const modelCitations = modelParts?.filter(part => 'source' in part).length ?? 0;
    const composed = publicSitesDelivery(
      composeAgentV2Delivery(result.text, snapshotText, modelCitations, knowledgeRetrieved, webRetrieved), sites.outcome());
    const text = composed.text, modelIncluded = composed.modelIncluded;
    // Follow-up questions are ancillary: a provider or parsing failure keeps
    // the delivered answer and falls back to the configured presets.
    let suggestions: SuggestionResolution = resolveSuggestions(null, bound.configuration.presets ?? []);
    let suggestionsAttempted = false, suggestionUsage: AgentV2Usage | null = null;
    if (bound.configuration.suggestionAppId) {
      suggestionsAttempted = true;
      try {
        const generated = await workflows.agentV2.suggest(lease.enterpriseId, text, { runId: lease.runId });
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
    const cited = [...catalog.values()].filter(c => parts.some(p => 'source' in p && p.source.nativeId === c.nativeId));
    const segments: Array<{ basis: 'advice' | 'evidence'; text: string; citations: Array<{ sourceId: string; quote: string }> }> = [];
    for (const p of parts) {
      if ('text' in p) { segments.push({ basis: 'advice', text: p.text, citations: [] }); continue; }
      const segment = segments.at(-1); if (!segment) fail('invalid_model_answer', 502);
      segment.basis = 'evidence';
      segment.citations.push({ sourceId: p.source.sourceId || 'K' + p.source.evidence.ref.id, quote: p.source.quote || p.source.evidence.text });
    }
    await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text }] }, usage: result.usage }, async (tx, run, messageId) => {
      const state = await runContext(tx, lease);
      if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
      const blocks: MessageContent['blocks'] = [], saved = new Map<string, string>();
      for (const p of parts) {
        if ('text' in p) { blocks.push({ type: 'text', text: p.text }); continue; }
        const e: Evidence = p.source.evidence;
        let citation = saved.get(p.source.nativeId);
        if (!citation) {
          if (e.ref.type === 'web_page') {
            const webSources = context.sources.filter(s => s.kind === 'web'), index = webSources.findIndex(s => s.sourceId === p.source.sourceId);
            const span = index >= 0 && index <= 31
              ? webAnswerQuoteSpans({ kind: 'synthesis', segments }, webSources[index]).find(s => s.selectedQuotes.includes(p.source.quote!)) : undefined;
            if (!span) fail('invalid_model_citation', 502);
            citation = `w:${lease.runId}:${index}` + (span.part === undefined ? '' : ':' + span.part);
          } else citation = await saveKnowledgeCitation(tx, lease.actor, state.conversation, lease.runId, messageId, e, p.source.quote || e.text);
          saved.set(p.source.nativeId, citation);
        }
        blocks.push({ type: 'citation', citationId: citation, fallbackText: e.ref.type === 'web_page' ? '网页来源' : '知识来源' });
      }
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs,private_checkpoint,input_summary)
        values(${lease.enterpriseId},${lease.runId},1006,'agent_synthesis_context','succeeded',${JSON.stringify(context)}::jsonb,
          ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, kind: 'synthesis', segments, raw: result.text, citations: cited,
            composition: { snapshots: delivered.length, modelCitations, modelIncluded } })}::jsonb,
          ${JSON.stringify({ protocol: fastGPTAgentV2Protocol, runtime: 'fastgpt-agent-v2',
            skills: bound.configuration.skills?.enabled ?? [], skillPack: bound.configuration.skills?.version ?? null })}::jsonb)`);
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
