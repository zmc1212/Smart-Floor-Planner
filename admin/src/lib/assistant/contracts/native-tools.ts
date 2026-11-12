/**
 * Provider-side native tool evidence (Bailian Responses API).
 *
 * These tools run inside the model provider's own sandbox. Evidence collected
 * here is external public web data or provider sandbox output; it is never
 * customer site evidence, never an enterprise standard, and never proof of a
 * business authorization. Business tools keep using the existing dispatcher.
 */
import { isIP } from 'node:net';

export const nativeToolEvidenceProtocol = 'bailian-native-tools-v1';

export type NativeToolName = 'web_search' | 'web_extractor' | 'code_interpreter';
export const nativeToolNames = ['web_search', 'web_extractor', 'code_interpreter'] as const;

export type NativeToolStatus = 'completed' | 'failed' | 'incomplete' | 'searching' | 'in_progress';

export type NativeSearchSource = { url: string; title: string | null; retrievedAt: string; accepted: boolean };

export type NativeWebSearchRecord = {
  tool: 'web_search'; callId: string; status: NativeToolStatus;
  queries: string[]; sources: NativeSearchSource[];
};

export type NativeExtractedDocument = {
  url: string; text: string; chars: number; hash: string; extractedAt: string;
  /** Marker-only report of suspected prompt injection; content is never promoted. */
  injectionSignals: string[];
  trust: 'external_unverified';
};

export type NativeWebExtractorRecord = {
  tool: 'web_extractor'; callId: string; status: NativeToolStatus; goal: string | null;
  documents: NativeExtractedDocument[];
};

export type NativeCodeInterpreterRecord = {
  tool: 'code_interpreter'; callId: string; status: NativeToolStatus;
  code: string; containerId: string | null; logs: string; outputKinds: string[]; executedAt: string;
};

export type NativeToolCallRecord = NativeWebSearchRecord | NativeWebExtractorRecord | NativeCodeInterpreterRecord;

export type NativeToolUsage = {
  inputTokens: number; outputTokens: number;
  reasoningTokens: number | null; totalTokens: number | null;
  /** Provider-reported tool invocation counts; missing tool means unreported. */
  toolCounts: Partial<Record<string, number>>;
};

export type NativeToolEvidence = {
  protocol: typeof nativeToolEvidenceProtocol;
  provider: 'bailian-responses';
  responseId: string | null;
  requestId: string | null;
  tools: NativeToolName[];
  calls: NativeToolCallRecord[];
  counts: Partial<Record<NativeToolName, number>>;
  usage: NativeToolUsage | null;
  provenance: 'external_public_web' | 'provider_sandbox' | 'mixed' | 'none';
  rejectedSources: Array<{ url: string; reason: string }>;
  capturedAt: string;
};

/** Public http(s) URL shape only. No DNS/connectivity claim is made here. */
export function nativePublicUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    if (isIP(host) && !publicNativeAddress(host)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

/** Loopback/private/link-local/embedded addresses are never usable evidence. */
function publicNativeAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  if (isIP(address) === 6) {
    return /^[23]/.test(address) && !/^200[12]:|^2001:db8:|^3fff:|^2001:0:|^2001:20:/.test(address);
  }
  return false;
}

/** Prompt-injection markers only; every match is reported, nothing is executed. */
const injectionPatterns: ReadonlyArray<[string, RegExp]> = [
  ['ignore_previous_instructions', /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?/i],
  ['reveal_system_prompt', /(?:reveal|print|repeat|show)\s+(?:your\s+)?system\s*prompt/i],
  ['role_reassignment', /you\s+are\s+now\s+(?:a|an|the)\s+/i],
  ['fake_system_tag', /<\/?\s*(?:system|assistant|tools?)\s*>/i],
  ['chinese_ignore_instructions', /忽略(?:你)?(?:之前|此前|以上|前面)(?:的)?(?:所有)?(?:指令|要求|提示)/],
  ['chinese_reveal_prompt', /(?:输出|告诉我|泄露|显示)(?:你的)?(?:系统)?(?:提示词|系统指令|prompt)/i],
  ['chinese_role_hijack', /从现在(?:开始|起)[，,]?\s*你(?:是|就是)/],
];
export function injectionSignals(text: string): string[] {
  if (!text) return [];
  return injectionPatterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

export const nativeExtractLimits = { maxDocuments: 8, maxCharsPerDocument: 6000, maxSources: 20, maxCodeChars: 4000, maxLogChars: 4000 } as const;

/** Truncate by code points so a sandbox/page payload can never blow a checkpoint. */
export function boundText(value: string, limit: number) {
  const chars = Array.from(value);
  return chars.length <= limit ? value : chars.slice(0, limit).join('');
}
