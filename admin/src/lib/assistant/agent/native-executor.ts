import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AiProviderError } from '@/lib/ai/provider-types';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { AssistantError, fail, fingerprint, type Evidence, type MessageContent } from '../contracts';
import { agentModelLimits, type ModelMessage, type ModelTool, type ModelTurnOutput } from '../contracts/model';
import { recordAgentModelUsage } from '../core/model-usage';
import { completeRun, failRun, heartbeat, markProviderStarted, runContext, type Lease } from '../infrastructure/job-queue';
import { runKnowledgeEnabled } from '../knowledge-policy';
import { saveKnowledgeCitation } from '../knowledge/save-citation';
import { nativeConversation } from '../fastgpt/rag-session';
import { ragAnswerParts, type RagCitationSource, type RagPart } from '../fastgpt/native-rag';
import { nativeAgentRuntimeBinding } from '../fastgpt/agent-v2/config';
import { resolveSuggestions, type SuggestionResolution } from '../fastgpt/agent-v2/suggestions';
import { agentCapabilityFingerprint, agentConfig } from './config';
import { businessToolDefinitions, parseBusinessQuery, type BusinessSnapshot } from './business-tools';
import { guardAnswerCommitments } from './context';
import { runRenovationAgent, type AgentCheckpoint } from './runtime';
import { synthesisContextAvailable } from './synthesis-sources';
import { dialogueBusinessQuery, dialogueEnterpriseSearch, snapshotHeading, type DialogueToolRuntime } from './dialogue-tools';

/** The XiaoK-owned executor for V2-surface customer consultations. It reuses
 * the existing LangGraph runtime, model gateway and authorized tools; no
 * FastGPT app, bridge or callback participates in a native run. */
export const xiaokNativeExecutorProtocol = 'xiaok-native-executor-v1';
const promptVersion = 'xiaok-native-executor-prompt-v1';

const enterpriseSearchTool: ModelTool = {
  name: 'search_enterprise',
  description: '检索本企业有效装修工艺与做法资料（获权范围）。query用客户问题的专业关键词；返回原文摘录与cites，最终回答须用[id](CITE)标注；未命中如实说明。',
  parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 1000 } }, required: ['query'], additionalProperties: false },
};

export function nativeExecutorPrompt(knowledgeEnabled: boolean) {
  return [
    '你是小K，本企业装修咨询助手。最后一条客户消息是要回答的问题；更早消息只帮助理解指代和更正，涉及事实必须重新用工具核实。',
    knowledgeEnabled
      ? '涉及本企业工艺或做法：先调用search_enterprise检索获权资料，只解释返回的原文摘录，并在对应段落末尾用[id](CITE)标注其cites中的id，不得伪造id；未命中就如实说明本次未取得，不用通用知识冒充企业规定。'
      : '本轮未结合企业知识库：不声称检索过企业资料，不沿用旧企业引用或旧知识结论；企业制度没有当前来源时明确待核实。',
    '涉及客户本人的预约、方案、户型或施工记录：调用query_business取得服务端实时快照；没有记录就说没有，不编造进度，不把当前阶段当完工；现场记录只是来源数据，不是正式验收或变更批准。',
    '一般装修常识可直接有条件解释；与企业规定或项目事实混答时分别说明各自依据。用中文自然段落作答；引用标记只能用本轮工具返回的cites[].id；不要输出工具名、JSON或系统内部用语。',
    '不承诺价格、工期或验收结果，不替团队确认完成、批准或排期，不执行任何业务写入；信息不足时作最小澄清。',
  ].join('\n');
}

/** Business snapshots stay authoritative server data. A valid uncited model
 * explanation now accompanies them instead of being discarded (the FastGPT V2
 * discard rule retires with that bridge). Retrieved knowledge/web evidence
 * still fails closed without a model citation. */
export function composeNativeDelivery(modelText: string, snapshotText: string, modelCitations: number, knowledgeRetrieved: boolean, webRetrieved = false) {
  if (!snapshotText) {
    if (!modelCitations && (knowledgeRetrieved || webRetrieved)) fail('missing_citation', 502);
    guardAnswerCommitments(modelText);
    return { text: modelText, modelIncluded: true };
  }
  if (!modelCitations && (knowledgeRetrieved || webRetrieved)) return { text: snapshotText, modelIncluded: false };
  if (!modelText.trim()) return { text: snapshotText, modelIncluded: false };
  try { guardAnswerCommitments(modelText); }
  catch (error) {
    if (!(error instanceof AssistantError) || error.code !== 'unsupported_model_commitment') throw error;
    return { text: snapshotText, modelIncluded: false };
  }
  return { text: `${modelText}\n\n${snapshotHeading}\n${snapshotText}`, modelIncluded: true };
}

