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
import { configuredPublicRead, publicDocumentPages, publicDocumentReadFailures, publicReaderEndpoint, type PublicReadDocument } from './public-research';
import { matchingReviewedStandard, type PublicStandard } from '../web-search/standards';

export type AgentWebSearchOptions = Pick<WebToolDeps, 'provider' | 'readPage'>;
const protocol = 'application-web-tools-v1';
// The ordinary Agent tool slots occupy 1200–1233. These three reads are
// server-selected originals and keep the existing web Evidence ID format.
const reviewedStandardStep = { notice: 1297, attachment: 1298, catalog: 1299 };

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

type DiscoveryPacket = {
  tool: string; webStatus: string; result?: { results?: Array<Record<string, unknown>>; [key: string]: unknown };
  synthesisSources?: Array<{ web?: { standard?: PublicStandard; document?: { reviewedTextHash?: string } } }>;
  [key: string]: unknown;
};

export function hasReviewedStandardRead(messages: ModelMessage[]) {
  return messages.some(message => {
    const packet = webPacket(message);
    return Array.isArray(packet?.synthesisSources) && packet.synthesisSources.some(source =>
      source?.web?.standard?.kind === 'standard_text' && !!source.web.document?.reviewedTextHash);
  });
}

export function hasStandardEditionEvidence(messages: ModelMessage[], edition: string) {
  const facts = messages.flatMap(message => {
    const sources = webPacket(message)?.synthesisSources;
    return Array.isArray(sources) ? sources.flatMap(source => source?.web?.standard ?? []) : [];
  }).filter(standard => standard.id === edition);
  return facts.some(standard => standard.kind === 'standard_text')
    && facts.some(standard => standard.kind === 'publication_notice' && !!standard.effectiveAt)
    && facts.some(standard => standard.kind === 'status_catalog' && standard.status !== 'unknown');
}

function webPacket(message: ModelMessage): DiscoveryPacket | null {
  if (message.role !== 'tool') return null;
  try {
    const packet = JSON.parse(message.content);
    return typeof packet?.tool === 'string' && isWebTool(packet.tool) ? packet : null;
  } catch { return null; }
}

/** A fresh discovery needs its own read attempt. An earlier read does not
 * establish the contents of a later search result. */
export function webOriginalPending(messages: ModelMessage[]) {
  const packets = messages.map(webPacket).filter(packet => packet !== null);
  const discovery = packets.findLastIndex(packet => packet.webStatus === 'ready' && packet.result?.results?.length);
  return discovery >= 0 && discovery > packets.findLastIndex(packet => packet.tool === 'web_fetch');
}

