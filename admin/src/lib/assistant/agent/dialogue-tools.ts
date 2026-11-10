import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import { fail } from '../contracts';
import { knowledgeSynthesisSources, businessSynthesisSources, type SynthesisContext } from './synthesis';
import { synthesisContextAvailable } from './synthesis-sources';
import { queryBusiness, type BusinessQuery, type BusinessSnapshot } from './business-tools';
import { retrieveKnowledge } from '../knowledge/retrieval';
import { embeddingGateway } from '../infrastructure/embedding-gateway';
import { runContext, type Lease } from '../infrastructure/job-queue';
import { nativeCites } from '../fastgpt/native-cites';
import type { RagCitationSource, RagChatMessage } from '../fastgpt/native-rag';

/** Shared V2-surface dialogue tools. Both the FastGPT Agent V2 bridge and the
 * XiaoK native executor dispatch the same authorized implementations, so
 * migrating the orchestrator can never change what a tool may read or write. */
export type DialogueToolReceipt = Record<string, unknown>;
export type DialogueToolRuntime = {
  lease: Lease;
  /** Executor protocol recorded on every step and receipt. */
  protocol: string;
  /** Revalidates lease, actor and policy on every call. */
  authorize: () => Promise<Awaited<ReturnType<typeof runContext>>>;
  context: SynthesisContext;
  catalog: Map<string, RagCitationSource>;
  messages: RagChatMessage[];
  markKnowledgeRetrieved: () => void;
  delivered: BusinessSnapshot[];
  /** Resume input: receipts persisted by a lost process of this same run,
   * keyed by the tools' stable identities (query text / domain:leadId). A
   * re-issued identical call returns the persisted receipt instead of
   * dispatching the provider again. */
  recovered?: { searches?: Map<string, DialogueToolReceipt>; businesses?: Map<string, DialogueToolReceipt> };
};

export const citationId = (chunkId: string) => 'K' + chunkId;
export const quoteOf = (text: string) => Array.from(text).length > 600 ? Array.from(text).slice(0, 600).join('') : text;
export const snapshotHeading = '项目记录（授权快照，以此为准）';

/** `search_enterprise`: metered authorized enterprise-knowledge retrieval.
 * Duplicates of one in-flight query share the same promise; recovered queries
 * keep their persisted receipt instead of dispatching again. */
export function dialogueEnterpriseSearch(rt: DialogueToolRuntime) {
  const { lease } = rt;
  const searches = new Map<string, Promise<DialogueToolReceipt>>(rt.recovered?.searches
    ? [...rt.recovered.searches].map(([query, receipt]) => [query, Promise.resolve(receipt)] as const)
    : []);
  return (query: string, sequence: number): Promise<DialogueToolReceipt> => {
    const pending = searches.get(query);
    if (pending) return pending;
    const created = (async (): Promise<DialogueToolReceipt> => {
      const state = await rt.authorize();
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
      if (evidence.length) rt.markKnowledgeRetrieved();
      const sources: RagCitationSource[] = evidence.map(e => ({ nativeId: citationId(e.ref.id), sourceId: citationId(e.ref.id),
        quote: quoteOf(e.text), evidence: e }));
      for (const s of sources) rt.catalog.set(s.nativeId, s);
      rt.context.knowledge.push(...evidence); rt.context.sources.push(...knowledgeSynthesisSources(evidence));
      // The receipt is persisted with the step so an interrupted run can reuse
      // it verbatim instead of re-issuing the same metered query.
      const receipt: DialogueToolReceipt = { status: evidence.length ? 'ready' : 'empty', kind: 'enterprise',
        ...(evidence.length ? nativeCites(sources.map(s => ({ id: s.nativeId, sourceName: '企业工艺｜PPT原文', content: s.quote! }))) : {}) };
      await withTenantTransaction(lease.enterpriseId, async tx => {
        const current = await runContext(tx, lease);
        if (!await synthesisContextAvailable(tx, lease.actor, current.conversation, rt.context)) fail('context_changed');
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,source_refs,private_checkpoint,input_summary)
          values(${lease.enterpriseId},${lease.runId},${1300 + sequence},'retrieval','knowledge.search.v1',1,'succeeded',
            ${JSON.stringify(evidence.map(e => ({ ref: e.ref, hash: e.hash })))}::jsonb,${JSON.stringify(evidence)}::jsonb,
            ${JSON.stringify({ protocol: rt.protocol, tool: 'search_enterprise', query,
              candidates: retrieved.diagnostic.candidates.length, selected: evidence.length, receipt })}::jsonb)`);
      });
      return receipt;
    })();
    searches.set(query, created);
    return created;
  };
}

/** `query_business`: one authorized business snapshot per domain/lead pair.
 * Parallel calls for the same key share the snapshot; recovered keys keep
 * their persisted receipt instead of re-reading a fresh snapshot. Each
 * delivered snapshot also feeds the synthesis guard and the composed server
 * section. */
export function dialogueBusinessQuery(rt: DialogueToolRuntime) {
  const { lease } = rt;
  const businesses = new Map<string, Promise<DialogueToolReceipt>>(rt.recovered?.businesses
    ? [...rt.recovered.businesses].map(([key, receipt]) => [key, Promise.resolve(receipt)] as const)
    : []);
  return (query: BusinessQuery, sequence: number): Promise<DialogueToolReceipt> => {
    const key = query.domain + ':' + query.leadId;
    let pending = businesses.get(key);
    if (!pending) {
      pending = (async () => {
        await rt.authorize();
        const { snapshot, receipt } = await withTenantTransaction(lease.enterpriseId, async tx => {
          const current = await runContext(tx, lease);
          if (!await synthesisContextAvailable(tx, lease.actor, current.conversation, rt.context)) fail('context_changed');
          const entry = current.conversation.entry_snapshot as Row;
          const boundLead = entry.kind === 'lead' ? String(entry.id) : '';
          if (boundLead && query.leadId && query.leadId !== boundLead) fail('assistant_resource_not_found', 404);
          const scoped: BusinessQuery = { ...query, leadId: boundLead || query.leadId };
          const snapshot = await queryBusiness(tx, lease.actor, scoped, String(current.conversation.id));
          const selected = Array.isArray(snapshot.data) ? snapshot.data.length : 0;
          if (scoped.domain === 'construction') for (const project of snapshot.data as Row[])
            await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id)
              values(${lease.enterpriseId},${String(project.projectId)},${String(current.conversation.id)}) on conflict do nothing`);
          // The receipt is persisted with the step (keyed by the caller's own
          // domain/lead pair) so an interrupted run reuses it verbatim.
          const receipt: DialogueToolReceipt = { status: selected ? 'ready' : 'empty', resultKey: snapshot.version, text: snapshot.displayText };
          await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,private_checkpoint,input_summary)
            values(${lease.enterpriseId},${lease.runId},${1400 + sequence},'agent_tool','query_business',1,'succeeded',
              ${JSON.stringify(snapshot)}::jsonb,
              ${JSON.stringify({ protocol: rt.protocol, tool: 'query_business', key, domain: scoped.domain,
                leadId: scoped.leadId, selected, receipt })}::jsonb)`);
          return { snapshot, receipt };
        });
        rt.delivered.push(snapshot);
        // The synthesis guard revalidates every snapshot version before delivery.
        rt.context.snapshots.push(snapshot);
        rt.context.sources.push(...businessSynthesisSources('F1:' + lease.runId + ':' + sequence, snapshot));
        return receipt;
      })();
      businesses.set(key, pending);
    }
    return pending;
  };
}
