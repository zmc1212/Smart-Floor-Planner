import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConversationFallbackPrompt,
  resolveConversationBaseline,
} from '@/lib/ai/conversation-prompt';
import { resolveWorkflowImageMode, usesFloorPlanControlImage } from '@/lib/ai/workflow-floorplan';
import {
  groupPublishedSchemes,
  pickFeaturedPublishedScheme,
  buildPublishedSchemeViews,
  LEGACY_PUBLISHED_SCHEME_TITLE,
} from '@/lib/customer-project';
import type { CustomerProjectPublication } from '@/db/repositories';

test('conversation turns always edit from the floor-plan control image', () => {
  assert.equal(resolveWorkflowImageMode('conversation', 'generation'), 'edit');
  assert.equal(usesFloorPlanControlImage('conversation'), true);
  assert.equal(usesFloorPlanControlImage('lighting'), false);
});

test('conversation fallback prompt keeps the designer request and floor-plan constraints', () => {
  const prompt = buildConversationFallbackPrompt({
    userMessage: '客厅暖光',
    floorPlanContext: 'Living room 4000mm',
    hasBaselineImage: false,
  });
  assert.match(prompt, /客厅暖光/);
  assert.match(prompt, /Living room 4000mm/);
  assert.match(prompt, /control image/);
});

test('conversation baseline must belong to the same succeeded image set', () => {
  const generations = [
    { id: 2n, status: 'succeeded', output: { imageUrl: 'https://example.invalid/b.png' } },
    { id: 1n, status: 'failed', output: {} },
  ];
  assert.equal(resolveConversationBaseline(generations, null)?.id, 2n);
  assert.equal(resolveConversationBaseline(generations, 2n)?.id, 2n);
  assert.throws(
    () => resolveConversationBaseline(generations, 9n),
    (error: unknown) => {
      assert.equal((error as Error & { code?: string }).code, 'BASELINE_NOT_FOUND');
      return true;
    }
  );
});

test('published schemes group by workflow and collect ungrouped singles', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');
  const publications = [
    {
      publication: {
        id: 11n,
        workflowId: 88n,
        schemeTitle: '灯光设计',
        sortOrder: 1,
        publishedAt: now,
      },
      generation: { id: 101n, type: 'scenario', stageKey: 'conversation', input: { userMessage: '暖光' } },
    },
    {
      publication: {
        id: 10n,
        workflowId: 88n,
        schemeTitle: '灯光设计',
        sortOrder: 0,
        publishedAt: now,
      },
      generation: { id: 100n, type: 'scenario', stageKey: 'conversation', input: { userMessage: '首轮' } },
    },
    {
      publication: {
        id: 12n,
        workflowId: null,
        schemeTitle: null,
        sortOrder: 0,
        publishedAt: new Date('2026-08-18T12:00:00.000Z'),
      },
      generation: { id: 200n, type: 'miniprogram', stageKey: 'soft_furnishing', input: { recipeName: '现代舒居' } },
    },
  ] as unknown as CustomerProjectPublication[];

  const schemes = groupPublishedSchemes(publications, '7');
  assert.equal(schemes[0]?.id, 'legacy');
  assert.equal(schemes[0]?.title, LEGACY_PUBLISHED_SCHEME_TITLE);
  assert.equal(schemes[0]?.images[0]?.title, '现代舒居');
  assert.equal(schemes[1]?.id, '88');
  assert.equal(schemes[1]?.title, '灯光设计');
  assert.deepEqual(schemes[1]?.images.map((item) => item.generationId), ['100', '101']);
  assert.equal(
    schemes[1]?.images[0]?.imageEndpoint,
    '/miniprogram/customer-projects/7/published-generations/100/image'
  );
  assert.equal(pickFeaturedPublishedScheme(schemes)?.id, '88');
});

