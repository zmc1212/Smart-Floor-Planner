import type { SynthesisSource } from './synthesis';
import { publicDocumentByteLimit, publicReaderParser } from './public-research';
import { publicWebUrl } from './web';

/** Typed metadata from reauthorized server Evidence, never prose/file titles.
 * This identifies an original for diagnostics; it grants no source access and
 * never accepts a numerical claim or an altered quotation. */
export function publicPdfSource(source: SynthesisSource) {
  const web = source.kind === 'web' ? source.web : undefined, document = web?.document;
  if (!web || web.parser !== publicReaderParser || !document || document.mediaType !== 'application/pdf'
    || !/^[a-f0-9]{64}$/.test(web.hash) || !/^[a-f0-9]{64}$/.test(document.hash)
    || !Number.isSafeInteger(document.page) || !Number.isSafeInteger(document.pages)
    || document.page < 1 || document.page > document.pages || document.pages > 50
    || !Number.isSafeInteger(document.bytes) || document.bytes < 1
    || document.bytes > publicDocumentByteLimit(document.mediaType, document.transport)) return false;
  try { publicWebUrl(web.url); return true; } catch { return false; }
}

export function citedPdfPage(source: SynthesisSource) {
  const page = source.kind === 'knowledge' && source.evidence?.file?.format === 'pdf' ? source.evidence.file.page
    : publicPdfSource(source) ? source.web!.document!.page : undefined;
  return typeof page === 'number' && Number.isSafeInteger(page) && page > 0 ? page : null;
}