export function projectWebDiscovery(messages: ModelMessage[], finalOnly: boolean): ModelMessage[] {
  return messages.map(message => {
    const packet = webPacket(message);
    if (message.role !== 'tool' || !Array.isArray(packet?.result?.results)) return message;
    const { results, ...metadata } = packet.result;
    if (finalOnly) return { ...message, content: JSON.stringify({
      tool: packet.tool, webStatus: packet.webStatus, failures: packet.failures, discoveryOnly: true, synthesisSources: [],
    }) };
    const candidates = results.map(({ rank, title, url, domain, sourceKind, verified }) =>
      ({ rank, title, url, domain, sourceKind, verified }));
    return { ...message, content: JSON.stringify({ ...packet,
      result: { ...metadata, contentKind: 'discovery', results: candidates } }) };
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
  const originals = new Map<string, PublicReadDocument>();
  const registry = createWebToolRegistry({
    provider: options.provider, readPage: options.readPage, allowFetch: url => allowedUrls.has(url),
    ...(publicReaderEndpoint() ? {
      async readAttachment(url, signal) {
        const remaining = Math.min(27000, options.deadlineAt - Date.now());
        if (remaining < 1) fail('web_timeout', 503);
        const attachment = await configuredPublicRead(url, remaining, signal);
        signal.throwIfAborted();
        if (attachment.mediaType !== 'application/pdf') fail('unsupported_web_content', 422);
        originals.set(url, attachment);
      },
    } : {}),
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
    async reviewedStandard(previousQuestions: string[]): Promise<ModelMessage[]> {
      if (!publicReaderEndpoint()) return [];
      const standard = matchingReviewedStandard(options.question, previousQuestions);
      if (!standard) return [];
      // The registered URLs are from the publisher. The PDF itself is obtained
      // from the live notice and must still match the reviewed publisher bytes.
      allowedUrls.add(standard.noticeUrl);
      allowedUrls.add(standard.catalogUrl);
      const fetch = async (url: string, sequence: number) => {
        const id = 'server:reviewed-standard:' + sequence, args = JSON.stringify({ url });
        const result = await this.execute({ id, name: 'web_fetch', arguments: args }, 0, sequence);
        return { id, args, content: result.content };
      };
      const notice = await fetch(standard.noticeUrl, reviewedStandardStep.notice);
      const packet = JSON.parse(notice.content) as { result?: { document?: FetchedWebDocument } };
      const attachment = packet.result?.document?.attachments?.find(link => link.title.replace(/\.pdf$/i, '') === standard.standard.name);
      const reads = [notice];
      if (attachment) {
        allowedUrls.add(attachment.url);
        reads.push(await fetch(attachment.url, reviewedStandardStep.attachment));
      }
      reads.push(await fetch(standard.catalogUrl, reviewedStandardStep.catalog));
      return reads.flatMap(read => {
        const { tool, webStatus, failures, synthesisSources } = JSON.parse(read.content);
        const codes = failures.map(({ code }: { code: string }) => code);
        if (read === notice && !attachment) codes.push('web_attachment_not_found');
        return [{ role: 'assistant' as const, content: '', toolCalls: [{ id: read.id, name: 'web_fetch', arguments: read.args }] },
          { role: 'tool' as const, callId: read.id, content: JSON.stringify({ tool, webStatus, failures: codes, synthesisSources }) }];
      });
    },
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
        result?: { kind: string; query?: string; queries?: string[]; retrievedAt?: string; requestedUrl?: string;
          document?: FetchedWebDocument; results?: Array<{ url: string }>; perQuery?: unknown[];
          failures?: Array<{ code: string }> };
      };
      const payload = packet.result;
      const document = payload?.document;
      const attachment = payload?.requestedUrl ? originals.get(payload.requestedUrl) : undefined;
      if (payload?.requestedUrl) originals.delete(payload.requestedUrl);
      const repeatedAttachment = result.status === 'duplicate' && !!payload?.requestedUrl
        && earlier.prior.some(item => item.pages.some(page => page.requestedUrl === payload.requestedUrl));
      const retrievedAt = document?.retrievedAt ?? payload?.retrievedAt ?? result.record.startedAt;
      const duplicates = document && earlier.prior.find(item => item.r3.contentHash === document.contentHash && item.pages.length);
      const pages: WebPage[] = [];
      if (document && !duplicates && result.status === 'succeeded') {
        const { url, requestedUrl, title, text, textBytes, publishedAt, trust, standard } = document;
        pages.push({ url, requestedUrl, title, text, textBytes, retrievedAt, publishedAt, sourceKind: trust.kind, ...(standard ? { standard } : {}),
          parser: 'public-html-text-v1', hash: fingerprint({ url, title, text, retrievedAt }) });
      }
      if (attachment) pages.push(...publicDocumentPages(attachment, retrievedAt, options.question));
      const urls = [...(payload?.results?.map(hit => hit.url) ?? []), ...(document?.attachments?.map(link => link.url) ?? [])];
      const failures: WebSearchSnapshot['failures'] = payload?.failures?.map(({ code }) => ({ code })) ?? [];
      if (attachment) failures.push(...publicDocumentReadFailures(attachment, pages));
      else if (payload?.kind === 'web_attachment' && !repeatedAttachment) {
        const previous = earlier.prior.find(item => item.r3.packet.result && (item.r3.packet.result as { requestedUrl?: string }).requestedUrl === payload.requestedUrl);
        failures.push(...(previous?.failures.length ? previous.failures : [{ code: 'web_reader_unavailable' }]));
      }
      if (!result.ok || packet.truncated || payload?.kind === 'quarantined_page') {
        const error = packet.error;
        failures.push({ code: error?.code === 'tool_execution_failed' && /^(?:web_|pdf_|invalid_pdf|encrypted_pdf|unsupported_web_|reader_version_)[a-z0-9_]*$/.test(error.message)
          ? error.message : error?.code ?? (packet.truncated ? 'web_result_limit' : 'web_page_untrusted_instruction') });
      }
      const metadata = document ? {
        ...payload, document: { url: document.url, requestedUrl: document.requestedUrl, title: document.title,
          publishedAt: document.publishedAt, retrievedAt, trust: document.trust,
          ...(document.attachments ? { attachments: document.attachments } : {}),
          ...(document.standard ? { standard: document.standard } : {}) },
        ...(duplicates ? { duplicate: true, duplicateOf: duplicates.pages[0].url } : {}),
      } : payload;
      const snapshot: Receipt = {
        version: 1, provider: options.provider?.name ?? 'unconfigured',
        query: { query: payload?.query ?? payload?.queries?.[0] ?? '公开网页', domains: [] },
        status: pages.length || duplicates || repeatedAttachment || urls.length ? 'ready' : failures.length ? 'unavailable' : 'empty',
        pages, failures, retrievedAt, ...(attachment ? { documents: [attachment] } : {}),
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
      for (const url of urls) allowedUrls.add(url);
      return reply(snapshot, sequence);
    },
  };
}
