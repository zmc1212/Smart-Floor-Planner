import { getDatasetSearchToolResponsePrompt } from './vendor/dataset.const';
import type { RagCitationSource } from './native-rag';

/** The fields read by FastGPT chatNode's stock dataset quote renderer. */
export type NativeChatQuote = { id: string; q: string; a: string; sourceName: string; updateTime?: string };

export function nativePublicChatQuote(source: RagCitationSource): NativeChatQuote {
  const web = source.evidence.web!;
  return { id: source.nativeId, q: source.quote || source.evidence.text, a: '',
    sourceName: `公开网页｜${web.title} ${web.url}`, updateTime: web.retrievedAt };
}

/** FastGPT v4.17.4 dataset/toolResponse.ts wire shape, with its unchanged
 * dataset.const.ts prompt. Source identities/quotes still come exclusively
 * from the existing authorized Evidence/catalog; no answer normalization.
 * https://github.com/labring/FastGPT/blob/v4.17.4/packages/service/core/workflow/dispatch/dataset/toolResponse.ts
 */
export function nativeCites(sources: Array<{ id: string; sourceName: string; updateTime?: string; content: string }>) {
  return sources.length ? { prompt: getDatasetSearchToolResponsePrompt(), cites: sources } : {};
}
export function nativeHistoryCites(sources: RagCitationSource[]) {
  return nativeCites(sources.map(s => ({ id: s.nativeId, sourceName: s.evidence.web?.title || '仍获权的企业工艺原文',
    updateTime: s.evidence.web?.retrievedAt, content: s.quote || s.evidence.text })));
}
