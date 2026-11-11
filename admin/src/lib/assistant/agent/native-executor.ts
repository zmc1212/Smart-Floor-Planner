import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
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
import { resolveSuggestions, resumeSuggestionGeneration, suggestionGenerationStep, suggestionPrompt,
  type SuggestionResolution } from '../fastgpt/agent-v2/suggestions';
import { agentCapabilityFingerprint, agentConfig } from './config';
import { businessToolDefinitions, parseBusinessQuery, type BusinessSnapshot } from './business-tools';
import { guardAnswerCommitments } from './context';
import { runRenovationAgent, type AgentCheckpoint } from './runtime';
import { synthesisContextAvailable } from './synthesis-sources';
import { dialogueBusinessQuery, dialogueEnterpriseSearch, snapshotHeading, type DialogueToolRuntime } from './dialogue-tools';
import { assertModelTurnBand, dialogueWebResearch, webCitations, type WebToolRuntime } from './dialogue-web-tools';
import { dialogueDesignerRecommendation, dialoguePublicSitesRecommendation, publicSitesDelivery,
  type RecommendToolRuntime } from './dialogue-recommend-tools';
import { dialogueHistoryRecall, type HistoryToolRuntime } from './dialogue-history-tools';
import { parseWebQuery, webSearchTool, type WebSearchSnapshot } from './web';
import { parsePublicRead, publicResearchTools } from './public-research';
import { historyRefsAvailable, historySynthesisSources, historyTool, parseHistoryQuery,
  type HistoryRef, type HistorySnapshot } from './history';
import { webAnswerQuoteSpans, webEvidence, webSynthesisSources } from './web-evidence';
import { publishedPublicMaterial } from '@/lib/construction/public-read';
import type { PublicContent } from '@/lib/construction/public-contract';
import { defaultPublicIntroConstraints, defaultPublicIntroInput, publicIntroFacts, publicIntroPrompt,
  validatePublicIntro } from '@/lib/construction/public-intro';
import { openingScene, sceneForOpeningPurpose } from '../fastgpt/agent-v2/openings';

/** The XiaoK-owned executor for V2-surface customer consultations. It reuses
 * the existing LangGraph runtime, model gateway and authorized tools; no
 * FastGPT app, bridge or callback participates in a native run. */
export const xiaokNativeExecutorProtocol = 'xiaok-native-executor-v1';
export const nativeExecutorPromptVersion = 'xiaok-native-executor-prompt-v1';
const promptVersion = nativeExecutorPromptVersion;

const enterpriseSearchTool: ModelTool = {
  name: 'search_enterprise',
  description: '检索本企业有效装修工艺与做法资料（获权范围）。query用客户问题的专业关键词；返回原文摘录与cites，最终回答须用[id](CITE)标注；未命中如实说明。',
  parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 1000 } }, required: ['query'], additionalProperties: false },
};

// V2 zero-argument contract: no model-supplied filters. The designer credit and
// the conversation's authorized region/stated direction decide the result, so a
// model guess can never become a recommendation condition.
const designerRecommendationTool: ModelTool = {
  name: 'recommend_designers',
  description: '浏览本企业公开设计师作品。无需参数；服务端依据已获权的工地署名、房屋城市与客户明确的方向决定结果。返回状态与说明，作品卡片随回复展示；不编造设计师、作品或可预约时间。',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};
