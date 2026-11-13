import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, assistantWritesEnabled, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, id, requireCapability, type ActorContext, type EmbeddingGateway, type Evidence } from '../contracts';
import type { KnowledgeContext, ProfessionalKnowledge, ReportWorkmanshipStage } from '../contracts/professional';
import { assertEmbeddingProfile, embeddingGateway } from '../infrastructure/embedding-gateway';
import { activeProfile, text } from './service';
import { expandChineseQuery, queryExpansionConfiguration, queryTermWeights, type QueryExpansionTrace } from './chinese-lexical';
import { sourceScope, sourceReady, validatePreviewSnapshot } from './sources';
import { applicability } from './professional';
import { knowledgeContext, reportStageKnowledgeContext } from './applicability-context';
import type { FileLocator } from '../contracts/source-file';
import { knowledgeEvidence, knowledgeRowAllowed } from './provenance';
import { knowledgeSearchModes } from './rag-tools';
import { selectContextCandidates, type ContextSelectionPolicy } from './context-selection';
import { fuseBranchCandidates, hybridFusionConfiguration } from './hybrid-fusion';
import { requestedKnowledgeTitles } from './query-context';
import { enterpriseKnowledgeEnabled } from '../knowledge-policy';
import { fastGPTPreviewConfiguration, fastGPTCandidates, fastGPTPreviewProtocol } from './fastgpt-retrieval';
import { BailianKnowledgeError, BailianKnowledgeProvider, bailianKnowledgeConfig, knowledgeProviderMode } from './bailian-provider';
import { managedLibrary } from './managed-store';
import type { ManagedSlice } from './managed-provider';

export const retrievalConfiguration = {version:'professional-hybrid-v6',perBranch:hybridFusionConfiguration.perBranch,limit:5,rrfK:hybridFusionConfiguration.rrfK,fusion:hybridFusionConfiguration.rankSource,minSimilarity:0.3,reranker:'none',queryExpansion:queryExpansionConfiguration,agentQuery:'current_question_and_model_terms_v1',contextSelection:'server_applicability_requested_source_document_coverage',maxPerDocumentFirstPass:2,parser:'manual_text_faq_or_local_file_v1'} as const;
export const retrievalConfigurationFor = (policy: ContextSelectionPolicy) => policy === 'ranked'
  ? {...retrievalConfiguration, version:'professional-hybrid-v7', contextSelection:'server_applicability_requested_source_relevance', maxPerDocumentFirstPass:null} as const
  : retrievalConfiguration;
export type RetrievalDiagnostic = {
  configuration:ReturnType<typeof retrievalConfigurationFor>; profileId:string; epoch:number; query:string; terms:string[]; expansion:QueryExpansionTrace; context:KnowledgeContext; elapsedMs:number; embeddingUsage:{inputTokens:number}|null;costMicros:null;
  requestedTitles?:string[]; preferredDocumentIds?:string[];
  request?: Omit<KnowledgeSearchOptions, 'rerank' | 'signal' | 'onEmbeddingDispatch'>; embeddingDispatched?: boolean;
  externalIndex?: { protocol: typeof fastGPTPreviewProtocol; datasetId: string; collectionId: string; corpusSha256: string; returned: number;
    contextCoverage?: 'reviewed_table_first_pass_2' };
  managedIndex?: { provider: 'bailian'; requestId: string | null; returned: number; authorizedDocuments: number };
  candidates:Array<{ref:Evidence['ref'];hash:string;title:string;documentId:string;contentHash:string;similarity:number|null;semanticRank:number|null;lexicalRank:number|null;fusionRank:number;
    disposition:'selected'|'below_similarity'|'ranked_out';selectionRank:number|null;applicability:ReturnType<typeof applicability>|null;contextIncluded?:boolean;contextChars?:number}>;
};
/** Trusted background callers supply their durable source guard. The same
 * candidate and source predicates apply to their scoped reads. */
