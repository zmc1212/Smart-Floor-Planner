import type { WorkflowFixtureSetSummary } from './fixtures/catalog';
import type { WorkflowDefinitionRecord } from './store/types';
import type { WorkflowDefinition, WorkflowInputSchema } from './types';

export interface SelectedSimulationDefinition {
  readonly definition: WorkflowDefinition;
  readonly revision: number;
  readonly source: 'draft' | 'published';
}

/** Resolve the definition a simulation will actually use before choosing fixtures. */
export function selectedSimulationDefinition(
  record: WorkflowDefinitionRecord,
  source: 'draft' | 'published',
  revision?: number,
): SelectedSimulationDefinition | null {
  if (source === 'published') {
    const version =
      revision === undefined
        ? record.versions[record.versions.length - 1]
        : record.versions.find((candidate) => candidate.revision === revision);
    return version ? { definition: version.definition, revision: version.revision, source } : null;
  }
  return { definition: record.draft.definition, revision: record.draft.definition.revision, source: 'draft' };
}

export function fixtureSetsForSchema(
  schema: WorkflowInputSchema,
  sets: readonly WorkflowFixtureSetSummary[],
): WorkflowFixtureSetSummary[] {
  return sets.filter(
    (set) => set.eventType === schema.eventType && (set.periodKind ?? null) === (schema.periodKind ?? null),
  );
}

/** Keep a compatible selection; otherwise fall back to the first compatible set. */
export function resolveFixtureSetId(
  compatibleSets: readonly WorkflowFixtureSetSummary[],
  preferredId: string,
): string {
  if (compatibleSets.some((set) => set.id === preferredId)) return preferredId;
  return compatibleSets[0]?.id ?? '';
}