const publicSitesRecommendationTool: ModelTool = {
  name: 'recommend_public_sites',
  description: '查看附近已获权公开的工地。无需参数；服务端依据已授权定位或明确的房屋城市/区县筛选。返回附近公开工地与说明；未获权定位时如实请客户授权定位或补充所在城市，不猜位置。',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
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

/** Stable per-run tool identity recovered from persisted steps. Identical
 * re-issued calls reuse the persisted receipt; fresh calls continue past every
 * recorded step sequence and never reuse an operation key or step_seq. Runs
 * interrupted before receipts were recorded cannot be reconstructed, so they
 * fail closed instead of re-dispatching a metered call. Bands: 1100 model,
 * 1200 web, 1300 enterprise search, 1400 business, 1500 recall_history,
 * fixed 2000 designers / 2010 public sites. */
export function recoveredDialogueToolState(searchSteps: Row[], businessSteps: Row[], webSteps: Row[] = [],
  historySteps: Row[] = [], fixedSteps: Row[] = []): {
  searches: Map<string, Record<string, unknown>>; businesses: Map<string, Record<string, unknown>>;
  webs: Map<string, Record<string, unknown>>; histories: Map<string, Record<string, unknown>>;
  designers?: Record<string, unknown>; publicSites?: Record<string, unknown>; nextSequence: number;
} {
  const searches = new Map<string, Record<string, unknown>>(), businesses = new Map<string, Record<string, unknown>>();
  const webs = new Map<string, Record<string, unknown>>(), histories = new Map<string, Record<string, unknown>>();
  let designers: Record<string, unknown> | undefined, publicSites: Record<string, unknown> | undefined;
  let nextSequence = 0;
  const receipt = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as Row).status !== 'string')
      fail('invalid_agent_checkpoint', 409);
    return value as Record<string, unknown>;
  };
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
  for (const step of [...searchSteps, ...businessSteps, ...webSteps, ...historySteps].sort((a, b) => Number(a.step_seq) - Number(b.step_seq))) {
    const meta = (step.input_summary ?? null) as Row | null, seq = Number(step.step_seq);
    const capability = String(step.capability_name ?? '');
    if (seq >= 1300 && seq < 1400) {
      const query = text(meta?.query);
      if (!query || searches.has(query)) fail('invalid_agent_checkpoint', 409);
      searches.set(query, receipt(meta?.receipt));
      nextSequence = Math.max(nextSequence, seq - 1300 + 1);
    } else if (seq >= 1400 && seq < 1500) {
      const key = text(meta?.key);
      if (!key || businesses.has(key)) fail('invalid_agent_checkpoint', 409);
      businesses.set(key, receipt(meta?.receipt));
      nextSequence = Math.max(nextSequence, seq - 1400 + 1);
    } else if (seq >= 1200 && seq < 1300 && (capability === 'web.search.v1' || capability === 'web.read.v1')) {
      // Identity is the model's own argument: the raw public query text for a
      // search, the candidate id for a read. The factory persists `rawQuery`
      // beside the normalized WebQuery it dispatched, so recovery keys receipts
      // exactly like the executor's fresh-call lookup ('search:' + raw string).
      // The shared factories add a second safety net through their persisted
      // queryHash replay. Receipts written before rawQuery existed fail closed
      // instead of guessing an identity.
      const readId = meta?.tool === 'read_web' ? text(meta?.candidateId) : null;
      const searchQuery = meta?.tool === 'search_web' ? text(meta?.rawQuery) : null;
      const identity = readId ? 'read:' + readId : searchQuery ? 'search:' + searchQuery : null;
      if (!identity || webs.has(identity)) fail('invalid_agent_checkpoint', 409);
      webs.set(identity, receipt(meta?.receipt));
      nextSequence = Math.max(nextSequence, seq - 1200 + 1);
    } else if (seq >= 1500 && seq < 1600 && capability === 'recall_history') {
      const query = text(meta?.query);
      if (!query || histories.has(query)) fail('invalid_agent_checkpoint', 409);
      const value = meta?.receipt;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof (value as HistorySnapshot).query !== 'string' || !Array.isArray((value as HistorySnapshot).sources))
        fail('invalid_agent_checkpoint', 409);
      histories.set(query, value as Record<string, unknown>);
      nextSequence = Math.max(nextSequence, seq - 1500 + 1);
    } else fail('invalid_agent_checkpoint', 409);
  }
  for (const step of fixedSteps) {
    const meta = (step.input_summary ?? null) as Row | null, seq = Number(step.step_seq);
    // The projection (designerMessageProjection) and core/discovery read these
    // fixed steps straight from the DB; recovery only re-serves their receipts
    // and never rewrites or re-dispatches them.
    if (seq === 2000 && step.kind === 'agent_designer_result') {
      if (designers) fail('invalid_agent_checkpoint', 409);
      designers = receipt(meta?.receipt);
    } else if (seq === 2010 && step.kind === 'agent_public_sites') {
      if (publicSites) fail('invalid_agent_checkpoint', 409);
      publicSites = receipt(meta?.receipt);
    } else fail('invalid_agent_checkpoint', 409);
  }
  return { searches, businesses, webs, histories, ...(designers ? { designers } : {}), ...(publicSites ? { publicSites } : {}), nextSequence };
}

/** The pre-dispatch authorization for a public-site opening. It runs in the
 * same transaction as the provider-start marker: a site switched or withdrawn
 * after the first read blocks the model call, while the final commit keeps its
 * own re-check. */
export async function authorizePublicIntroDispatch(tx: PostgresTransaction, enterpriseId: string,
  conversation: Row, ref: { siteId: string; versionId: string }) {
  const current = (conversation.entry_snapshot as Row).activePublicSite as
    { siteId: string; versionId: string } | undefined;
  if (!current || String(current.siteId) !== String(ref.siteId) || String(current.versionId) !== String(ref.versionId))
    fail('context_changed');
  if (!await publishedPublicMaterial(tx, enterpriseId, String(ref.siteId), String(ref.versionId)))
    fail('public_site_unavailable', 404);
}

/** The commit-time counterpart: the model may have run, but the opening is
 * only persisted while the same selection and published material still hold.
 * Throwing here rolls the message append back with the rest of the commit. */
export async function assertPublicIntroCommit(tx: PostgresTransaction, lease: Lease, ref: { siteId: string; versionId: string }) {
  const state = await runContext(tx, lease);
  await authorizePublicIntroDispatch(tx, lease.enterpriseId, state.conversation, ref);
}

/** Persist the suggestion dispatch's measured usage without any lease,
 * authorization or run-context check: a cancelled, expired or re-authorized
 * run must never roll back tokens the provider already billed. Idempotent per
 * operation key, and an observed measurement is never downgraded or
 * overwritten by a later write. */