export type KnowledgeRetrievalScope = {
  authorize(tx: PostgresTransaction): Promise<Row>;
} & ({ kind?: 'followup'; reportStage?: ReportWorkmanshipStage } | { kind: 'owner_delegation'; reportStage?: never });
export async function authorizeKnowledgeRead(tx: PostgresTransaction, actor: ActorContext, conversationId: string, epoch: number,
  scope?: KnowledgeRetrievalScope, readLock: 'update' | 'share' = 'update') {
  requireCapability(actor,actor.principal.kind==='user'?'assistant.chat.self'
    :actor.capabilities.includes('assistant.project.shared')?'assistant.project.shared':actor.capabilities.includes('assistant.followup.self')?'assistant.followup.self':'assistant.preview.self');
  if (!Number.isSafeInteger(epoch) || epoch < 0) fail('invalid_message',422);
  const repo = new AssistantRepository(tx, actor);
  const delegated = scope?.kind === 'owner_delegation';
  if (delegated ? actor.principal.kind !== 'user' || readLock !== 'share'
    : scope && !actor.capabilities.includes('assistant.followup.delivery')) fail('assistant_capability_forbidden', 403);
  const settings = delegated ? await one(tx, sql`select * from app.assistant_enterprise_settings
    where enterprise_id=${actor.enterpriseId} for share`) : await repo.settings(readLock === 'update', readLock);
  if (!assistantWritesEnabled(settings)) fail('assistant_disabled', 403);
  const current = delegated ? await scope.authorize(tx) : await repo.conversation(id(conversationId), readLock);
  if (current.purpose !== 'knowledge_preview' && !enterpriseKnowledgeEnabled(settings!.agent_config)) fail('enterprise_knowledge_disabled', 403);
  if (Number(settings!.knowledge_epoch)!==epoch) fail('context_changed');
  const conversation = scope && !delegated ? await scope.authorize(tx) : current;
  if (delegated && (conversation.purpose !== 'customer_consultation' || conversation.status !== 'open' || conversation.mode !== 'ai'))
    fail('context_changed');
  if (String(conversation.id) !== conversationId || (!scope && (conversation.status!=='open' || conversation.mode!=='ai'))) fail('context_changed');
  await validatePreviewSnapshot(tx,actor,conversation);
  const stageContext = scope?.reportStage ? await reportStageKnowledgeContext(tx,actor,conversation,scope.reportStage) : undefined;
  if (scope?.reportStage && !stageContext) fail('context_changed');
  return {settings: settings!, conversation, context: stageContext ?? await knowledgeContext(tx,actor,conversation)};
}
export type KnowledgeSearchOptions = {
  mode?: typeof knowledgeSearchModes[number]; category?: string; documentId?: string;
  scope?: 'enterprise' | 'project'; topK?: number; minSimilarity?: number;
  /** Optional local reranker. Its input and output are limited to authorized candidates. */
  rerank?: (candidates: readonly Evidence[]) => readonly string[];
  signal?: AbortSignal; onEmbeddingDispatch?: () => Promise<void>;
};

const knowledgeColumns = sql`c.id::text,c.text,c.text_hash,c.content_hash,c.document_version_id::text,c.locator,
  d.id::text as document_id,d.title,d.category,d.source_type,d.scope,d.project_id::text,v.professional,
  v.version_number,v.published_at,v.effective_from,v.effective_to,e.name as enterprise_name`;
const knowledgeJoins = sql`from app.assistant_knowledge_chunks c
  join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
  join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
  join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
  join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
  join app.enterprises e on e.id=d.enterprise_id`;

type Candidate = Row & {
  id: string; document_id: string; document_version_id: string; content_hash: string; title: string;
  locator: { file?: FileLocator; start?: number }; professional: ProfessionalKnowledge | null;
  distance: number | null; semantic_rank: number | null; lexical_rank: number | null;
};
function candidateEvidence(row: Candidate, context: KnowledgeContext): Evidence {
  return {
    ...knowledgeEvidence(row), ...(row.distance === null ? {} : { similarity: 1 - row.distance }),
    ...(row.professional ? { professional: { documentId: row.document_id, title: row.title, contentHash: row.content_hash,
      entry: row.professional, applicability: applicability(row.professional, context), context } } : {}),
  };
}

