import { fail, type Evidence, type KnowledgeProvenance } from '../contracts';
import { injectionSignals } from '../contracts/native-tools';
import type { FileLocator } from '../contracts/source-file';
import type { Row } from '@/db/repositories/assistant-repository';

export function knowledgeTextAllowed(...values: unknown[]) {
  return values.every(value => typeof value !== 'string' || injectionSignals(value.normalize('NFKC')).length === 0);
}

export function assertKnowledgeText(...values: unknown[]) {
  if (!knowledgeTextAllowed(...values)) fail('knowledge_instruction_content', 422);
}

/** Title, scope and version are resolved from the same authorized row as the excerpt. */
export function knowledgeProvenance(row: Row): KnowledgeProvenance {
  return {
    enterpriseName: String(row.enterprise_name), documentId: String(row.document_id), title: String(row.title),
    versionId: String(row.document_version_id), versionNumber: Number(row.version_number),
    scope: row.scope === 'project' ? 'project' : 'enterprise', projectId: row.project_id ? String(row.project_id) : null,
    category: String(row.category), sourceType: String(row.source_type),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    effectiveTo: row.effective_to ? new Date(String(row.effective_to)).toISOString() : null,
    published: !!row.published_at,
  };
}

export function knowledgeRowAllowed(row: Row) {
  const file = (row.locator as { file?: FileLocator } | null)?.file;
  return knowledgeTextAllowed(row.text, row.title, row.enterprise_name, row.category, file?.name, file?.label);
}

export function knowledgeEvidence(row: Row): Evidence {
  const file = (row.locator as { file?: FileLocator } | null)?.file;
  return {
    ref: { type: 'knowledge_chunk', id: String(row.id), version: String(row.document_version_id) },
    text: String(row.text), hash: String(row.text_hash), knowledge: knowledgeProvenance(row),
    ...(file ? { file } : {}),
  };
}
