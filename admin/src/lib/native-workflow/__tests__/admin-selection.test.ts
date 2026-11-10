import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPeriodReportDefinition } from '../index';
import type { WorkflowDefinitionRecord } from '../store/types';
import { fixtureSetSummaries } from '../fixtures/catalog';
import { fixtureSetsForSchema, resolveFixtureSetId, selectedSimulationDefinition } from '../admin-selection';

const now = '2026-11-11T12:00:00.000Z';

function reportRecord(): WorkflowDefinitionRecord {
  const weekly = { ...createPeriodReportDefinition('weekly'), definitionId: 'period-report-weekly', revision: 1 };
  const daily = { ...createPeriodReportDefinition('daily'), definitionId: 'period-report-weekly', revision: 2 };
  return {
    definitionId: 'period-report-weekly',
    draft: {
      definition: daily,
      draftRevision: 5,
      updatedAt: now,
      basePublishedRevision: 1,
    },
    versions: [
      {
        revision: 1,
        digest: 'a'.repeat(64),
        definition: weekly,
        publishedAt: now,
        nodeVersions: {},
      },
    ],
  };
}

test('published revision keeps its own schema and fixture family after the draft changes', () => {
  const record = reportRecord();

  const published = selectedSimulationDefinition(record, 'published', 1);
  assert.ok(published);
  assert.equal(published.definition.inputSchema.periodKind, 'weekly');

  const weeklySets = fixtureSetsForSchema(published.definition.inputSchema, fixtureSetSummaries);
  assert.ok(weeklySets.some((set) => set.id === 'report-weekly-normal'));
  assert.equal(weeklySets.some((set) => set.id === 'report-daily-normal'), false);
  assert.equal(resolveFixtureSetId(weeklySets, 'report-daily-normal'), 'report-weekly-normal');
  assert.equal(resolveFixtureSetId(weeklySets, 'report-weekly-normal'), 'report-weekly-normal');

  const draft = selectedSimulationDefinition(record, 'draft');
  assert.ok(draft);
  assert.equal(draft.definition.inputSchema.periodKind, 'daily');
  const dailySets = fixtureSetsForSchema(draft.definition.inputSchema, fixtureSetSummaries);
  assert.ok(dailySets.some((set) => set.id === 'report-daily-normal'));
  assert.equal(dailySets.some((set) => set.id === 'report-weekly-normal'), false);
});

test('a missing published revision resolves to null instead of falling back silently', () => {
  assert.equal(selectedSimulationDefinition(reportRecord(), 'published', 9), null);
});