/** Current authorized excerpts only. The manager's document/version/original API
 * is the separate historical access path. Guessed IDs have the same empty result
 * as withdrawn, expired, out-of-scope or nonexistent sources. */
export async function readKnowledgeTarget(tx: PostgresTransaction, actor: ActorContext, conversationId: string, epoch: number,
  target: { documentId: string } | { versionId: string; chunkId: string }) {
  const { conversation, context } = await authorizeKnowledgeRead(tx, actor, conversationId, epoch);
  const byDocument = 'documentId' in target;
  const filter = byDocument ? sql`d.id=${id(target.documentId)}`
    : sql`c.id=${id(target.chunkId)} and v.id=${id(target.versionId)}`;
  const found = await rows<Candidate>(tx, sql`select ${knowledgeColumns},null::float8 as distance
    ${knowledgeJoins} where c.enterprise_id=${actor.enterpriseId} and ${sourceReady}
      and ${sourceScope(actor,conversation,false,context.projectId)} and ${filter}
    order by c.ordinal limit ${byDocument ? 3 : 1}`);
  return found.filter(knowledgeRowAllowed).map(row => candidateEvidence(row, context));
}

/** An index filter is a recall hint. Identity and exact reviewed hashes are
 * matched a second time inside the authorized transaction. */
export function verifiedManagedHits(slices: ManagedSlice[], workspaceId: string, indexId: string,
  allowed: Array<{ document: string; tag: string }>) {
  const tags = new Map(allowed.map(row => [row.document, row.tag])), seen = new Set<string>();
  return slices.flatMap((slice, rank) => {
    const tag = tags.get(slice.documentId);
    if (!tag || slice.workspaceId !== workspaceId || slice.indexId !== indexId
      || !Number.isFinite(slice.score) || slice.score < 0) return [];
    const hash = fingerprint(slice.text), key = slice.documentId + ':' + slice.id + ':' + hash;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ tag, documentId: slice.documentId, sliceId: slice.id, hash,
      similarity: Math.min(1, slice.score), semanticRank: rank + 1 }];
  });
}

