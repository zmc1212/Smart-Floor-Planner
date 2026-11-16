import { sql, type SQL } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, assistantWritesEnabled, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, id, requireCapability, type ActorContext, type EmbeddingGateway, type Evidence } from '../contracts';
import type { KnowledgeContext, ProfessionalKnowledge, ReportWorkmanshipStage } from '../contracts/professional';
import { assertEmbeddingProfile, configuredEmbeddingProfile, embeddingGateway, EMBEDDING_PROFILE } from '../infrastructure/embedding-gateway';
import { text } from './service';
import { expandChineseQuery, queryExpansionConfiguration, queryTermWeights, type QueryExpansionTrace } from './chinese-lexical';
import { sourceScope, sourceReady, sourceStage, validatePreviewSnapshot } from './sources';
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
import { BAILIAN_RAG, LOCAL_PGVECTOR, BailianKnowledgeError, BailianKnowledgeProvider, knowledgeProviderMode } from './bailian-provider';
import { fallbackEmbeddingProfile, hasLocalKnowledgeVector, managedIndexConfiguration, managedLibrary, sourceIndexReady } from './managed-store';
import { platformKnowledgeScope, platformKnowledgeSupplement, readPlatformKnowledge } from './platform-library';
import type { ManagedReceipt, ManagedSlice } from './managed-provider';

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
  provider?: typeof BAILIAN_RAG | typeof LOCAL_PGVECTOR | 'FASTGPT' | 'LOCAL_KEYWORD';
  embeddingProfile?: EmbeddingGateway['profile'];
  /** The destination and outcome of each managed request, including a failed primary before fallback. */
  managedIndex?: { provider: 'bailian'; requestId: string | null; returned: number; authorizedDocuments: number;
    requests?: ManagedQueryReceipt[] };
  fallback?: { reason: string; model: string; revision: string };
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
  locator: { file?: FileLocator; start?: number; managed?: { id: string } }; professional: ProfessionalKnowledge | null;
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
  const lookup = (enterpriseId: string, platform: boolean) => rows<Candidate>(tx, sql`select ${knowledgeColumns},null::float8 as distance,
    ${platform}::boolean as platform_knowledge
    ${knowledgeJoins} where c.enterprise_id=${enterpriseId} and ${sourceReady} and e.status='active'
      and ${platform ? platformKnowledgeScope : sourceScope(actor,conversation,false,context.projectId)}
      and ${sourceStage(context.stage)} and ${filter}
    order by c.ordinal limit ${byDocument ? 3 : 1}`);
  let found = await lookup(actor.enterpriseId, false);
  if (!found.length) {
    const corpus = await platformKnowledgeSupplement(tx, actor, conversation);
    if (corpus) found = await readPlatformKnowledge(tx, corpus, () => lookup(corpus, true));
  }
  return found.filter(verifiedOriginal).map(row => candidateEvidence(row, context));
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

type ManagedQueryReceipt = {
  workspaceId: string; indexId: string; model: string; requestId: string | null;
  documents: string[]; returned: number; inputTokens: number | null; costMicros: null;
  error?: { code: string; httpStatus: number | null; outcomeKnown: boolean };
};

export class KnowledgeSearchUnavailable extends BailianKnowledgeError {
  constructor(primary: BailianKnowledgeError, readonly requests: ManagedQueryReceipt[], readonly fallbackError?: string) {
    super(primary.operation, primary.providerCode, primary.requestId, primary.httpStatus, primary.outcomeKnown, 'retrieval_unavailable');
  }
  get diagnostic() {
    return { primary: BAILIAN_RAG, code: this.providerCode, requestId: this.requestId, operation: this.operation,
      requests: this.requests, ...(this.fallbackError ? { fallback: LOCAL_PGVECTOR, fallbackError: this.fallbackError } : {}) };
  }
}

type AuthorizedVersion = Row & {
  version_id: string; index_profile_id: string; profile_key: string; configuration: Row;
  chunk_count: number; local_chunks: number; fallback_chunks: number; ready: boolean;
  document: string | null; tag: string | null;
};
type Corpus = { enterpriseId: string; platform: boolean; epoch: number; profileId: string; versions: AuthorizedVersion[];
  library: Awaited<ReturnType<typeof managedLibrary>> };
