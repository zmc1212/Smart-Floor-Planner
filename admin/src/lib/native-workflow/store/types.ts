import type { WorkflowDefinition, WorkflowInputSchema } from '../types';

export interface WorkflowDraft {
  readonly definition: WorkflowDefinition;
  /** Optimistic-lock token: increments on every successful draft save. */
  readonly draftRevision: number;
  readonly updatedAt: string;
  readonly basePublishedRevision: number;
}

export interface PublishedWorkflowVersion {
  readonly revision: number;
  readonly digest: string;
  readonly definition: WorkflowDefinition;
  readonly publishedAt: string;
  readonly nodeVersions: Readonly<Record<string, string>>;
}

export interface WorkflowDefinitionRecord {
  readonly definitionId: string;
  readonly draft: WorkflowDraft;
  readonly versions: readonly PublishedWorkflowVersion[];
}

export interface WorkflowDefinitionSummary {
  readonly definitionId: string;
  readonly eventType: WorkflowInputSchema['eventType'];
  readonly periodKind: WorkflowInputSchema['periodKind'] | null;
  readonly latestPublishedRevision: number | null;
  readonly draftRevision: number;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface WorkflowDefinitionStore {
  list(): Promise<WorkflowDefinitionSummary[]>;
  get(definitionId: string): Promise<WorkflowDefinitionRecord | null>;
  create(input: { readonly definition: WorkflowDefinition; readonly now: string }): Promise<WorkflowDefinitionRecord>;
  saveDraft(input: {
    readonly definitionId: string;
    readonly definition: WorkflowDefinition;
    readonly expectedDraftRevision: number;
    readonly now: string;
  }): Promise<WorkflowDefinitionRecord>;
  appendVersion(input: {
    readonly definitionId: string;
    readonly expectedDraftRevision: number;
    readonly version: PublishedWorkflowVersion;
  }): Promise<WorkflowDefinitionRecord>;
}

export function summarizeRecord(record: WorkflowDefinitionRecord): WorkflowDefinitionSummary {
  const latest = record.versions[record.versions.length - 1] ?? null;
  return {
    definitionId: record.definitionId,
    eventType: record.draft.definition.inputSchema.eventType,
    periodKind: record.draft.definition.inputSchema.periodKind ?? null,
    latestPublishedRevision: latest?.revision ?? null,
    draftRevision: record.draft.draftRevision,
    updatedAt: record.draft.updatedAt,
    publishedAt: latest?.publishedAt ?? null,
  };
}

export function cloneRecord(record: WorkflowDefinitionRecord): WorkflowDefinitionRecord {
  return structuredClone(record);
}