/** Both the existing consumers and R4 tools use this candidate and source path. */
export async function retrieveKnowledge(conversationId: string, actor: ActorContext, query: string, epoch: number,
  gateway?: EmbeddingGateway, scope?: KnowledgeRetrievalScope, selection: ContextSelectionPolicy = 'document_coverage',
  options?: KnowledgeSearchOptions, transaction?: PostgresTransaction) {
  const started = Date.now(), mode = options?.mode ?? 'hybrid', limit = options?.topK ?? retrievalConfiguration.limit;
  const hosted = knowledgeProviderMode() === 'bailian';
  // The managed hybrid score is provider-specific, rather than cosine.
  const minSimilarity = options?.minSimilarity ?? (hosted ? 0.12 : retrievalConfiguration.minSimilarity);
  query = text(query, 1000);
  if (!knowledgeSearchModes.includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 10
    || !Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1
    || options?.scope && !['enterprise','project'].includes(options.scope)) fail('invalid_message', 422);
  const category = options?.category === undefined ? undefined : text(options.category, 100);
  const documentId = options?.documentId === undefined ? undefined : id(options.documentId);
  const filters = sql`${category === undefined && !documentId ? sql`and d.source_type<>'reference_case'` : sql``}
    ${category === undefined ? sql`` : sql`and d.category=${category}`}
    ${documentId ? sql`and d.id=${documentId}` : sql``}
    ${options?.scope ? sql`and d.scope=${options.scope}` : sql``}`;
  const managedJoins = sql`join app.assistant_managed_knowledge_imports mi on mi.enterprise_id=v.enterprise_id and mi.version_id=v.id
    and mi.edit_version=v.edit_version and mi.content_hash=v.content_hash and mi.ready and mi.revoked_at is null`;
  // An event consumer already holding the origin conversation must reuse its
  // transaction. A second connection would wait on the consumer's own lock.
  const withinTenant = <T>(read: (tx: PostgresTransaction) => Promise<T>) =>
    transaction ? read(transaction) : withTenantTransaction(actor.enterpriseId, read);
  const authorize = (tx: PostgresTransaction) =>
    authorizeKnowledgeRead(tx, actor, conversationId, epoch, scope, transaction ? 'share' : 'update');
  const admission = await withinTenant(async tx => {
    const { settings, conversation, context } = await authorize(tx);
    if (hosted) {
      if (mode === 'vector') fail('knowledge_search_mode_unavailable', 422);
      // An empty authorized corpus and an unconfigured hosted provider have
      // different meanings to the Agent. Keyword reads stay local.
      if (mode === 'hybrid') {
        try { bailianKnowledgeConfig(); }
        catch (error) {
          if (error instanceof AssistantError) throw new BailianKnowledgeError('configuration', error.code,
            null, null, true, 'retrieval_unavailable');
          throw error;
        }
      }
      const library = await managedLibrary(tx, actor.enterpriseId);
      const allowed = mode === 'hybrid' && library?.index_id ? await rows<{ tag: string; document: string }>(tx, sql`
        select distinct mi.version_tag as tag,mi.index_document_id as document ${knowledgeJoins} ${managedJoins}
        where c.enterprise_id=${actor.enterpriseId} and c.index_profile_id=${library.index_profile_id}
          and mi.workspace_id=${library.workspace_id} and ${sourceReady} and ${sourceScope(actor,conversation,false,context.projectId)}
          ${filters}`) : [];
      return { profileId: library?.index_profile_id ?? String(settings.active_index_profile_id ?? '0'),
        projectId: context.projectId, external: undefined, hasCandidates: mode === 'keyword' || !!allowed.length, library, allowed };
    }
    const profile = await activeProfile(tx,actor.enterpriseId,settings);
    const external = !options && actor.principal.kind === 'admin' && conversation.purpose === 'knowledge_preview'
      ? fastGPTPreviewConfiguration(actor.enterpriseId) : undefined;
    const hasCandidates = (external || options && mode !== 'keyword') ? !!await one(tx, sql`select c.id ${knowledgeJoins}
      where c.enterprise_id=${actor.enterpriseId} and c.index_profile_id=${String(profile.id)}
      and ${sourceReady} and ${sourceScope(actor,conversation,false,context.projectId)}
      ${filters} ${external ? sql`and c.locator->'file'->'extraction'->>'corpusSha256'=${external.corpusSha256}` : sql``} limit 1`) : true;
    return { profileId: String(profile.id), projectId: context.projectId, external, hasCandidates, library: undefined, allowed: [] };
  });
  const { external, library, allowed } = admission;
  const managedHybrid = hosted && mode === 'hybrid';
  let managedRequestId: string | null = null, managedReturned = 0;
  let managedHits: ReturnType<typeof verifiedManagedHits> = [];
  if (managedHybrid && library?.index_id && allowed.length) {
    try {
      const provider = new BailianKnowledgeProvider();
      if (provider.workspaceId !== library.workspace_id) fail('retrieval_unavailable', 503);
      const found = await provider.retrieve({ indexId: library.index_id, tags: allowed.map(item => item.tag),
        query, topK: Math.max(limit, 20), signal: options?.signal });
      managedRequestId = found.requestId;
      managedReturned = found.value.length;
      managedHits = verifiedManagedHits(found.value, provider.workspaceId, library.index_id, allowed);
    } catch (error) {
      if (error instanceof BailianKnowledgeError) throw new BailianKnowledgeError(error.operation, error.providerCode,
        error.requestId, error.httpStatus, error.outcomeKnown, 'retrieval_unavailable');
      if (error instanceof AssistantError && error.code.startsWith('bailian_knowledge_')) fail('retrieval_unavailable', 503);
      throw error;
    }
  }
  const externalCandidates = external && admission.hasCandidates ? await fastGPTCandidates(external, query) : [];
  let result: Awaited<ReturnType<EmbeddingGateway['embed']>> | null = null;
  if (!hosted && !external && mode !== 'keyword' && admission.hasCandidates) {
    const embed = gateway ?? embeddingGateway();
    assertEmbeddingProfile(embed);
    options?.signal?.throwIfAborted();
    await options?.onEmbeddingDispatch?.();
    options?.signal?.throwIfAborted();
    result = await embed.embed([query], 'query', options?.signal);
  }
  const expanded = expandChineseQuery(query), terms = expanded.terms;
  const lexical = mode !== 'vector' && !managedHybrid, semantic = mode !== 'keyword' && (!!result || !!external || managedHybrid);
  const lexicalScore = lexical ? sql`(select coalesce(sum((${JSON.stringify(queryTermWeights(expanded))}::jsonb->>t)::int),0)
    from unnest(c.terms) t where t in (select jsonb_array_elements_text(${JSON.stringify(terms)}::jsonb)))` : sql`0`;
  const distance = external || managedHybrid ? sql`1-(hit->>'similarity')::float8`
    : result ? sql`c.embedding <=> ${JSON.stringify(result.vectors[0])}::vector` : sql`null::float8`;
  return withinTenant(async tx=>{
    options?.signal?.throwIfAborted();
    const {settings,conversation,context} = await authorize(tx);
    if (admission.projectId !== context.projectId) fail('context_changed');
    if (hosted) {
      const current = await managedLibrary(tx, actor.enterpriseId);
      if (current?.index_id !== library?.index_id || current?.index_profile_id !== library?.index_profile_id
        || current?.workspace_id !== library?.workspace_id) fail('context_changed');
    } else {
      const profile = await activeProfile(tx,actor.enterpriseId,settings);
      if (admission.profileId !== String(profile.id)) fail('context_changed');
    }
    // Materialize the filtered set before either branch ranks a candidate.
    const candidates = admission.hasCandidates && (!managedHybrid || managedHits.length) ? await rows<Candidate>(tx, sql`with authorized as materialized (
      select ${knowledgeColumns},${distance} as distance,${lexicalScore} as lexical
        ${external || managedHybrid ? sql`,(hit->>'semanticRank')::int as external_rank` : sql``}
      ${knowledgeJoins}
      ${external ? sql`join jsonb_array_elements(${JSON.stringify(externalCandidates)}::jsonb) hit
        on c.locator->'file'->'extraction'->>'chunkIndex'=hit->>'chunkIndex'
        and c.locator->'file'->'extraction'->>'chunkSha256'=hit->>'chunkSha256'` : sql``}
      ${managedHybrid ? sql`${managedJoins} join jsonb_array_elements(${JSON.stringify(managedHits)}::jsonb) hit
        on mi.index_document_id=hit->>'documentId' and mi.version_tag=hit->>'tag'
        and c.locator->'managed'->>'id'=hit->>'sliceId' and c.locator->'managed'->>'hash'=hit->>'hash'` : sql``}
      where c.enterprise_id=${actor.enterpriseId} and ${sourceReady}
        and ${sourceScope(actor,conversation,false,context.projectId)} ${filters}
        ${!hosted || managedHybrid ? sql`and c.index_profile_id=${admission.profileId}` : sql``}
        ${managedHybrid ? sql`and mi.workspace_id=${library!.workspace_id}` : sql``}
        ${external ? sql`and c.locator->'file'->'extraction'->>'corpusSha256'=${external.corpusSha256}` : sql``}
    ), semantic as (
      ${external || managedHybrid ? sql`select id,external_rank as semantic_rank from authorized where external_rank is not null`
        : sql`select id,(row_number() over(order by distance,id))::int as semantic_rank from authorized
          where ${semantic} ${options ? sql`and distance<=${1 - minSimilarity}` : sql``}
          order by distance,id limit ${retrievalConfiguration.perBranch}`}
    ), lexical as (
      select id,(row_number() over(order by lexical desc,id))::int as lexical_rank from authorized
      where lexical>0 order by lexical desc,id limit ${retrievalConfiguration.perBranch}
    ), branch_ids as (select id from semantic union select id from lexical)
    select a.*,s.semantic_rank,l.lexical_rank from authorized a join branch_ids b on b.id=a.id
      left join semantic s on s.id=a.id left join lexical l on l.id=a.id`) : [];
    const safe = candidates.filter(knowledgeRowAllowed);
    const ranks = new Map(safe.map(c => [c.id, { semanticRank: c.semantic_rank, lexicalRank: c.lexical_rank }]));
    const fused = fuseBranchCandidates(safe,ranks,retrievalConfiguration.perBranch*2);
    const seen = new Set<string>();
    const conditions = new Map(fused.map(c => [c.id,c.professional ? applicability(c.professional,context) : null]));
    const requestedTitles = requestedKnowledgeTitles(query);
    const normalize = (value: string) => value.replace(/\s/gu,'').toLowerCase();
    const preferredDocuments = new Set(fused.filter(c => requestedTitles.some(title => normalize(c.title).includes(normalize(title)))).map(c => c.document_id));
    const eligible = fused.filter(c => {
      if (!(c.distance === null || 1 - c.distance >= minSimilarity || !!options && c.lexical_rank !== null)) return false;
      if (!hosted) return true;
      const key = c.document_version_id + ':' + (c.locator?.start ?? c.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const ranked = options?.rerank ? new Map(options.rerank(eligible.map(c => candidateEvidence(c, context))).map((id, rank) => [id, rank])) : null;
    if (ranked) eligible.sort((a,b) => (ranked.get(a.id) ?? Infinity) - (ranked.get(b.id) ?? Infinity) || 0);
    const reviewedTables = !!external && eligible.some(c => c.locator?.file?.extraction?.review);
    const selected = selectContextCandidates(eligible,conditions,limit,preferredDocuments,selection,reviewedTables ? c => {
      const extraction = c.locator?.file?.extraction;
      return extraction?.review ? `table:${c.document_version_id}:${extraction.chunkIndex}` : `row:${c.id}`;
    } : undefined);
    const evidence = selected.map(c => candidateEvidence(c,context));
    const diagnostic: RetrievalDiagnostic = {
      configuration: retrievalConfigurationFor(selection), profileId: admission.profileId, epoch, query, terms,
      expansion: expanded.expansion, context, elapsedMs: Date.now()-started, embeddingUsage: result?.usage ?? null, costMicros: null,
      ...(options ? { request: { mode, category, documentId, scope: options.scope, topK: limit, minSimilarity }, embeddingDispatched: !!result } : {}),
      ...(managedHybrid ? { managedIndex: { provider:'bailian' as const, requestId:managedRequestId,
        returned:managedReturned, authorizedDocuments:allowed.length } } : {}),
      ...(external ? { externalIndex: { protocol:fastGPTPreviewProtocol,datasetId:external.datasetId,collectionId:external.collectionId,
        corpusSha256:external.corpusSha256,returned:externalCandidates.length,...(reviewedTables ? {contextCoverage:'reviewed_table_first_pass_2' as const} : {}) } } : {}),
      requestedTitles, preferredDocumentIds: [...preferredDocuments],
      candidates: fused.map((c,i) => ({ ref: {type:'knowledge_chunk',id:c.id,version:c.document_version_id},hash:c.text_hash as string,
        title:c.title,documentId:c.document_id,contentHash:c.content_hash,similarity:c.distance === null ? null : 1-c.distance,
        semanticRank:c.semantic_rank,lexicalRank:c.lexical_rank,fusionRank:i+1,
        disposition: !eligible.includes(c) ? 'below_similarity' : selected.includes(c) ? 'selected' : 'ranked_out',
        selectionRank: selected.includes(c) ? selected.indexOf(c)+1 : null,applicability:conditions.get(c.id) ?? null })),
    };
    return { evidence, diagnostic };
  });
}