type ReadState = Awaited<ReturnType<typeof authorizeKnowledgeRead>>;

const managedJoins = sql`left join app.assistant_managed_knowledge_imports mi
  on mi.enterprise_id=v.enterprise_id and mi.version_id=v.id and mi.edit_version=v.edit_version
  and mi.content_hash=v.content_hash and mi.ready and mi.revoked_at is null`;

function corpusScope(actor: ActorContext, state: ReadState, platform: boolean, filters: SQL) {
  return sql`e.status='active' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())
    and ${platform ? platformKnowledgeScope : sourceScope(actor,state.conversation,false,state.context.projectId)}
    and ${sourceStage(state.context.stage)} ${filters}`;
}

function withinCorpus<T>(tx: PostgresTransaction, corpus: Pick<Corpus,'platform'|'enterpriseId'>, read: () => Promise<T>) {
  return corpus.platform ? readPlatformKnowledge(tx, corpus.enterpriseId, read) : read();
}

async function loadCorpus(tx: PostgresTransaction, actor: ActorContext, state: ReadState, filters: SQL, enterpriseId: string,
  platform = false): Promise<Corpus> {
  return withinCorpus(tx, { enterpriseId, platform }, async () => {
    const settings = platform ? await one(tx, sql`select knowledge_epoch,active_index_profile_id
      from app.assistant_enterprise_settings where enterprise_id=${enterpriseId} for share`) : state.settings;
    const library = await managedLibrary(tx, enterpriseId);
    const versions = await rows<AuthorizedVersion>(tx, sql`select v.id::text as version_id,v.edit_version,v.content_hash,
        v.index_profile_id::text,ip.configuration,ip.profile_key,v.chunk_count,
        (v.index_status='ready' and v.indexed_hash=v.content_hash and v.chunk_count>0 and ${sourceIndexReady}) as ready,
        mi.index_document_id as document,mi.version_tag as tag,
        vectors.local_chunks,vectors.fallback_chunks
      from app.assistant_knowledge_versions v join app.assistant_knowledge_documents d
        on d.enterprise_id=v.enterprise_id and d.id=v.document_id
      join app.assistant_enterprise_settings s on s.enterprise_id=v.enterprise_id
      join app.enterprises e on e.id=d.enterprise_id
      left join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=v.enterprise_id and ip.id=v.index_profile_id
      ${managedJoins}
      cross join lateral (
        select count(*) filter(where c.embedding is not null)::int as local_chunks,
          count(*) filter(where c.embedding is not null and c.locator->>'localEmbeddingProfile'=${fallbackEmbeddingProfile})::int as fallback_chunks
        from app.assistant_knowledge_chunks c where c.enterprise_id=v.enterprise_id and c.document_version_id=v.id
          and c.index_profile_id=v.index_profile_id and c.content_hash=v.content_hash
      ) vectors
      where v.enterprise_id=${enterpriseId} and ${corpusScope(actor,state,platform,filters)}
      order by v.id,mi.version_tag`);
    return { enterpriseId, platform, epoch: Number(settings?.knowledge_epoch ?? 0),
      profileId: String(library?.index_profile_id ?? settings?.active_index_profile_id ?? '0'), versions, library };
  });
}

function managedBinding(corpus: Corpus, version: AuthorizedVersion) {
  const { library } = corpus;
  if (!version.ready || !library?.index_id || !version.document || !version.tag || version.index_profile_id !== library.index_profile_id) return false;
  const model = version.configuration?.model;
  if (typeof model !== 'string') return false;
  const expected = managedIndexConfiguration(library.workspace_id, model);
  return version.profile_key === expected.key && fingerprint(version.configuration) === fingerprint(expected.config);
}

function localBinding(corpus: Corpus, version: AuthorizedVersion, profile: ReturnType<typeof configuredEmbeddingProfile>) {
  if (!version.ready) return false;
  if (version.configuration?.provider === 'bailian')
    return profile === EMBEDDING_PROFILE && managedBinding(corpus, version) && version.chunk_count === version.fallback_chunks;
  return version.profile_key === profile.id && fingerprint(version.configuration) === fingerprint(profile);
}

