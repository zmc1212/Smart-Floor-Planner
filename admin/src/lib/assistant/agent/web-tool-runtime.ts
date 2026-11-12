import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint } from '../contracts';
import type { ModelMessage, ModelTool, ModelToolCall } from '../contracts/model';
import { isWebTool } from '../web-search/contract';
import type { Lease } from '../infrastructure/job-queue';
import { ToolExecutor } from '../tools/executor';
import { createWebToolRegistry, type WebToolDeps } from '../web-search/tools';
import type { FetchedWebDocument } from '../web-search/page';
import { publicWebUrl, type WebPage, type WebSearchSnapshot } from './web';
import { webEvidence, webSynthesisSources } from './web-evidence';

export type AgentWebSearchOptions = Pick<WebToolDeps, 'provider' | 'readPage'>;
const protocol = 'application-web-tools-v1';

type Receipt = WebSearchSnapshot & {
  r3: { packet: Record<string, unknown>; urls: string[]; contentHash?: string };
};

export function configuredApplicationWebSearch(env = process.env) {
  return env.ASSISTANT_WEB_SEARCH_TOOLS === '1';
}

function userUrls(question: string) {
  return new Set((question.match(/https?:\/\/[^\s<>"'）)】\]，。；、]+/gi) || []).flatMap(value => {
    try { return [publicWebUrl(value).href]; } catch { return []; }
  }));
}

function webPacket(message: ModelMessage): { tool: string; webStatus: string; result?: { results?: unknown[] } } | null {
  if (message.role !== 'tool') return null;
  try {
    const packet = JSON.parse(message.content);
    return typeof packet?.tool === 'string' && isWebTool(packet.tool) ? packet : null;
  } catch { return null; }
}

/** A successful discovery with no read yet needs an original before synthesis. */
export function webOriginalPending(messages: ModelMessage[]) {
  const packets = messages.map(webPacket).filter(packet => packet !== null);
  return packets.some(packet => packet.webStatus === 'ready' && packet.result?.results?.length)
    && !packets.some(packet => packet.tool === 'web_fetch');
}

export function omitSearchSnippets(messages: ModelMessage[]): ModelMessage[] {
  return messages.map(message => {
    const packet = webPacket(message);
    if (message.role !== 'tool' || !packet?.result?.results) return message;
    return { ...message, content: JSON.stringify({ tool: packet.tool, webStatus: packet.webStatus,
      discoveryOnly: true, synthesisSources: [] }) };
  });
}

/** Reuse the existing step and source contracts so stored originals can be
 * opened from the existing citation endpoint and restored in a later turn. */
export function createAgentWebTools(options: AgentWebSearchOptions & {
  lease: Lease;
  scoped<T>(run: (tx: PostgresTransaction) => Promise<T>): Promise<T>;
  question: string;
  conversationId: string;
  deadlineAt: number;
}) {
  const { lease, scoped } = options;
  const allowedUrls = userUrls(options.question);
  const registry = createWebToolRegistry({
    provider: options.provider, readPage: options.readPage, allowFetch: url => allowedUrls.has(url),
  });
  const offered = registry.toModelTools().filter(tool => tool.name !== 'web_search_news' || options.provider?.supportsNews);
  // Original bytes and escaped JSON are bounded separately. The model packet
  // uses the existing evidence projection instead of a second copy of the text.
  const executor = new ToolExecutor(registry, { maxResultBytes: 32_000 });

  const reply = (snapshot: Receipt, sequence: number) => ({
    cacheable: snapshot.status !== 'unavailable',
    content: JSON.stringify({ ...snapshot.r3.packet, webStatus: snapshot.status, failures: snapshot.failures,
      synthesisSources: webSynthesisSources(webEvidence(snapshot, lease.runId, sequence)) }),
  });

  return {
    provider: options.provider?.name ?? 'unconfigured',
    replace(tools: ModelTool[]) {
      return tools.flatMap(tool => tool.name === 'search_web' ? offered : tool.name === 'read_web' ? [] : [tool]);
    },
    async execute(call: ModelToolCall, turn: number, sequence: number) {
      if (!offered.some(tool => tool.name === call.name)) fail('assistant_capability_forbidden', 403);
      const reading = call.name === 'web_fetch';
      const capability = reading ? 'web.read.v1' : 'web.search.v1';
      const binding = fingerprint({ protocol, provider: options.provider?.name, call });
      const earlier = await scoped(async tx => {
        const cached = await one(tx, sql`select status,private_checkpoint,input_summary from app.assistant_run_steps
          where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${sequence}`);
        if (cached) {
          if ((cached.input_summary as Row)?.binding !== binding) fail('context_changed');
          if (cached.status !== 'succeeded' && cached.status !== 'failed') fail('provider_outcome_unknown');
          const receipt = cached.private_checkpoint as Receipt | null;
          if (!receipt?.r3 || receipt.version !== 1) fail('context_changed');
          return { cached: receipt, prior: [] as Receipt[] };
        }
        const prior = reading ? (await rows(tx, sql`select private_checkpoint from app.assistant_run_steps
          where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq<${sequence}
            and capability_name in ('web.search.v1','web.read.v1') and status='succeeded'`))
          .map(step => step.private_checkpoint as Receipt).filter(step => step?.r3) : [];
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,input_summary)
          values(${lease.enterpriseId},${lease.runId},${sequence},'retrieval',${capability},1,'running',
            ${JSON.stringify({ protocol, binding, tool: call.name, callId: call.id })}::jsonb)`);
        return { cached: null, prior };
      });
      if (earlier.cached) return reply(earlier.cached, sequence);
      for (const snapshot of earlier.prior) for (const url of snapshot.r3.urls) allowedUrls.add(url);
      const result = await executor.execute(call, {
        actor: lease.actor, projectId: null, conversationId: options.conversationId, runId: lease.runId,
        turn, deadlineAt: options.deadlineAt,
      });
      const packet = JSON.parse(result.content) as {
        ok: boolean; truncated?: boolean; error?: { code: string; message: string };
        result?: { kind: string; query?: string; queries?: string[]; retrievedAt?: string;
          document?: FetchedWebDocument; results?: Array<{ url: string }>; perQuery?: unknown[];
          failures?: Array<{ code: string }> };
      };
      const payload = packet.result;
      const document = payload?.document;
      const retrievedAt = document?.retrievedAt ?? payload?.retrievedAt ?? result.record.startedAt;
      const duplicates = document && earlier.prior.find(item => item.r3.contentHash === document.contentHash && item.pages.length);
      const pages: WebPage[] = [];
      if (document && !duplicates && result.status === 'succeeded') {
        const { url, requestedUrl, title, text, textBytes, publishedAt, trust } = document;
        pages.push({ url, requestedUrl, title, text, textBytes, retrievedAt, publishedAt, sourceKind: trust.kind,
          parser: 'public-html-text-v1', hash: fingerprint({ url, title, text, retrievedAt }) });
      }
      const urls = payload?.results?.map(hit => hit.url) ?? [];
      const failures = payload?.failures?.map(({ code }) => ({ code })) ?? [];
      if (!result.ok || packet.truncated || payload?.kind === 'quarantined_page') {
        failures.push({ code: packet.error?.code ?? (packet.truncated ? 'web_result_limit' : 'web_page_untrusted_instruction') });
      }
      const metadata = document ? {
        ...payload, document: { url: document.url, requestedUrl: document.requestedUrl, title: document.title,
          publishedAt: document.publishedAt, retrievedAt, trust: document.trust },
        ...(duplicates ? { duplicate: true, duplicateOf: duplicates.pages[0].url } : {}),
      } : payload;
      const snapshot: Receipt = {
        version: 1, provider: options.provider?.name ?? 'unconfigured',
        query: { query: payload?.query ?? payload?.queries?.[0] ?? '公开网页', domains: [] },
        status: pages.length || duplicates || urls.length ? 'ready' : failures.length ? 'unavailable' : 'empty',
        pages, failures, retrievedAt,
        r3: { urls, ...(document ? { contentHash: document.contentHash } : {}),
          packet: { ok: packet.ok && !packet.truncated, tool: call.name, ...(metadata ? { result: metadata } : {}),
            ...(packet.error ? { error: packet.error } : {}) } },
      };
      const audit = { ...result.record, content: undefined };
      const observed = result.status === 'succeeded' && payload ? payload.perQuery?.length ?? 1 : 0;
      await scoped(async tx => {
        await tx.execute(sql`update app.assistant_run_steps
          set status=${result.ok && !packet.truncated ? 'succeeded' : 'failed'},private_checkpoint=${JSON.stringify(snapshot)}::jsonb,
            source_refs=${JSON.stringify(webEvidence(snapshot, lease.runId, sequence).map(({ ref, hash }) => ({ ref, hash })))}::jsonb,
            input_summary=input_summary || ${JSON.stringify({ audit })}::jsonb
          where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${sequence}`);
        if (observed) await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind)
          values(${lease.enterpriseId},${lease.runId},${'agent-web:' + lease.runId + ':' + sequence},${reading ? 'web_read' : 'web_search'},${observed},'observed')
          on conflict do nothing`);
      });
      return reply(snapshot, sequence);
    },
  };
}