test('updating a later scheme does not reorder earlier rounds', () => {
  const firstPublished = new Date('2026-08-20T10:00:00.000Z');
  const secondPublished = new Date('2026-08-21T10:00:00.000Z');
  const firstUpdated = new Date('2026-08-22T11:02:00.000Z');
  const publications = [
    {
      publication: {
        id: 31n,
        workflowId: 2n,
        schemeTitle: '灯光方案',
        sortOrder: 0,
        createdAt: secondPublished,
        publishedAt: secondPublished,
        updatedAt: secondPublished,
      },
      generation: { id: 401n, type: 'scenario', stageKey: 'lighting', input: {} },
    },
    {
      publication: {
        id: 30n,
        workflowId: 1n,
        schemeTitle: 'AI 设计方案',
        sortOrder: 0,
        createdAt: firstPublished,
        publishedAt: firstUpdated,
        updatedAt: firstUpdated,
      },
      generation: { id: 400n, type: 'scenario', stageKey: 'conversation', input: {} },
    },
  ] as unknown as CustomerProjectPublication[];

  const schemes = groupPublishedSchemes(publications, '7');
  assert.deepEqual(schemes.map((scheme) => scheme.id), ['1', '2']);
  assert.equal(schemes[0]?.title, 'AI 设计方案');
  assert.equal(schemes[0]?.firstPublishedAt.toISOString(), firstPublished.toISOString());
  assert.equal(schemes[0]?.publishedAt.toISOString(), firstUpdated.toISOString());
  assert.equal(schemes[1]?.title, '灯光方案');
  assert.equal(pickFeaturedPublishedScheme(schemes)?.id, '1');
});

test('pickFeaturedPublishedScheme prefers finalized workflow when present', () => {
  const older = new Date('2026-08-20T10:00:00.000Z');
  const newer = new Date('2026-08-22T10:00:00.000Z');
  const schemes = [
    {
      id: '1',
      workflowId: '1',
      title: '首轮',
      firstPublishedAt: older,
      publishedAt: older,
      finalized: false,
      images: [],
    },
    {
      id: '2',
      workflowId: '2',
      title: '定稿套',
      firstPublishedAt: newer,
      publishedAt: newer,
      finalized: true,
      images: [],
    },
  ];
  assert.equal(pickFeaturedPublishedScheme(schemes, '2')?.id, '2');
  assert.equal(pickFeaturedPublishedScheme(schemes)?.id, '2');
});

test('buildPublishedSchemeViews marks finalized scheme and moves it first', () => {
  const firstPublished = new Date('2026-08-20T10:00:00.000Z');
  const secondPublished = new Date('2026-08-21T10:00:00.000Z');
  const publications = [
    {
      publication: {
        id: 31n,
        workflowId: 2n,
        schemeTitle: '灯光方案',
        sortOrder: 0,
        publishedAt: secondPublished,
      },
      generation: { id: 401n, type: 'scenario', stageKey: 'lighting', input: {} },
    },
    {
      publication: {
        id: 30n,
        workflowId: 1n,
        schemeTitle: 'AI 设计方案',
        sortOrder: 0,
        publishedAt: firstPublished,
      },
      generation: { id: 400n, type: 'scenario', stageKey: 'conversation', input: {} },
    },
  ] as unknown as CustomerProjectPublication[];

  const views = buildPublishedSchemeViews(publications, '7', 1n);
  assert.equal(views[0]?.id, '1');
  assert.equal(views[0]?.finalized, true);
  assert.equal(views[1]?.finalized, false);
});

test('published image titles never expose designer prompts or internal style keys', () => {
  const now = new Date('2026-08-20T08:00:00.000Z');
  const publications = [
    {
      publication: {
        id: 21n,
        workflowId: 9n,
        schemeTitle: '灯光设计',
        sortOrder: 0,
        publishedAt: now,
      },
      generation: {
        id: 301n,
        type: 'free_create',
        stageKey: 'conversation',
        input: { style: 'conversation', userMessage: '客厅加暖光' },
      },
    },
    {
      publication: {
        id: 22n,
        workflowId: 9n,
        schemeTitle: '灯光设计',
        sortOrder: 1,
        publishedAt: now,
      },
      generation: {
        id: 302n,
        type: 'free_create',
        stageKey: 'conversation',
        input: { style: 'conversation' },
      },
    },
  ] as unknown as CustomerProjectPublication[];

  const schemes = groupPublishedSchemes(publications, '7');
  assert.equal(schemes[0]?.images[0]?.title, '灯光设计');
  assert.equal(schemes[0]?.images[1]?.title, '灯光设计');
});
