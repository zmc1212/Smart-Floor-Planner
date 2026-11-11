import { getDatasetSearchToolResponsePrompt } from './vendor/dataset.const';
import type { RagCitationSource } from './native-rag';

/** The fields read by FastGPT chatNode's stock dataset quote renderer. */
export type NativeChatQuote = { id: string; q: string; a: string; sourceName: string; updateTime?: string };

export function nativePublicChatQuote(source: RagCitationSource): NativeChatQuote {
  const web = source.evidence.web!;
  return { id: source.nativeId, q: source.quote || source.evidence.text, a: '',
    sourceName: `公开网页｜${web.title} ${web.url}`, updateTime: web.retrievedAt };
}

/** FastGPT v4.17.4 dataset/toolResponse.ts wire shape, with every rule of the
 * stock dataset.const.ts prompt. The prompt illustrates the marker with three
 * literal 24-hex example ids that are not in `cites`; models copy one into the
 * final answer (observed three times on the 1454 four-question turn), which
 * then fails closed at citation validation. A bare `[id](CITE)` placeholder is
 * copied literally as well, so the examples are rewritten with the first
 * actually issued cite id: the wording stays illustrative and any copied
 * example still resolves. Source identities/quotes still come exclusively
 * from the existing authorized Evidence/catalog; no answer normalization.
 * https://github.com/labring/FastGPT/blob/v4.17.4/packages/service/core/workflow/dispatch/dataset/toolResponse.ts
 */
const datasetCitationPrompt = (exampleId: string) => getDatasetSearchToolResponsePrompt()
  .replace(/\[[0-9a-f]{24}\]\(CITE\)/g, () => `[${exampleId}](CITE)`);

export function nativeCites(sources: Array<{ id: string; sourceName: string; updateTime?: string; content: string }>) {
  return sources.length ? { prompt: datasetCitationPrompt(sources[0].id), cites: sources } : {};
}
export function nativeHistoryCites(sources: RagCitationSource[]) {
  return nativeCites(sources.map(s => ({ id: s.nativeId, sourceName: s.evidence.web?.title || '仍获权的企业工艺原文',
    updateTime: s.evidence.web?.retrievedAt, content: s.quote || s.evidence.text })));
}
