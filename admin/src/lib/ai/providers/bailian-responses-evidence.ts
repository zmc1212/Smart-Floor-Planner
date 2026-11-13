import { createHash } from 'node:crypto';
import {
  boundText, injectionSignals, nativeExtractLimits, nativeToolEvidenceProtocol, nativePublicUrl,
  type NativeCodeInterpreterRecord, type NativeExtractedDocument, type NativeSearchSource,
  type NativeToolCallRecord, type NativeToolEvidence, type NativeToolName, type NativeToolStatus,
  type NativeWebExtractorRecord, type NativeWebSearchRecord,
} from '@/lib/assistant/contracts/native-tools';
import {
  parseBailianReasoningTokens, parseBailianResponsesUsage, parseBailianToolCounts,
  bailianResponsesLogPayload,
} from './bailian-responses';

const statuses: ReadonlyArray<NativeToolStatus> = ['completed', 'failed', 'incomplete', 'searching', 'in_progress'];
const asStatus = (value: unknown): NativeToolStatus =>
  typeof value === 'string' && (statuses as readonly string[]).includes(value) ? value as NativeToolStatus
    : value == null ? 'completed' : 'incomplete';

function hashText(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function strings(value: unknown, limit: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, limit) : [];
}

function searchSources(value: unknown, retrievedAt: string) {
  const accepted: NativeSearchSource[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];
  if (!Array.isArray(value)) return { accepted, rejected };
  for (const raw of value.slice(0, nativeExtractLimits.maxSources * 2)) {
    const url = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).url : null;
    const title = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).title : null;
    const parsed = nativePublicUrl(url);
    if (!parsed) { rejected.push({ url: typeof url === 'string' ? url.slice(0, 400) : '', reason: 'unsafe_or_malformed_url' }); continue; }
    if (accepted.length >= nativeExtractLimits.maxSources) continue;
    if (accepted.some(item => item.url === parsed.href)) continue;
    accepted.push({ url: parsed.href, title: typeof title === 'string' ? title.slice(0, 200) : null,
      retrievedAt, accepted: true });
  }
  return { accepted, rejected };
}

/** The provider's output sections can arrive in a different order from urls.
 * Bind a summary using its own source label. An unlabeled, ambiguous section
 * cannot provide a URL-bearing receipt. */
function splitExtracted(output: string, urls: ReadonlySet<string>, extractedAt: string, labelRequired: boolean) {
  const parts = output.split(/\n?={5,}\n?/).map(part => part.trim()).filter(Boolean);
  const singleUrl = !labelRequired && urls.size === 1 && parts.length === 1 ? [...urls][0] : null;
  const documents = new Map<string, NativeExtractedDocument>();
  let unattributedSections = 0;
  for (const part of parts.slice(0, nativeExtractLimits.maxDocuments)) {
    const label = /^The useful information in (\S+) for user goal /.exec(part);
    const url = label ? nativePublicUrl(label[1])?.href : singleUrl;
    if (!url || !urls.has(url)) {
      unattributedSections++;
      continue;
    }
    if (!documents.has(url)) documents.set(url, document(url, boundText(part, nativeExtractLimits.maxCharsPerDocument), extractedAt));
  }
  return { documents: [...documents.values()], ...(unattributedSections ? { unattributedSections } : {}) };
}

function document(url: string, text: string, extractedAt: string): NativeExtractedDocument {
  return { url, text, chars: Array.from(text).length, hash: hashText(text), extractedAt,
    injectionSignals: injectionSignals(text), trust: 'external_unverified' };
}

export type NativeToolEvidenceContext = { requestId: string | null; tools: NativeToolName[]; capturedAt: string };

/** Collects provider-side tool evidence from a Responses payload. Nothing is
 * re-executed and no source is promoted to customer/business evidence. */
export function collectNativeToolEvidence(
  payload: Record<string, unknown>,
  context: NativeToolEvidenceContext,
): NativeToolEvidence | null {
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  const calls: NativeToolCallRecord[] = [];
  const rejectedSources: Array<{ url: string; reason: string }> = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type ?? '');
    const callId = String(item.id ?? '');
    if (type === 'web_search_call') {
      const action = item.action && typeof item.action === 'object' ? item.action as Record<string, unknown> : {};
      const { accepted, rejected } = searchSources(action.sources, context.capturedAt);
      rejectedSources.push(...rejected);
      const queries = strings(action.queries, 8);
      if (!queries.length && typeof action.query === 'string') queries.push(action.query.slice(0, 240));
      const record: NativeWebSearchRecord = { tool: 'web_search', callId, status: asStatus(item.status), queries, sources: accepted };
      calls.push(record);
      continue;
    }
    if (type === 'web_extractor_call') {
      const rawUrls = strings(item.urls, nativeExtractLimits.maxDocuments);
      const urls = new Set<string>();
      for (const url of rawUrls) {
        const parsed = nativePublicUrl(url);
        if (parsed) urls.add(parsed.href);
        else rejectedSources.push({ url: url.slice(0, 400), reason: 'unsafe_or_malformed_url' });
      }
      const text = typeof item.output === 'string' ? item.output : '';
      // Even the single-source compatibility path requires the provider's
      // complete URL list to be unambiguous.
      const labelRequired = !Array.isArray(item.urls) || item.urls.length !== 1 || rawUrls.length !== 1;
      const record: NativeWebExtractorRecord = {
        tool: 'web_extractor', callId, status: asStatus(item.status),
        goal: typeof item.goal === 'string' ? item.goal.slice(0, 400) : null,
        ...splitExtracted(text, urls, context.capturedAt, labelRequired),
      };
      calls.push(record);
      continue;
    }
    if (type === 'code_interpreter_call') {
      const outputs = Array.isArray(item.outputs) ? item.outputs as Array<Record<string, unknown>> : [];
      const logs = outputs.flatMap(entry => typeof entry.logs === 'string' ? [bailianResponsesLogPayload(entry.logs)] : []).join('\n');
      const record: NativeCodeInterpreterRecord = {
        tool: 'code_interpreter', callId, status: asStatus(item.status),
        code: typeof item.code === 'string' ? boundText(item.code, nativeExtractLimits.maxCodeChars) : '',
        containerId: typeof item.container_id === 'string' ? item.container_id.slice(0, 200) : null,
        logs: boundText(logs, nativeExtractLimits.maxLogChars),
        outputKinds: outputs.map(entry => String(entry.type ?? 'unknown')).slice(0, 8),
        executedAt: context.capturedAt,
      };
      calls.push(record);
    }
  }

  if (!calls.length) return null;
  const used = new Set(calls.map(call => call.tool));
  const provenance = used.size > 1 ? 'mixed' : used.has('code_interpreter') ? 'provider_sandbox' : 'external_public_web';
  return {
    protocol: nativeToolEvidenceProtocol,
    provider: 'bailian-responses',
    responseId: typeof payload.id === 'string' ? payload.id.slice(0, 200) : null,
    requestId: context.requestId?.slice(0, 200) ?? null,
    tools: context.tools,
    calls,
    counts: parseBailianToolCounts(payload) as Partial<Record<NativeToolName, number>>,
    usage: (() => {
      const usage = parseBailianResponsesUsage(payload);
      if (!usage) return null;
      const raw = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {};
      return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        reasoningTokens: parseBailianReasoningTokens(payload),
        totalTokens: Number.isSafeInteger(raw.total_tokens) ? Number(raw.total_tokens) : null,
        toolCounts: parseBailianToolCounts(payload) };
    })(),
    provenance,
    rejectedSources,
    capturedAt: context.capturedAt,
  };
}
