import { compileDefinition, definitionDigest } from './compile';
import { WorkflowDefinitionError, WorkflowOperationError } from './errors';
import { fixtureMatchesDefinition, fixtureSetSummaries, findFixtureSet, type WorkflowFixtureSetSummary } from './fixtures/catalog';
import { simulate, type SimulationResult } from './simulate';
import { createElectricalInspectionDefinition, createWaterproofInspectionDefinition } from './specialist-template';
import { electricalWorkflowTemplateId, waterproofWorkflowTemplateId } from '../assistant/specialists/registry';
import { createStageConsultationDefinition } from './stage-consultation-template';
import { createPeriodReportDefinition, createStageReminderDefinition } from './templates';
import type { WorkflowDefinition } from './types';
import { validateDefinition } from './validate';
import type {
  PublishedWorkflowVersion,
  WorkflowDefinitionRecord,
  WorkflowDefinitionStore,
  WorkflowDefinitionSummary,
} from './store/types';

export const nativeWorkflowTemplateIds = [
  'stage-reminder',
  'stage-guidance',
  'stage-checklist',
  'period-report-daily',
  'period-report-weekly',
  waterproofWorkflowTemplateId,
  electricalWorkflowTemplateId,
] as const;

export type NativeWorkflowTemplateId = (typeof nativeWorkflowTemplateIds)[number];

const templateBuilders: Record<NativeWorkflowTemplateId, () => WorkflowDefinition> = {
  'stage-reminder': createStageReminderDefinition,
  'stage-guidance': () => createStageConsultationDefinition('stage-guidance'),
  'stage-checklist': () => createStageConsultationDefinition('stage-checklist'),
  'period-report-daily': () => createPeriodReportDefinition('daily'),
  'period-report-weekly': () => createPeriodReportDefinition('weekly'),
  [waterproofWorkflowTemplateId]: createWaterproofInspectionDefinition,
  [electricalWorkflowTemplateId]: createElectricalInspectionDefinition,
};

export function isNativeWorkflowTemplateId(value: unknown): value is NativeWorkflowTemplateId {
  return typeof value === 'string' && (nativeWorkflowTemplateIds as readonly string[]).includes(value);
}

export interface PublishResult {
  readonly record: WorkflowDefinitionRecord;
  readonly version: PublishedWorkflowVersion;
  readonly created: boolean;
}

export interface WorkflowService {
  listDefinitions(): Promise<WorkflowDefinitionSummary[]>;
  getDefinition(definitionId: string): Promise<{
    record: WorkflowDefinitionRecord;
    fixtureSets: readonly WorkflowFixtureSetSummary[];
  }>;
  createFromTemplate(templateId: NativeWorkflowTemplateId, definitionId?: string): Promise<WorkflowDefinitionRecord>;
  saveDraft(input: {
    readonly definitionId: string;
    readonly definition: unknown;
    readonly expectedDraftRevision: number;
  }): Promise<WorkflowDefinitionRecord>;
  publishDraft(input: {
    readonly definitionId: string;
    readonly expectedDraftRevision: number;
  }): Promise<PublishResult>;
  simulate(input: {
    readonly definitionId: string;
    readonly source?: 'draft' | 'published';
    readonly revision?: number;
    readonly fixtureSetId: string;
  }): Promise<{ readonly simulation: SimulationResult; readonly source: 'draft' | 'published'; readonly revision: number }>;
}

function withIdentity(raw: unknown, definitionId: string, revision: number): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  return { ...(raw as Record<string, unknown>), definitionId, revision };
}

function assertExpectedDraftRevision(record: WorkflowDefinitionRecord, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1) {
    throw new WorkflowOperationError('invalid_request', 400, 'expectedDraftRevision must be a positive integer');
  }
  if (record.draft.draftRevision !== expected) {
    throw new WorkflowOperationError('draft_conflict', 409, 'draft revision conflict', {
      currentDraftRevision: record.draft.draftRevision,
    });
  }
}

