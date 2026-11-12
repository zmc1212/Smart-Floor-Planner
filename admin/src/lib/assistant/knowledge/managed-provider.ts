export type ManagedReceipt<T> = { value: T; requestId: string | null };
export type ManagedDocument = { id: string; status: string; tags: string[] };
export type ManagedSlice = {
  id: string; workspaceId: string; indexId: string; documentId: string;
  text: string; score: number; section: string[];
};
export type ManagedState = 'pending' | 'ready' | 'failed';

/** Server-only port. Every remote operation is bound to a configured workspace.
 * Callers resolve tenant, index, document and filters from local authorization. */
export interface ManagedKnowledgeProvider {
  readonly workspaceId: string;
  readonly model: string;
  upload(file: { name: string; data: Buffer; tag: string }): Promise<ManagedReceipt<string>>;
  fileStatus(fileId: string): Promise<ManagedReceipt<ManagedState>>;
  createIndex(name: string, fileId: string): Promise<ManagedReceipt<string>>;
  listIndices(): Promise<ManagedReceipt<Array<{ id: string; name: string }>>>;
  importDocument(indexId: string, fileId: string): Promise<ManagedReceipt<string>>;
  importStatus(indexId: string, jobId: string): Promise<ManagedReceipt<ManagedState>>;
  listDocuments(indexId: string, page: number): Promise<ManagedReceipt<{ documents: ManagedDocument[]; total: number }>>;
  listSlices(indexId: string, documentId: string, page: number): Promise<ManagedReceipt<{ slices: ManagedSlice[]; total: number }>>;
  retrieve(input: { indexId: string; tags: string[]; query: string; topK: number; signal?: AbortSignal }): Promise<ManagedReceipt<ManagedSlice[]>>;
  deleteDocument(indexId: string, documentId: string): Promise<ManagedReceipt<boolean>>;
  deleteFile(fileId: string): Promise<ManagedReceipt<void>>;
}
