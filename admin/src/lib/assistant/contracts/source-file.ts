/** Parser output is local extraction, never LLM-authored source material. */
export type FileBlock = {
  id: string; kind: 'heading' | 'paragraph' | 'table_row' | 'footnote'; text: string;
  section: string[]; paragraph?: number; page?: number; table?: number; row?: number;
  cells?: Array<{ column: number; span: number; text: string; merge?: string }>;
  headers?: string[]; notes?: string[];
};
export type ParsedFile = { parser: string; blocks: FileBlock[]; warnings: string[]; pages?: number };
export type SourceFile = {
  version: 1; assetId: string; hash: string; name: string; format: 'docx' | 'pdf';
  parsed: ParsedFile | null; review: { adminId: string; at: string; excluded: string[] } | null;
};
export type FileLocator = {
  assetId: string; sourceHash: string; name: string; format: 'docx' | 'pdf'; parser: string;
  blockId: string; kind: FileBlock['kind']; section: string[]; paragraph?: number; page?: number;
  table?: number; row?: number; columns?: number[]; label: string;
};
