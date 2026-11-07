/** Extraction provenance is bound into the existing source/version hash. */
export type ExtractionLocator = {
  provider: 'mineru'; corpusSha256: string; sourceSha256: string;
  pdfPage: number; chunkIndex: number; chunkSha256: string;
  review?: { protocol: 'mineru-table-review-v1'; layoutSha256: string; pageImageSha256: string;
    region: [number, number, number, number]; bookPage: string; contextSha256: string };
};
/** Parser output contains extracted originals, never Agent-authored answers. */
export type FileBlock = {
  id: string; kind: 'heading' | 'paragraph' | 'table_row' | 'footnote'; text: string;
  section: string[]; paragraph?: number; page?: number; table?: number; row?: number;
  sheet?: string; range?: string;
  cells?: Array<{ column: number; span: number; text: string; merge?: string; ref?: string; rowSpan?: number;
    numberFormat?: { raw: string; id: number; code: string; dateSystem?: '1900' | '1904' } }>;
  headers?: string[]; notes?: string[];
  extraction?: ExtractionLocator;
};
export type ParsedFile = { parser: string; blocks: FileBlock[]; warnings: string[]; pages?: number };
export type SourceFile = {
  version: 1; assetId: string; hash: string; name: string; format: 'docx' | 'pdf' | 'xlsx';
  parsed: ParsedFile | null; review: { adminId: string; at: string; excluded: string[] } | null;
};
export type FileLocator = {
  assetId: string; sourceHash: string; name: string; format: SourceFile['format']; parser: string;
  blockId: string; kind: FileBlock['kind']; section: string[]; paragraph?: number; page?: number;
  table?: number; row?: number; columns?: number[]; sheet?: string; range?: string; label: string;
  extraction?: ExtractionLocator;
};