export function createWorkflowService(options: {
  readonly store: WorkflowDefinitionStore;
  readonly now?: () => string;
}): WorkflowService {
  const store = options.store;
  const now = options.now ?? (() => new Date().toISOString());

  async function requireRecord(definitionId: string): Promise<WorkflowDefinitionRecord> {
    const record = await store.get(definitionId);
    if (!record) {
      throw new WorkflowOperationError('definition_not_found', 404, `definition ${definitionId} was not found`);
    }
    return record;
  }

  return {
    async listDefinitions(): Promise<WorkflowDefinitionSummary[]> {
      return store.list();
    },

    async getDefinition(definitionId: string) {
      return { record: await requireRecord(definitionId), fixtureSets: fixtureSetSummaries };
    },

    async createFromTemplate(templateId: NativeWorkflowTemplateId, definitionId?: string): Promise<WorkflowDefinitionRecord> {
      if (!isNativeWorkflowTemplateId(templateId)) {
        throw new WorkflowOperationError('invalid_request', 400, 'unknown template id');
      }
      const seed = templateBuilders[templateId]();
      if (definitionId !== undefined && definitionId !== templateId
        && (seed.inputSchema.eventType !== 'stage_consultation' || !/^stage-tool-[a-z0-9][a-z0-9-]{0,51}$/.test(definitionId))) {
        throw new WorkflowOperationError('invalid_request', 400, '自定义阶段模板标识须以 stage-tool- 开头，后接小写字母、数字或短横线');
      }
      const checked = validateDefinition({ ...seed, definitionId: definitionId ?? templateId });
      if (!checked.ok) throw new WorkflowDefinitionError([...checked.issues]);
      return store.create({ definition: checked.definition, now: now() });
    },

    async saveDraft({ definitionId, definition, expectedDraftRevision }): Promise<WorkflowDefinitionRecord> {
      const record = await requireRecord(definitionId);
      assertExpectedDraftRevision(record, expectedDraftRevision);
      const latestPublished = record.versions[record.versions.length - 1]?.revision ?? 0;
      const checked = validateDefinition(withIdentity(definition, definitionId, latestPublished + 1));
      if (!checked.ok) throw new WorkflowDefinitionError([...checked.issues]);
      if (checked.definition.inputSchema.eventType !== record.draft.definition.inputSchema.eventType) {
        throw new WorkflowOperationError('invalid_request', 422, '已建工作流的触发事件不能更换');
      }
      return store.saveDraft({
        definitionId,
        definition: checked.definition,
        expectedDraftRevision,
        now: now(),
      });
    },

    async publishDraft({ definitionId, expectedDraftRevision }): Promise<PublishResult> {
      const record = await requireRecord(definitionId);
      assertExpectedDraftRevision(record, expectedDraftRevision);
      const latestVersion = record.versions[record.versions.length - 1] ?? null;
      const latestRevision = latestVersion?.revision ?? 0;
      const checked = validateDefinition(withIdentity(record.draft.definition, definitionId, latestRevision + 1));
      if (!checked.ok) throw new WorkflowDefinitionError([...checked.issues]);
      const plan = compileDefinition(checked.definition);

      if (latestVersion) {
        const comparable = { ...checked.definition, revision: latestVersion.revision };
        if (definitionDigest(comparable) === latestVersion.digest) {
          return { record, version: latestVersion, created: false };
        }
      }

      const version: PublishedWorkflowVersion = {
        revision: checked.definition.revision,
        digest: plan.digest,
        definition: checked.definition,
        publishedAt: now(),
        nodeVersions: Object.fromEntries(
          Object.values(plan.nodes).map((node) => [node.nodeId, node.nodeVersion]),
        ),
      };
      const updated = await store.appendVersion({ definitionId, expectedDraftRevision, version });
      return { record: updated, version, created: true };
    },

    async simulate({ definitionId, source = 'draft', revision, fixtureSetId }) {
      const record = await requireRecord(definitionId);
      let definition: WorkflowDefinition;
      let resolvedRevision: number;
      if (source === 'published') {
        const version =
          revision === undefined
            ? record.versions[record.versions.length - 1]
            : record.versions.find((candidate) => candidate.revision === revision);
        if (!version) {
          throw new WorkflowOperationError('version_not_found', 404, `published revision ${revision ?? ''} was not found`);
        }
        definition = version.definition;
        resolvedRevision = version.revision;
      } else if (source === 'draft') {
        definition = record.draft.definition;
        resolvedRevision = definition.revision;
      } else {
        throw new WorkflowOperationError('invalid_request', 400, 'simulation source must be draft or published');
      }

      const fixtureSet = findFixtureSet(fixtureSetId);
      if (!fixtureSet) {
        throw new WorkflowOperationError('fixture_not_found', 404, `fixture set ${fixtureSetId} was not found`);
      }
      const checked = validateDefinition(definition);
      if (!checked.ok) throw new WorkflowDefinitionError([...checked.issues]);
      if (!fixtureMatchesDefinition(fixtureSet, checked.definition)) {
        throw new WorkflowOperationError(
          'fixture_incompatible',
          400,
          `fixture set ${fixtureSetId} does not match ${checked.definition.inputSchema.eventType}`,
        );
      }
      const simulation = simulate({
        definition: checked.definition,
        scenario: fixtureSet.scenario,
        fixtures: fixtureSet.fixtures,
      });
      return { simulation, source, revision: resolvedRevision };
    },
  };
}
