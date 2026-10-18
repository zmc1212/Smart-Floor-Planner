export type Audience = 'customer_public' | 'staff_internal';
export type KnowledgeDocument = {
  id: string; title: string; category: string; source_type: 'manual_text' | 'faq' | 'reference_case'; audience: Audience;
  status: 'draft' | 'active' | 'retired'; published_version_id: string | null; version: number; updated_at: string;
};
export type KnowledgeVersion = {
  id: string; version_number: number; edit_version: number; body: string; faq: Array<{ question: string; answer: string }>;
  index_status: 'pending' | 'indexing' | 'ready' | 'failed'; published_at: string | null;
  effective_from: string; effective_to: string | null; chunk_count: number;
  reference_case?: { source: string; authorization: string; tags: string[]; imageBase64: string; mimeType: 'image/jpeg' } | null;
};
export type KnowledgeDetail = { document: KnowledgeDocument; versions: KnowledgeVersion[] };
export type AssistantRun = {
  id: string; conversationId: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'indeterminate';
  retryable: boolean; errorCode: string | null; nextPollMs: number | null; answerKind?: string | null;
};
export type PreviewConversation = {
  id: string; title: string | null; status: string; version: number; createdAt: string; latestRun?: AssistantRun | null;
  previewScope?: { audience: Audience | 'all'; draftVersionIds: string[] };
};
export type Citation = {
  id: string; available: boolean; title?: string; versionNumber?: number; quote?: string; isDraft?: boolean; historical?: boolean;
};
export type PreviewMessage = {
  id: string; seq: string; authorKind: string; available: boolean; answerKind: string | null; createdAt: string;
  content: { version: number; blocks: Array<{ type: string; text?: string; fallbackText?: string }> }; citations: Citation[];
};
export type PageResult<T> = { items: T[]; nextCursor: string | null };