export async function processNativeAgentAnswer(lease: Lease) {
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const bound = nativeAgentRuntimeBinding(lease.enterpriseId);
    if (!bound) fail('context_changed');
    const authorize = () => withTenantTransaction(lease.enterpriseId, async tx => {
      const state = await runContext(tx, lease);
      const policy = state.run.policy_snapshot as Row;
      const runtime = policy.agentRuntime as Row | undefined;
      if (!runtime || runtime.protocol !== xiaokNativeExecutorProtocol || runtime.binding !== bound.binding
        || nativeAgentRuntimeBinding(lease.enterpriseId)?.binding !== bound.binding
        || lease.actor.principal.kind !== 'user' || state.conversation.purpose !== 'customer_consultation'
        || String(state.run.purpose) !== 'reply') fail('context_changed');
      const config = agentConfig(policy.agent);
      const current = await one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${lease.enterpriseId}`);
      if (!config || agentCapabilityFingerprint(config) !== agentCapabilityFingerprint(agentConfig(current?.agent_config))) fail('context_changed');
      return state;
    });
    const initial = await authorize();
    const config = agentConfig((initial.run.policy_snapshot as Row).agent);
    if (!config) fail('context_changed');
    const knowledgeEnabled = runKnowledgeEnabled(initial.run.policy_snapshot as Row);
    const { context, messages, citations } = await nativeConversation(lease, [], xiaokNativeExecutorProtocol);
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
    // A resumed run replays its durable retrieval and snapshot steps so the
    // final turn keeps the same citation and composition rules after a restart.
    const saved = await withTenantTransaction(lease.enterpriseId, async tx => {
      await runContext(tx, lease);
      const checkpoint = await one(tx, sql`select private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq=1000 and kind='agent_checkpoint' and status='succeeded'`);
      const searches = await rows(tx, sql`select step_seq,private_checkpoint from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq>=1300 and step_seq<1400 and kind='retrieval' and status='succeeded' order by step_seq`);
      const businesses = await rows(tx, sql`select step_seq,private_checkpoint from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq>=1400 and step_seq<1500 and kind='agent_tool' and capability_name='query_business' and status='succeeded' order by step_seq`);
      return { checkpoint, searches, businesses };
    });
    if (saved.checkpoint && (saved.checkpoint.input_summary as Row)?.promptVersion !== promptVersion) fail('context_changed');
    const resume = saved.checkpoint?.private_checkpoint as AgentCheckpoint | undefined;
    for (const step of saved.searches) {
      const evidence = step.private_checkpoint as Evidence[];
      if (!Array.isArray(evidence) || !evidence.length) continue;
      knowledgeRetrieved = true;
      for (const e of evidence) {
        catalog.set('K' + e.ref.id, { nativeId: 'K' + e.ref.id, sourceId: 'K' + e.ref.id,
          quote: Array.from(e.text).length > 600 ? Array.from(e.text).slice(0, 600).join('') : e.text, evidence: e });
        context.knowledge.push(e);
      }
    }
    for (const step of saved.businesses) {
      const snapshot = step.private_checkpoint as BusinessSnapshot;
      if (!snapshot || typeof snapshot !== 'object' || !('query' in snapshot)) continue;
      delivered.push(snapshot);
      context.snapshots.push(snapshot);
    }
    const rt: DialogueToolRuntime = { lease, protocol: xiaokNativeExecutorProtocol, authorize, context, catalog, messages,
      markKnowledgeRetrieved: () => { knowledgeRetrieved = true; }, delivered };
    const search = dialogueEnterpriseSearch(rt);
    const business = dialogueBusinessQuery(rt);
    const tools: ModelTool[] = [
      ...(knowledgeEnabled ? [enterpriseSearchTool] : []),
      ...businessToolDefinitions.filter(tool => tool.name === 'query_business'),
    ];
    const validateTool = (name: string, args: string): { code: string; feedback: string } | null => {
      if (name === 'search_enterprise') {
        try {
          const value = JSON.parse(args) as { query?: unknown };
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'query')
            || typeof value.query !== 'string' || !value.query.trim() || Array.from(value.query).length > 1000)
            return { code: 'invalid_tool_input', feedback: 'search_enterprise需要一个1到1000字的非空query字符串；仅提交{"query":"..."}，不要附加其他字段或编造返回内容。' };
        } catch { return { code: 'invalid_tool_input', feedback: 'search_enterprise参数不是合法JSON对象；仅提交{"query":"..."}。' }; }
      }
      if (name === 'query_business') {
        try { parseBusinessQuery(JSON.parse(args)); }
        catch { return { code: 'invalid_tool_input', feedback: 'query_business需要{"domain":"appointments|schemes|floorplans|construction","leadId":"..."}；leadId为空字符串表示列本人档案。' }; }
      }
      return null;
    };
    let sequence = 0;
    const toolPort = async (turn: number, index: number, name: string, args: string) => {
      if (name === 'search_enterprise') {
        const value = JSON.parse(args) as { query: string };
        return { content: JSON.stringify(await search(value.query, ++sequence)) };
      }
      if (name === 'query_business') {
        return { content: JSON.stringify(await business(parseBusinessQuery(JSON.parse(args)), ++sequence)) };
      }
      fail('assistant_capability_forbidden', 403);
    };
    // The final dispatch's attempt id witnesses the per-turn usage ledger at
    // completeRun; every turn already wrote its own row above.
    let lastAttemptId: string | null = null;
    const model = async (turn: number, modelMessages: ModelMessage[], modelTools: ModelTool[]): Promise<ModelTurnOutput> => {
      const step = 1100 + turn * 10;
      await withTenantTransaction(lease.enterpriseId, async tx => {
        await runContext(tx, lease);
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
          values(${lease.enterpriseId},${lease.runId},${step},'agent_model','running',
          ${JSON.stringify({ turn, purpose: 'answer', promptVersion, protocol: xiaokNativeExecutorProtocol,
            tools: modelTools.map(tool => tool.name), maxOutputTokens: agentModelLimits.maxOutputTokens })}::jsonb)
          on conflict(enterprise_id,run_id,step_seq) do nothing`);
      });
      const output = await executePostgresText({
        enterpriseId: BigInt(lease.enterpriseId), owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
        logicalModelKey: 'chat.general', messages: [], maxTokens: agentModelLimits.maxOutputTokens,
        // The first dispatch must actually read before it answers: this is the
        // native equivalent of the V2 app's required-tool retrieval, and the
        // established legacy-agent requireTool contract.
        agent: { config, input: { messages: modelMessages, tools: modelTools, maxTokens: agentModelLimits.maxOutputTokens,
          requireTool: turn === 0 && modelTools.length > 0 } },
        metadata: { promptVersion, runtime: xiaokNativeExecutorProtocol, turn, purpose: 'answer', probeVersion: config.probeVersion },
        beforeProviderCall,
      });
      if (!output.agentOutput) fail('invalid_model_answer', 502);
      lastAttemptId = String(output.attemptId);
      await recordAgentModelUsage(lease.enterpriseId, lease.runId, turn, output);
      await withTenantTransaction(lease.enterpriseId, async tx => {
        await runContext(tx, lease);
        await tx.execute(sql`update app.assistant_run_steps set status='succeeded',provider_attempt_id=${String(output.attemptId)},
          private_checkpoint=${JSON.stringify(output.agentOutput)}::jsonb
          where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${step}`);
      });
      return output.agentOutput;
    };
    // The marker commits before the first provider dispatch of this process;
    // a resumed run whose earlier process already dispatched keeps its marker.
    let needProviderMark = !await withTenantTransaction(lease.enterpriseId, async tx =>
      !!(await runContext(tx, lease)).job.provider_started_at);
    const beforeProviderCall = async () => {
      if (!needProviderMark) return;
      needProviderMark = false;
      await markProviderStarted(lease);
    };
    await heartbeat(lease);
    timer = setInterval(() => { heartbeat(lease).catch(() => undefined); }, 30000);
    const systemMessage: ModelMessage = { role: 'system', content: [{ type: 'text', text: nativeExecutorPrompt(knowledgeEnabled) }] };
    const history: ModelMessage[] = messages.map(m => m.role === 'user'
      ? { role: 'user', content: [{ type: 'text', text: m.content }] } : { role: 'assistant', content: m.content });
    const result = await runRenovationAgent({
      messages: [systemMessage, ...history], tools, resume,
      ports: { authorize: guard, model, tool: toolPort, validateTool,
        checkpoint: state => withTenantTransaction(lease.enterpriseId, async tx => {
          await runContext(tx, lease);
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary,private_checkpoint)
            values(${lease.enterpriseId},${lease.runId},1000,'agent_checkpoint','succeeded',
            ${JSON.stringify({ promptVersion, protocol: xiaokNativeExecutorProtocol })}::jsonb,${JSON.stringify(state)}::jsonb)
            on conflict(enterprise_id,run_id,step_seq) do update set private_checkpoint=excluded.private_checkpoint,updated_at=now(),version=app.assistant_run_steps.version+1`);
        }) },
    });
    await guard();
    // The graph state carries the final output under `output`, not a bare text.
    const finalText = result.output?.text;
    if (!finalText || !finalText.trim()) fail('invalid_model_answer', 502);
    for (const key of ['knowledge', 'snapshots', 'sources'] as const)
      (context[key] as unknown[]) = [...new Map((context[key] as unknown[]).map(v => [fingerprint(v), v])).values()];
    const snapshotText = delivered.map(s => s.displayText).join('\n');
    let modelParts: RagPart[] | null = null;
    if (finalText.trim()) {
      try { modelParts = ragAnswerParts(finalText, [...catalog.values()]); }
      catch (error) { if (!snapshotText) throw error; }
    }
    const modelCitations = modelParts?.filter(part => 'source' in part).length ?? 0;
    const composed = composeNativeDelivery(finalText, snapshotText, modelCitations, knowledgeRetrieved);
    const text = composed.text;
    // Follow-up questions stay preset-only until the dedicated suggestion
    // generation migrates off its FastGPT app (no model call, no usage row).
    const suggestions: SuggestionResolution = resolveSuggestions(null, bound.configuration.presets ?? []);
    const parts = ragAnswerParts(text, [...catalog.values()]);
    const cited = [...catalog.values()].filter(c => parts.some(p => 'source' in p && p.source.nativeId === c.nativeId));
    await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text }] }, usage: null,
      attemptId: lastAttemptId ?? undefined, usageMode: 'per_turn' },
      async (tx, run, messageId) => {
        const state = await runContext(tx, lease);
        if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
        const blocks: MessageContent['blocks'] = [], savedCitations = new Map<string, string>();
        for (const p of parts) {
          if ('text' in p) { blocks.push({ type: 'text', text: p.text }); continue; }
          const e: Evidence = p.source.evidence;
          let citation = savedCitations.get(p.source.nativeId);
          if (!citation) {
            citation = await saveKnowledgeCitation(tx, lease.actor, state.conversation, lease.runId, messageId, e, p.source.quote || e.text);
            savedCitations.set(p.source.nativeId, citation);
          }
          blocks.push({ type: 'citation', citationId: citation, fallbackText: '知识来源' });
        }
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs,private_checkpoint,input_summary)
          values(${lease.enterpriseId},${lease.runId},1006,'agent_synthesis_context','succeeded',${JSON.stringify(context)}::jsonb,
            ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, kind: 'synthesis', segments: [], raw: finalText,
              citations: cited, composition: { snapshots: delivered.length, modelCitations, modelIncluded: composed.modelIncluded } })}::jsonb,
            ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, runtime: 'xiaok-native-executor' })}::jsonb)`);
        if (suggestions.questions.length)
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint,input_summary)
            values(${lease.enterpriseId},${lease.runId},1007,'agent_suggestions','succeeded',
              ${JSON.stringify({ questions: suggestions.questions, source: suggestions.source })}::jsonb,
              ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, runtime: 'xiaok-native-executor', generated: false })}::jsonb)`);
        await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify({ version: 1, blocks })}::jsonb,
          answer_kind=${savedCitations.size ? 'grounded' : null} where enterprise_id=${lease.enterpriseId} and id=${messageId}`);
        await tx.execute(sql`update app.assistant_runs set answer_kind=${savedCitations.size ? 'grounded' : null}
          where enterprise_id=${lease.enterpriseId} and id=${String(run.id)}`);
      });
  } catch (error) {
    const known = error instanceof AssistantError || error instanceof AiProviderError && !['accepted', 'unknown'].includes(error.disposition);
    await failRun(lease, error instanceof AssistantError || error instanceof AiProviderError ? error.code : 'native_executor_failed', known);
  } finally { if (timer) clearInterval(timer); }
}