function canFallback(error: BailianKnowledgeError) {
  return ['bailian_knowledge_not_configured','transport_error','provider_downgrade'].includes(error.providerCode)
    || (error.httpStatus ?? 0) >= 500 || [408, 429].includes(error.httpStatus ?? 0);
}

function verifiedOriginal(row: Row) {
  return knowledgeRowAllowed(row) && fingerprint(row.text) === row.text_hash;
}

/** Admission, dispatch and revalidation use the same document versions for both engines. */
export async function retrieveKnowledge(conversationId: string, actor: ActorContext, query: string, epoch: number,
  gateway?: EmbeddingGateway, scope?: KnowledgeRetrievalScope, selection: ContextSelectionPolicy = 'document_coverage',
  options?: KnowledgeSearchOptions, transaction?: PostgresTransaction) {
  const started = Date.now(), mode = options?.mode ?? 'hybrid', limit = options?.topK ?? retrievalConfiguration.limit;
  const hosted = knowledgeProviderMode() === 'bailian';
  query = text(query, 1000);
  if (!knowledgeSearchModes.includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 10
    || options?.minSimilarity !== undefined && (!Number.isFinite(options.minSimilarity) || options.minSimilarity < 0 || options.minSimilarity > 1)
    || options?.scope && !['enterprise','project'].includes(options.scope)) fail('invalid_message', 422);
  if (hosted && mode === 'vector') fail('knowledge_search_mode_unavailable', 422);
  const category = options?.category === undefined ? undefined : text(options.category, 100);
  const documentId = options?.documentId === undefined ? undefined : id(options.documentId);
  const filters = sql`${category === undefined && !documentId ? sql`and d.source_type<>'reference_case'` : sql``}
    ${category === undefined ? sql`` : sql`and d.category=${category}`}
    ${documentId ? sql`and d.id=${documentId}` : sql``}
    ${options?.scope ? sql`and d.scope=${options.scope}` : sql``}`;
  const withinTenant = <T>(read: (tx: PostgresTransaction) => Promise<T>) =>
    transaction ? read(transaction) : withTenantTransaction(actor.enterpriseId, read);
  const authorize = (tx: PostgresTransaction) =>
    authorizeKnowledgeRead(tx, actor, conversationId, epoch, scope, transaction ? 'share' : 'update');
  async function admit(tx: PostgresTransaction, state: ReadState) {
    const corpora = [await loadCorpus(tx, actor, state, filters, actor.enterpriseId)];
    const platform = !options?.scope && await platformKnowledgeSupplement(tx, actor, state.conversation);
    if (platform) corpora.push(await loadCorpus(tx, actor, state, filters, platform, true));
    return corpora;
  }
  const admission = await withinTenant(async tx => {
    const state = await authorize(tx);
    return { context: state.context, corpora: await admit(tx, state),
      external: !hosted && !options && actor.principal.kind === 'admin' && state.conversation.purpose === 'knowledge_preview'
        ? fastGPTPreviewConfiguration(actor.enterpriseId) : undefined };
  });
  const { external, corpora } = admission;
  async function reauthorize(tx: PostgresTransaction) {
    const state = await authorize(tx);
    if (fingerprint(admission.context) !== fingerprint(state.context)) fail('context_changed');
    if (fingerprint(await admit(tx,state)) !== fingerprint(corpora)) fail('context_changed');
    return state;
  }
  const versions = corpora.flatMap(c => c.versions);
  const externalCandidates = external && versions.some(v => v.ready) ? await fastGPTCandidates(external, query) : [];
  let provider: NonNullable<RetrievalDiagnostic['provider']> = mode === 'keyword' ? 'LOCAL_KEYWORD'
    : external ? 'FASTGPT' : hosted ? BAILIAN_RAG : LOCAL_PGVECTOR;
  let result: Awaited<ReturnType<EmbeddingGateway['embed']>> | null = null;
  let localProfile: ReturnType<typeof configuredEmbeddingProfile> | undefined;
  let primaryError: BailianKnowledgeError | undefined;
  const requests: ManagedQueryReceipt[] = [];
  const hits = new Map<string, ReturnType<typeof verifiedManagedHits>>();
  if (provider === BAILIAN_RAG) {
    try {
      const client = new BailianKnowledgeProvider();
      const destinations = corpora.map(corpus => {
        const library = corpus.library;
        const allowed = corpus.versions.filter(v => v.configuration?.provider === 'bailian');
        if (library && library.workspace_id !== client.workspaceId
          || allowed.some(v => !managedBinding(corpus,v) || v.configuration.model !== client.model)
          || new Set(allowed.map(v => v.version_id)).size !== allowed.length
          || (corpus.versions.length > 0 && !allowed.length))
          throw new BailianKnowledgeError('mapping','bailian_knowledge_mapping_unavailable',null,null,true);
        return { corpus, indexId: library?.index_id, allowed: allowed.map(v => ({ document: v.document!, tag: v.tag! })) };
      });
      for (const { corpus, indexId, allowed } of destinations) {
        if (!indexId || !allowed.length) continue;
        options?.signal?.throwIfAborted();
        if (requests.length) await withinTenant(reauthorize);
        const receipt: ManagedQueryReceipt = { workspaceId: client.workspaceId, indexId, model: client.model, requestId: null,
          documents: [], returned: 0, inputTokens: null, costMicros: null };
        requests.push(receipt);
        let found: ManagedReceipt<ManagedSlice[]>;
        try {
          found = await client.retrieve({ indexId, tags: allowed.map(item => item.tag), query,
            topK: Math.max(limit, 20), signal: options?.signal });
        } catch (error) {
          if (error instanceof BailianKnowledgeError) {
            receipt.requestId = error.requestId;
            receipt.error = { code: error.providerCode, httpStatus: error.httpStatus, outcomeKnown: error.outcomeKnown };
          }
          throw error;
        }
        const verified = verifiedManagedHits(found.value, client.workspaceId, indexId, allowed);
        hits.set(corpus.enterpriseId, verified);
        receipt.requestId = found.requestId;
        receipt.returned = found.value.length;
        receipt.documents = [...new Set(verified.map(hit => hit.documentId))];
        receipt.inputTokens = found.usage?.inputTokens ?? null;
      }
    } catch (error) {
      options?.signal?.throwIfAborted();
      primaryError = error instanceof BailianKnowledgeError ? error
        : error instanceof AssistantError && error.code.startsWith('bailian_knowledge_')
          ? new BailianKnowledgeError('configuration',error.code,null,null,true) : undefined;
      if (!primaryError) throw error;
      if (!canFallback(primaryError)) throw new KnowledgeSearchUnavailable(primaryError, requests);
      provider = LOCAL_PGVECTOR;
    }
  }

  if (provider === LOCAL_PGVECTOR) {
    if (primaryError) await withinTenant(reauthorize);
    try {
      const profile = localProfile = primaryError ? EMBEDDING_PROFILE : configuredEmbeddingProfile();
      if (primaryError) {
        // A partial cache cannot yield a reliable no-match.
        const complete = corpora.every(c => c.versions.every(v => localBinding(c,v,profile) && v.chunk_count===v.local_chunks));
        if (!versions.length || !complete || configuredEmbeddingProfile() !== EMBEDDING_PROFILE)
          fail('local_index_incompatible', 503);
      }
      const hasCompatibleVersion = corpora.some(c => c.versions.some(v => localBinding(c,v,profile)));
      if (!hasCompatibleVersion && versions.some(v => v.ready)) fail('retrieval_unavailable', 503);
      if (hasCompatibleVersion) {
        if (!await withinTenant(hasLocalKnowledgeVector)) fail('local_vector_unavailable', 503);
        const embed = gateway ?? embeddingGateway();
        assertEmbeddingProfile(embed, profile);
        options?.signal?.throwIfAborted();
        await options?.onEmbeddingDispatch?.();
        options?.signal?.throwIfAborted();
        result = await embed.embed([query], 'query', options?.signal);
      }
    } catch (error) {
      options?.signal?.throwIfAborted();
      if (primaryError) throw new KnowledgeSearchUnavailable(primaryError, requests,
        error instanceof AssistantError ? error.code : 'local_vector_unavailable');
      if (error instanceof AssistantError && error.code !== 'local_vector_unavailable') throw error;
      fail('retrieval_unavailable', 503);
    }
  }

  const minSimilarity = options?.minSimilarity ?? (provider === BAILIAN_RAG ? 0.12 : retrievalConfiguration.minSimilarity);
  const expanded = expandChineseQuery(query), terms = expanded.terms;
  const lexical = mode !== 'vector' && provider !== BAILIAN_RAG;
  const lexicalScore = lexical ? sql`(select coalesce(sum((${JSON.stringify(queryTermWeights(expanded))}::jsonb->>t)::int),0)
    from unnest(c.terms) t where t in (select jsonb_array_elements_text(${JSON.stringify(terms)}::jsonb)))` : sql`0`;
  const fromProvider = provider === BAILIAN_RAG || !!external;
  const distance = fromProvider ? sql`1-(hit->>'similarity')::float8`
    : result ? sql`c.embedding <=> ${JSON.stringify(result.vectors[0])}::vector` : sql`null::float8`;
  return withinTenant(async tx => {
    options?.signal?.throwIfAborted();
    const state = await reauthorize(tx);
    const { context } = state;
    const candidates: Candidate[] = [];
    const conditions = new Map<string, ReturnType<typeof applicability> | null>();
    const requestedTitles = requestedKnowledgeTitles(query), preferredDocuments = new Set<string>();
    const selected: Candidate[] = [], eligible: Candidate[] = [];
    let reviewedTables = false;
    const normalize = (value: string) => value.replace(/\s/gu,'').toLowerCase();
    for (const corpus of corpora) {
      const managedHits = hits.get(corpus.enterpriseId) ?? [];
      const allowedVersions = corpus.versions.filter(v => v.ready &&
        (!localProfile || localBinding(corpus,v,localProfile)));
      if (!allowedVersions.length || provider === BAILIAN_RAG && !managedHits.length || external && !externalCandidates.length) continue;
      const matched = await withinCorpus(tx,corpus,() => rows<Candidate>(tx, sql`with authorized as materialized (
        select ${knowledgeColumns},${distance} as distance,${lexicalScore} as lexical,
          ${corpus.platform}::boolean as platform_knowledge
          ${fromProvider ? sql`,(hit->>'semanticRank')::int as external_rank` : sql``}
        ${knowledgeJoins}
        ${external ? sql`join jsonb_array_elements(${JSON.stringify(externalCandidates)}::jsonb) hit
          on c.locator->'file'->'extraction'->>'chunkIndex'=hit->>'chunkIndex'
          and c.locator->'file'->'extraction'->>'chunkSha256'=hit->>'chunkSha256'` : sql``}
        ${provider === BAILIAN_RAG ? sql`${managedJoins}
          join jsonb_array_elements(${JSON.stringify(managedHits)}::jsonb) hit
          on mi.index_document_id=hit->>'documentId' and mi.version_tag=hit->>'tag'
          and c.locator->'managed'->>'id'=hit->>'sliceId' and c.locator->'managed'->>'hash'=hit->>'hash'` : sql``}
        where c.enterprise_id=${corpus.enterpriseId} and ${sourceReady} and ${corpusScope(actor,state,corpus.platform,filters)}
          and v.id in (${sql.join(allowedVersions.map(v => sql`${v.version_id}`),sql`,`)})
          ${localProfile ? sql`and c.embedding is not null` : sql``}
          ${provider === BAILIAN_RAG ? sql`and mi.workspace_id=${corpus.library!.workspace_id}` : sql``}
          ${external ? sql`and c.locator->'file'->'extraction'->>'corpusSha256'=${external.corpusSha256}` : sql``}
      ), semantic as (
        ${fromProvider ? sql`select id,external_rank as semantic_rank from authorized where external_rank is not null`
          : sql`select id,(row_number() over(order by distance,id))::int as semantic_rank from authorized
            where ${!!result} ${options || primaryError ? sql`and distance<=${1 - minSimilarity}` : sql``}
            order by distance,id limit ${retrievalConfiguration.perBranch}`}
      ), lexical as (
        select id,(row_number() over(order by lexical desc,id))::int as lexical_rank from authorized
        where lexical>0 order by lexical desc,id limit ${retrievalConfiguration.perBranch}
      ), branch_ids as (select id from semantic union select id from lexical)
      select a.*,s.semantic_rank,l.lexical_rank from authorized a join branch_ids b on b.id=a.id
        left join semantic s on s.id=a.id left join lexical l on l.id=a.id`));
      const safe = matched.filter(verifiedOriginal);
      const ranks = new Map(safe.map(c => [c.id, { semanticRank: c.semantic_rank, lexicalRank: c.lexical_rank }]));
      const fused = fuseBranchCandidates(safe,ranks,retrievalConfiguration.perBranch*2);
      const seen = new Set<string>();
      const preferred = new Set(fused.filter(c => requestedTitles.some(title => normalize(c.title).includes(normalize(title)))).map(c => c.document_id));
      for (const d of preferred) preferredDocuments.add(d);
      for (const c of fused) conditions.set(c.id,c.professional ? applicability(c.professional,context) : null);
      const shortlist = fused.filter(c => {
        if (!(c.distance === null || 1 - c.distance >= minSimilarity || !!options && !primaryError && c.lexical_rank !== null)) return false;
        const key = c.document_version_id + ':' + (c.locator?.start ?? c.id);
        if (!c.locator?.managed) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const ranked = options?.rerank ? new Map(options.rerank(shortlist.map(c => candidateEvidence(c,context))).map((id, rank) => [id,rank])) : null;
      if (ranked) shortlist.sort((a,b) => (ranked.get(a.id) ?? Infinity) - (ranked.get(b.id) ?? Infinity) || 0);
      reviewedTables ||= !!external && shortlist.some(c => c.locator?.file?.extraction?.review);
      if (selected.length < limit) selected.push(...selectContextCandidates(shortlist,conditions,limit-selected.length,preferred,selection,reviewedTables ? c => {
        const extraction = c.locator?.file?.extraction;
        return extraction?.review ? `table:${c.document_version_id}:${extraction.chunkIndex}` : `row:${c.id}`;
      } : undefined));
      candidates.push(...fused);
      eligible.push(...shortlist);
    }
    const evidence = selected.map(c => candidateEvidence(c,context));
    const diagnostic: RetrievalDiagnostic = {
      configuration: retrievalConfigurationFor(selection), provider, profileId: corpora[0].profileId, epoch, query, terms,
      expansion: expanded.expansion, context, elapsedMs: Date.now()-started, embeddingUsage: result?.usage ?? null, costMicros: null,
      ...(localProfile && result ? { embeddingProfile: { model: localProfile.model, revision: localProfile.revision,
        dimensions: localProfile.dimensions } } : {}),
      ...(options ? { request: { mode, category, documentId, scope: options.scope, topK: limit, minSimilarity }, embeddingDispatched: !!result } : {}),
      ...(hosted && mode === 'hybrid' ? { managedIndex: { provider:'bailian' as const, requestId: requests.at(-1)?.requestId ?? null,
        returned: requests.reduce((sum,r) => sum + r.returned,0), authorizedDocuments: versions.filter(v => !!v.document).length, requests } } : {}),
      ...(primaryError ? { fallback: { reason: primaryError.providerCode, model: EMBEDDING_PROFILE.model, revision: EMBEDDING_PROFILE.revision } } : {}),
      ...(external ? { externalIndex: { protocol:fastGPTPreviewProtocol,datasetId:external.datasetId,collectionId:external.collectionId,
        corpusSha256:external.corpusSha256,returned:externalCandidates.length,...(reviewedTables ? {contextCoverage:'reviewed_table_first_pass_2' as const} : {}) } } : {}),
      requestedTitles, preferredDocumentIds: [...preferredDocuments],
      candidates: candidates.map((c,i) => ({ ref: {type:'knowledge_chunk',id:c.id,version:c.document_version_id},hash:c.text_hash as string,
        title:c.title,documentId:c.document_id,contentHash:c.content_hash,similarity:c.distance === null ? null : 1-c.distance,
        semanticRank:c.semantic_rank,lexicalRank:c.lexical_rank,fusionRank:i+1,
        disposition: !eligible.includes(c) ? 'below_similarity' : selected.includes(c) ? 'selected' : 'ranked_out',
        selectionRank: selected.includes(c) ? selected.indexOf(c)+1 : null,applicability:conditions.get(c.id) ?? null })),
    };
    return { evidence, diagnostic };
  }).catch(error => {
    if (primaryError && !(error instanceof AssistantError) && !options?.signal?.aborted)
      throw new KnowledgeSearchUnavailable(primaryError, requests, 'local_vector_query_failed');
    throw error;
  });
}