export async function persistSuggestionUsage(enterpriseId: string, runId: string, operationKey: string,
  attemptId: string, usage: { inputTokens: number; outputTokens: number } | null) {
  await withTenantTransaction(enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records
    (enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
    values(${enterpriseId},${runId},${attemptId},${operationKey},'suggestion_tokens',
    ${usage ? usage.inputTokens + usage.outputTokens : null},${usage ? 'observed' : 'unavailable'},
    ${usage?.inputTokens ?? null},${usage?.outputTokens ?? null})
    on conflict (enterprise_id,operation_key,category) do update set
      provider_attempt_id=excluded.provider_attempt_id,quantity=excluded.quantity,
      measurement_kind=excluded.measurement_kind,input_tokens=excluded.input_tokens,
      output_tokens=excluded.output_tokens,updated_at=now(),version=app.assistant_usage_records.version+1
    where app.assistant_usage_records.measurement_kind is distinct from 'observed'`));
}

/** Attach the dispatch's provider attempt to its usage row for reconciliation
 * without changing the unknown measurement. The attempt row itself carries
 * accepted/status, which distinguishes a definite failure from an unknown
 * outcome. A guard that failed before dispatch has neither row, so the update
 * naturally matches nothing. */
export async function backfillSuggestionProviderAttempt(enterpriseId: string, runId: string, operationKey: string) {
  return withTenantTransaction(enterpriseId, async tx => {
    const attempt = await one(tx, sql`select id from app.ai_provider_attempts
      where enterprise_id=${enterpriseId} and assistant_run_id=${runId}
        and metadata->>'purpose'='suggestions' order by id desc limit 1`);
    if (!attempt) return null;
    await tx.execute(sql`update app.assistant_usage_records set provider_attempt_id=${String(attempt.id)},
      updated_at=now(),version=version+1
      where enterprise_id=${enterpriseId} and run_id=${runId} and operation_key=${operationKey}
        and category='suggestion_tokens' and provider_attempt_id is null`);
    return String(attempt.id);
  });
}

export async function processNativeAgentAnswer(lease: Lease) {
  let timer: ReturnType<typeof setInterval> | undefined;
  // Set when a guard meets a dispatched-but-unrecorded model step: the run
  // must stay indeterminate instead of being labelled a known failure.
  let outcomeUnknown = false;
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
        || !['reply', 'public.site.intro'].includes(String(state.run.purpose))) fail('context_changed');
      const config = agentConfig(policy.agent);
      const current = await one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${lease.enterpriseId}`);
      if (!config || agentCapabilityFingerprint(config) !== agentCapabilityFingerprint(agentConfig(current?.agent_config))) fail('context_changed');
      return state;
    });
    const initial = await authorize();
    // A public-site opening is a one-shot system event on the customer's own
    // consultation, not a question and not a tool turn. It keeps the same
    // published-material, provider-attempt, usage and recovery contracts as a
    // reply, but never reads conversation history or offers tools.
    if (String(initial.run.purpose) === 'public.site.intro') {
      const ref = (initial.conversation.entry_snapshot as Row).activePublicSite as
        { siteId: string; versionId: string } | undefined;
      if (!ref) fail('context_changed');
      const material = await withTenantTransaction(lease.enterpriseId, tx =>
        publishedPublicMaterial(tx, lease.enterpriseId, String(ref.siteId), String(ref.versionId)));
      if (!material) fail('public_site_unavailable', 404);
      const sceneKey = sceneForOpeningPurpose('public.site.intro')!;
      const scene = openingScene(lease.enterpriseId, sceneKey);
      const input = scene?.input ?? defaultPublicIntroInput;
      const constraints = scene?.constraints ?? defaultPublicIntroConstraints;
      const config = agentConfig((initial.run.policy_snapshot as Row).agent);
      if (!config) fail('context_changed');
      const content = material.version.content as PublicContent;
      const messages: ModelMessage[] = [
        { role: 'system', content: [{ type: 'text', text: publicIntroPrompt(constraints.maxChars) }] },
        { role: 'user', content: [{ type: 'text', text: publicIntroFacts(content, input) }] },
      ];
      let needProviderMark = !initial.job.provider_started_at;
      await heartbeat(lease);
      timer = setInterval(() => { heartbeat(lease).catch(() => undefined); }, 30000);
      const output = await executePostgresText({
        enterpriseId: BigInt(lease.enterpriseId),
        owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
        logicalModelKey: 'chat.general', messages: [], maxTokens: agentModelLimits.maxOutputTokens,
        agent: { config, input: { messages, tools: [], maxTokens: agentModelLimits.maxOutputTokens } },
        metadata: { promptVersion, runtime: xiaokNativeExecutorProtocol, purpose: 'public_intro',
          scene: scene?.key ?? sceneKey, probeVersion: config.probeVersion },
        beforeProviderCall: async () => {
          if (!needProviderMark) return;
          needProviderMark = false;
          // The first read is not the dispatch authorization. Immediately
          // before the provider call (same transaction as the start marker) the
          // selected site/version, its published state and the run/user
          // authorization are checked again, so leaving the site or withdrawing
          // it in between produces no model call.
          await markProviderStarted(lease, [], (tx, conversation) =>
            authorizePublicIntroDispatch(tx, lease.enterpriseId, conversation, ref));
        },
      });
      if (!output.agentOutput) fail('invalid_model_answer', 502);
      if (constraints.noCommitments) guardAnswerCommitments(output.agentOutput.text);
      const text = validatePublicIntro(output.agentOutput.text, constraints);
      const usage = output.agentOutput.usage;
      await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records
        (enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
        values(${lease.enterpriseId},${lease.runId},${String(output.attemptId)},${'native-intro:' + lease.runId},'intro_tokens',
        ${usage ? usage.inputTokens + usage.outputTokens : null},${usage ? 'observed' : 'unavailable'},
        ${usage?.inputTokens ?? null},${usage?.outputTokens ?? null}) on conflict do nothing`));
      await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text }] }, usage: usage ?? null,
        attemptId: String(output.attemptId) }, async tx => {
        // The site may be withdrawn, replaced or left while the model ran.
        // Both the active selection and the published material must still be
        // the same at commit time, so a stale opening is never delivered.
        await assertPublicIntroCommit(tx, lease, ref);
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
          values(${lease.enterpriseId},${lease.runId},1006,'agent_intro','succeeded',
          ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, scene: scene?.key ?? sceneKey,
            chars: Array.from(text).length })}::jsonb)`);
      });
      return;
    }
    const config = agentConfig((initial.run.policy_snapshot as Row).agent);
    if (!config) fail('context_changed');
    const knowledgeEnabled = runKnowledgeEnabled(initial.run.policy_snapshot as Row);
    const { context, messages, citations } = await nativeConversation(lease, [], xiaokNativeExecutorProtocol);
    const catalog = new Map<string, RagCitationSource>(citations.map(c => [c.nativeId, c]));
    const historyRefs = new Map<string, HistoryRef>();
    const guard = async () => {
      await authorize();
      await withTenantTransaction(lease.enterpriseId, async tx => {
        const state = await runContext(tx, lease);
        if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
        // Recalled customer originals carry their own ref set (recovered
        // snapshots plus every fresh recall): a session version bump or an
        // unavailable original blocks the next model call exactly like the
        // synthesis-context check blocks retrieved evidence.
        if (historyRefs.size && !await historyRefsAvailable(tx, lease.enterpriseId, String(state.conversation.id), [...historyRefs.values()])) fail('context_changed');
      });
    };
    let knowledgeRetrieved = false, webRetrieved = false;
    const delivered: BusinessSnapshot[] = [];
    // A resumed run replays its durable retrieval and snapshot steps so the
    // final turn keeps the same citation and composition rules after a restart.
    const saved = await withTenantTransaction(lease.enterpriseId, async tx => {
      const { conversation } = await runContext(tx, lease);
      const conversationId = String(conversation.id);
      const checkpoint = await one(tx, sql`select private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq=1000 and kind='agent_checkpoint' and status='succeeded'`);
      const searches = await rows(tx, sql`select step_seq,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq>=1300 and step_seq<1400 and kind='retrieval' and status='succeeded' order by step_seq`);
      const businesses = await rows(tx, sql`select step_seq,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq>=1400 and step_seq<1500 and kind='agent_tool' and capability_name='query_business' and status='succeeded' order by step_seq`);
      const webs = await rows(tx, sql`select step_seq,capability_name,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq>=1200 and step_seq<1300 and kind='retrieval'
        and capability_name in ('web.search.v1','web.read.v1') and status='succeeded' order by step_seq`);
      const historySteps = await rows(tx, sql`select step_seq,capability_name,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq>=1500 and step_seq<1600 and kind='agent_tool' and capability_name='recall_history' and status='succeeded' order by step_seq`);
      // A persisted recall only replays while every original is still
      // authorized; otherwise the resumed run fails closed like a fresh one.
      // The raw rows stay the recovery input: recoveredDialogueToolState reads
      // the same DB shape the factories persist, never a reshaped copy.
      const histories: Row[] = [];
      for (const step of historySteps) {
        const snapshot = step.private_checkpoint as HistorySnapshot;
        if (snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.sources)
          && !await historyRefsAvailable(tx, lease.enterpriseId, conversationId, snapshot.sources)) fail('context_changed');
        histories.push(step);
      }
      const fixed = await rows(tx, sql`select step_seq,kind,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and step_seq in (2000,2010) and kind in ('agent_designer_result','agent_public_sites') and status='succeeded' order by step_seq`);
      // recall_history is scoped to the customer's own originals before the
      // trigger message; the run's real trigger seq is the only honest cutoff.
      const trigger = await one(tx, sql`select m.seq::text as seq from app.assistant_runs r join app.assistant_messages m
        on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.trigger_message_id
        where r.enterprise_id=${lease.enterpriseId} and r.id=${lease.runId}`);
      // The last succeeded model dispatch witnesses the per-turn usage ledger
      // at completeRun on a resumed run that never dispatches again.
      const lastModel = await one(tx, sql`select provider_attempt_id from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
        and run_id=${lease.runId} and kind='agent_model' and status='succeeded' order by step_seq desc limit 1`);
      // Dispatch markers without a persisted receipt are open operations: the
      // metered provider I/O behind them has an unknown outcome and must never
      // be replayed. The usage row is the dispatch marker (written before I/O);
      // quantity alone cannot close it — only the succeeded receipt step can.
      const openOperations = await rows(tx, sql`select category,operation_key from app.assistant_usage_records
        where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}
        and category in ('query_embedding','web_search','web_read')`);
      const searchSeqs = new Set(searches.map(step => Number(step.step_seq)));
      const webSeqs = new Set(webs.map(step => Number(step.step_seq)));
      const open: string[] = [];
      for (const record of openOperations) {
        const key = String(record.operation_key), suffix = key.slice(key.lastIndexOf(':') + 1), seq = Number(suffix);
        if (!Number.isInteger(seq)) { open.push(key); continue; }
        if (record.category === 'query_embedding' && !searchSeqs.has(1300 + seq)) open.push(key);
        if ((record.category === 'web_search' || record.category === 'web_read') && !webSeqs.has(seq)) open.push(key);
      }
      return { checkpoint, searches, businesses, webs, histories, fixed, openOperations: open,
        triggerSeq: trigger?.seq ? String(trigger.seq) : null, lastModel };
    });
    if (saved.openOperations.length) { outcomeUnknown = true; fail('provider_outcome_unknown', 503); }
    if (saved.checkpoint && (saved.checkpoint.input_summary as Row)?.promptVersion !== promptVersion) fail('context_changed');
    if (saved.lastModel && !saved.lastModel.provider_attempt_id) fail('invalid_agent_checkpoint', 409);
    let lastAttemptId: string | null = saved.lastModel?.provider_attempt_id ? String(saved.lastModel.provider_attempt_id) : null;
    const toolState = recoveredDialogueToolState(saved.searches, saved.businesses, saved.webs, saved.histories, saved.fixed);
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
    // Persisted web originals re-enter the citation catalog and synthesis
    // context so a resumed run keeps the same CITE and composition rules; the
    // fixed 2000/2010 receipts are re-served as-is (never rewritten).
    for (const step of saved.webs) {
      const snapshot = step.private_checkpoint as WebSearchSnapshot;
      if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1) continue;
      const evidence = webEvidence(snapshot, lease.runId, Number(step.step_seq));
      if (!evidence.length) continue;
      webRetrieved = true;
      const sources = webSynthesisSources(evidence);
      webCitations(catalog, sources);
      (context.web ??= []).push(...evidence);
      context.sources.push(...sources);
    }
    for (const step of saved.histories) {
      const snapshot = step.private_checkpoint as HistorySnapshot;
      if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.sources)) continue;
      (context.history ??= []).push(snapshot);
      context.sources.push(...historySynthesisSources(snapshot));
      for (const { messageId, hash, memoryVersion } of snapshot.sources)
        historyRefs.set(String(messageId), { messageId: String(messageId), hash: String(hash), memoryVersion: Number(memoryVersion) });
    }
    const rt: DialogueToolRuntime = { lease, protocol: xiaokNativeExecutorProtocol, authorize, context, catalog, messages,
      markKnowledgeRetrieved: () => { knowledgeRetrieved = true; }, delivered,
      recovered: { searches: toolState.searches, businesses: toolState.businesses } };
    const search = dialogueEnterpriseSearch(rt);
    const business = dialogueBusinessQuery(rt);
    // Web evidence flags the missing-citation guard through markWebRetrieved;
    // the 120s research deadline mirrors the V2 bridge's per-process budget.
    const webRt: WebToolRuntime = { lease, protocol: xiaokNativeExecutorProtocol, authorize, context, catalog, messages,
      markWebRetrieved: () => { webRetrieved = true; }, webDeadlineAt: Date.now() + 120000 };
    const web = dialogueWebResearch(webRt);
    const recommendRt: RecommendToolRuntime = { lease, protocol: xiaokNativeExecutorProtocol, authorize, context, messages,
      recovered: { designers: toolState.designers, publicSites: toolState.publicSites } };
    const designers = dialogueDesignerRecommendation(recommendRt);
    const sites = dialoguePublicSitesRecommendation(recommendRt);
    const historyRt: HistoryToolRuntime = { lease, protocol: xiaokNativeExecutorProtocol, authorize, historyRefs };
    const recall = dialogueHistoryRecall(historyRt);
    // Web, designer, public-site and history tools are not knowledge-gated:
    // they read authorized non-enterprise sources, exactly like the V2 bridge.
    // recall_history additionally requires the run's real trigger seq.
    const tools: ModelTool[] = [
      ...(knowledgeEnabled ? [enterpriseSearchTool] : []),
      ...businessToolDefinitions.filter(tool => tool.name === 'query_business'),
      ...publicResearchTools([webSearchTool], true, true),
      designerRecommendationTool, publicSitesRecommendationTool,
      ...(saved.triggerSeq ? [historyTool] : []),
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
      if (name === 'search_web') {
        try { parseWebQuery(JSON.parse(args)); }
        catch { return { code: 'invalid_tool_input', feedback: 'search_web需要{"query":"公共术语/产品型号"}；不传客户姓名、电话、地址、项目编号或私聊原话，不编造返回内容。' }; }
      }
      if (name === 'read_web') {
        try { parsePublicRead(JSON.parse(args)); }
        catch { return { code: 'invalid_tool_input', feedback: 'read_web需要{"candidateId":"P..."}；只能传本轮search_web/read_web返回的实际候选id，不是引用id。' }; }
      }
      if (name === 'recall_history') {
        try { parseHistoryQuery(JSON.parse(args)); }
        catch { return { code: 'invalid_tool_input', feedback: 'recall_history需要{"query":"客户已明确的房间/对象/关键词"}，2到80字；只回读客户原话，不是当前事实。' }; }
      }
      if (name === 'recommend_designers' || name === 'recommend_public_sites') {
        try {
          const value = JSON.parse(args) as unknown;
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value as object).length)
            throw new Error('arguments');
        } catch { return { code: 'invalid_tool_input', feedback: name === 'recommend_designers'
          ? 'recommend_designers无需参数；仅提交{}，结果由服务端按已获权条件决定。'
          : 'recommend_public_sites无需参数；仅提交{}，结果由服务端按已获权定位/城市决定。' }; }
      }
      return null;
    };
    // Fresh tool calls continue past every persisted step sequence in every
    // band (1200 web / 1300 search / 1400 business / 1500 history); recovered
    // identities reuse their persisted receipt and never reach this counter.
    let sequence = toolState.nextSequence;
    const toolPort = async (turn: number, index: number, name: string, args: string) => {
      if (name === 'search_enterprise') {
        const value = JSON.parse(args) as { query: string };
        return { content: JSON.stringify(await search(value.query, ++sequence)) };
      }
      if (name === 'query_business') {
        return { content: JSON.stringify(await business(parseBusinessQuery(JSON.parse(args)), ++sequence)) };
      }
      if (name === 'search_web' || name === 'read_web') {
        const parsed = JSON.parse(args) as { query?: string; candidateId?: string };
        const recoveredWeb = toolState.webs.get((name === 'search_web' ? 'search:' : 'read:')
          + String(name === 'search_web' ? parsed.query : parsed.candidateId));
        if (recoveredWeb) return { content: JSON.stringify(recoveredWeb) };
        const input = name === 'search_web' ? { name: 'search_web' as const, query: String(parsed.query) }
          : { name: 'read_web' as const, candidateId: String(parsed.candidateId) };
        return { content: JSON.stringify(await web(input, ++sequence)) };
      }
      if (name === 'recommend_designers') return { content: JSON.stringify(await designers()) };
      if (name === 'recommend_public_sites') return { content: JSON.stringify(await sites.call()) };
      if (name === 'recall_history') {
        if (!saved.triggerSeq) fail('assistant_capability_forbidden', 403);
        const { query } = JSON.parse(args) as { query: string };
        const recoveredHistory = toolState.histories.get(query);
        if (recoveredHistory) return { content: JSON.stringify(recoveredHistory) };
        const receipt = await recall(JSON.parse(args), ++sequence, saved.triggerSeq);
        // A fresh recall joins the same chain as the recovered ones: its
        // snapshot and H-sources enter the synthesis context, so the guard
        // before every later model call, the final commit and the persisted
        // step-1006 source set all revalidate this recall's originals.
        (context.history ??= []).push({ query: receipt.query, beforeSeq: receipt.beforeSeq,
          sources: receipt.sources, hasMore: receipt.hasMore, oversized: receipt.oversized });
        context.sources.push(...receipt.synthesisSources);
        return { content: JSON.stringify(receipt) };
      }
      fail('assistant_capability_forbidden', 403);
    };
    const model = async (turn: number, modelMessages: ModelMessage[], modelTools: ModelTool[]): Promise<ModelTurnOutput> => {
      // Turn 9 is the last whose ten tool slots stay below the 1200 web band.
      const step = assertModelTurnBand(turn);
      // A lost process may have persisted this dispatch before its graph
      // checkpoint: the original output and attempt are reused and the
      // provider is never re-called. A step without a persisted outcome stays
      // unknown and is never replayed here.
      const persisted = await withTenantTransaction(lease.enterpriseId, async tx => {
        await runContext(tx, lease);
        return await one(tx, sql`select status,provider_attempt_id,private_checkpoint from app.assistant_run_steps
          where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${step} and kind='agent_model'`);
      });
      if (persisted) {
        if (persisted.status !== 'succeeded' || !persisted.provider_attempt_id) { outcomeUnknown = true; fail('provider_outcome_unknown', 503); }
        const output = persisted.private_checkpoint as ModelTurnOutput;
        if (!output || typeof output !== 'object' || Array.isArray(output) || typeof output.text !== 'string' || !Array.isArray(output.toolCalls))
          fail('invalid_agent_checkpoint', 409);
        lastAttemptId = String(persisted.provider_attempt_id);
        return output;
      }
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
        // The saved 3026/3027 first drafts emitted citation ids without their
        // literal prefix. Validation moves into the graph's validate node so the
        // existing one-shot repair turn lets the model correct its own citation
        // expression against the same strict catalog; unknown ids still fail
        // closed exactly as before, and the repair never reveals the fix.
        validateFinal: async (text: string) => {
          try { ragAnswerParts(text, [...catalog.values()]); return null; }
          catch (error) {
            if (!(error instanceof AssistantError) || error.code !== 'invalid_model_citation') throw error;
            return { code: 'invalid_model_citation',
              feedback: '最终回答未通过引用校验：每个[id](CITE)标记的id必须与本轮工具返回的cites[].id逐字符一致，不得改写、缩写或编造。请重新提交最终回答，只引用仍有效来源的原始id；无法核实的部分如实说明，不新增引用。' };
          }
        },
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
    // A located-but-empty nearby result is delivered from the server receipt;
    // need_region never overrides the model draft (same rule as the bridge).
    const composed = publicSitesDelivery(
      composeNativeDelivery(finalText, snapshotText, modelCitations, knowledgeRetrieved, webRetrieved), sites.outcome());
    const text = composed.text;
    // Follow-up questions are ancillary: a failed, unknown or invalid
    // generation keeps the delivered answer and falls back to the configured
    // presets. The 1014 dispatch marker (outside the model-turn band) makes an
    // interrupted call observable without ever replaying a metered dispatch.
    const presets = bound.configuration.presets ?? [];
    let suggestions: SuggestionResolution = resolveSuggestions(null, presets);
    const suggestionStep = await withTenantTransaction(lease.enterpriseId, async tx => {
      await runContext(tx, lease);
      return await one(tx, sql`select status,private_checkpoint,input_summary from app.assistant_run_steps
        where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${suggestionGenerationStep}
          and kind='agent_suggestion_model'`);
    });
    const resumedSuggestions = resumeSuggestionGeneration(suggestionStep ?? undefined);
    if (resumedSuggestions.action === 'reuse') suggestions = resolveSuggestions(resumedSuggestions.text, presets);
    else if (resumedSuggestions.action === 'dispatch') {
      const operationKey = 'native-suggest:' + lease.runId;
      try {
        // Authorization precedes the dispatch marker, so a rejected guard does
        // not leave a usage row for a call that never happened.
        await guard();
        await withTenantTransaction(lease.enterpriseId, async tx => {
          await runContext(tx, lease);
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
            values(${lease.enterpriseId},${lease.runId},${suggestionGenerationStep},'agent_suggestion_model','running',
            ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, purpose: 'suggestions', promptVersion })}::jsonb)
            on conflict(enterprise_id,run_id,step_seq) do nothing`);
          // The open usage marker keeps an interrupted dispatch countable as
          // unknown; a success settles the same row.
          await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind)
            values(${lease.enterpriseId},${lease.runId},${operationKey},'suggestion_tokens',null,'unavailable') on conflict do nothing`);
        });
        const output = await executePostgresText({
          enterpriseId: BigInt(lease.enterpriseId),
          owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
          logicalModelKey: 'chat.general', messages: [], maxTokens: 800,
          agent: { config, input: { messages: [{ role: 'user',
            content: [{ type: 'text', text: suggestionPrompt(text) }] }], tools: [], maxTokens: 800 } },
          metadata: { promptVersion, runtime: xiaokNativeExecutorProtocol, purpose: 'suggestions', probeVersion: config.probeVersion },
          beforeProviderCall,
        });
        if (!output.agentOutput) fail('invalid_model_answer', 502);
        const usage = output.agentOutput.usage;
        const generated = output.agentOutput.text;
        // Billed usage is persisted before any run-context check: cancellation
        // or a changed authorization may still reject delivery, but it must not
        // roll back tokens the provider already returned.
        await persistSuggestionUsage(lease.enterpriseId, lease.runId, operationKey, String(output.attemptId), usage ?? null);
        await withTenantTransaction(lease.enterpriseId, async tx => {
          await runContext(tx, lease);
          await tx.execute(sql`update app.assistant_run_steps set status='succeeded',provider_attempt_id=${String(output.attemptId)},
            private_checkpoint=${JSON.stringify({ text: generated })}::jsonb
            where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${suggestionGenerationStep}`);
        });
        suggestions = resolveSuggestions(generated, presets);
      } catch (error) {
        // An unknown acceptance must stay visible even if the run later fails
        // for another reason; the answer itself already stands on its own.
        const unknown = error instanceof AiProviderError && ['accepted', 'unknown'].includes(error.disposition);
        if (unknown) outcomeUnknown = true;
        // Attach the attempt for reconciliation (a negative result distinguishes
        // a definite failure from an unknown one) without converting the
        // unknown measurement into an observed one.
        await backfillSuggestionProviderAttempt(lease.enterpriseId, lease.runId, operationKey).catch(() => undefined);
        const code = unknown ? 'provider_outcome_unknown'
          : error instanceof AssistantError || error instanceof AiProviderError ? error.code : 'suggestion_generation_failed';
        await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`update app.assistant_run_steps set status='failed',
          input_summary=${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, purpose: 'suggestions', promptVersion, code })}::jsonb
          where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${suggestionGenerationStep}
            and status='running'`)).catch(() => undefined);
      }
    } else if (resumedSuggestions.unknown) {
      // An earlier process dispatched this suggestion call without persisting
      // its receipt (or recorded an unknown outcome). It is never replayed, and
      // a later commit failure must not hide the unknown provider outcome. A
      // failed+unknown step keeps its original reason unchanged.
      outcomeUnknown = true;
      if (String(suggestionStep?.status) === 'running')
        await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`update app.assistant_run_steps set status='failed',
          input_summary=${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, purpose: 'suggestions', promptVersion,
            code: 'provider_outcome_unknown' })}::jsonb
          where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${suggestionGenerationStep}
            and status='running'`)).catch(() => undefined);
    }
    const parts = ragAnswerParts(text, [...catalog.values()]);
    const cited = [...catalog.values()].filter(c => parts.some(p => 'source' in p && p.source.nativeId === c.nativeId));
    // The persisted answer owns the web citation spans (same protocol as the
    // FastGPT V2 worker): segments carry every selected quote, so the
    // `w:{runId}:{index}` citation ids stay openable on reentry.
    const segments: Array<{ basis: 'advice' | 'evidence'; text: string; citations: Array<{ sourceId: string; quote: string }> }> = [];
    for (const p of parts) {
      if ('text' in p) { segments.push({ basis: 'advice', text: p.text, citations: [] }); continue; }
      const segment = segments.at(-1); if (!segment) fail('invalid_model_answer', 502);
      segment.basis = 'evidence';
      segment.citations.push({ sourceId: p.source.sourceId || 'K' + p.source.evidence.ref.id, quote: p.source.quote || p.source.evidence.text });
    }
    await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text }] }, usage: null,
      attemptId: lastAttemptId ?? undefined, usageMode: 'per_turn' },
      async (tx, run, messageId) => {
        const state = await runContext(tx, lease);
        if (!await synthesisContextAvailable(tx, lease.actor, state.conversation, context)) fail('context_changed');
        // Recalled originals revalidate one last time beside the other
        // consulted sources before the answer commits.
        if (historyRefs.size && !await historyRefsAvailable(tx, lease.enterpriseId, String(state.conversation.id), [...historyRefs.values()])) fail('context_changed');
        const blocks: MessageContent['blocks'] = [], savedCitations = new Map<string, string>();
        for (const p of parts) {
          if ('text' in p) { blocks.push({ type: 'text', text: p.text }); continue; }
          const e: Evidence = p.source.evidence;
          let citation = savedCitations.get(p.source.nativeId);
          if (!citation) {
            if (e.ref.type === 'web_page') {
              const webSources = context.sources.filter(s => s.kind === 'web');
              const index = webSources.findIndex(s => s.sourceId === p.source.sourceId);
              const span = index >= 0 && index <= 31
                ? webAnswerQuoteSpans({ kind: 'synthesis', segments }, webSources[index]).find(s => s.selectedQuotes.includes(p.source.quote!)) : undefined;
              if (!span) fail('invalid_model_citation', 502);
              citation = `w:${lease.runId}:${index}` + (span.part === undefined ? '' : ':' + span.part);
            } else citation = await saveKnowledgeCitation(tx, lease.actor, state.conversation, lease.runId, messageId, e, p.source.quote || e.text);
            savedCitations.set(p.source.nativeId, citation);
          }
          blocks.push({ type: 'citation', citationId: citation, fallbackText: e.ref.type === 'web_page' ? '网页来源' : '知识来源' });
        }
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs,private_checkpoint,input_summary)
          values(${lease.enterpriseId},${lease.runId},1006,'agent_synthesis_context','succeeded',${JSON.stringify(context)}::jsonb,
            ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, kind: 'synthesis', segments, raw: finalText,
              citations: cited, composition: { snapshots: delivered.length, modelCitations, modelIncluded: composed.modelIncluded } })}::jsonb,
            ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, runtime: 'xiaok-native-executor' })}::jsonb)`);
        if (suggestions.questions.length)
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint,input_summary)
            values(${lease.enterpriseId},${lease.runId},1007,'agent_suggestions','succeeded',
              ${JSON.stringify({ questions: suggestions.questions, source: suggestions.source })}::jsonb,
              ${JSON.stringify({ protocol: xiaokNativeExecutorProtocol, runtime: 'xiaok-native-executor', generated: suggestions.source === 'model' })}::jsonb)`);
        await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify({ version: 1, blocks })}::jsonb,
          answer_kind=${savedCitations.size ? 'grounded' : null} where enterprise_id=${lease.enterpriseId} and id=${messageId}`);
        await tx.execute(sql`update app.assistant_runs set answer_kind=${savedCitations.size ? 'grounded' : null}
          where enterprise_id=${lease.enterpriseId} and id=${String(run.id)}`);
      });
  } catch (error) {
    const known = !outcomeUnknown && (error instanceof AssistantError
      || error instanceof AiProviderError && !['accepted', 'unknown'].includes(error.disposition));
    await failRun(lease, error instanceof AssistantError || error instanceof AiProviderError ? error.code : 'native_executor_failed', known);
  } finally { if (timer) clearInterval(timer); }
}
