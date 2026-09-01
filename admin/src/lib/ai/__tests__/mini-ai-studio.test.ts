import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyMiniAiAssetSignature,
  verifyMiniAiRecipePreviewSignature,
  verifyMiniAiStudioFloorPlanPreviewSignature,
  verifyMiniAiStudioGenerationSignature,
  getSignedMiniAiAssetUrl,
} from '@/lib/ai/mini-ai-assets';
import {
  canManageLead,
  rewriteStudioImageUrl,
  serializeCreationTaskForMini,
  serializePromptTemplatesForMini,
  serializeWorkflowContextForMini,
  serializeWorkflowListForMini,
} from '@/lib/ai/mini-ai-studio';
import {
  alignedSignedUrlDeadline,
  alignedSignedUrlExpiresInSeconds,
} from '@/lib/media-storage/operations';
import {
  mediaAssetDisplayUrlTtlSeconds,
  resolveMediaAssetDisplayUrls,
} from '@/lib/ai/postgres-media-assets';

test('canManageLead allows enterprise_admin and assigned designer only', () => {
  const staffId = BigInt(45);
  assert.equal(canManageLead('enterprise_admin', BigInt(99), staffId), true);
  assert.equal(canManageLead('designer', staffId, staffId), true);
  assert.equal(canManageLead('designer', BigInt(99), staffId), false);
  assert.equal(canManageLead('measurer', staffId, staffId), false);
});

test('aligned signed URL deadline stays stable within a TTL window', () => {
  const ttl = 7 * 24 * 3600;
  const now = 1_700_000_000;
  const deadline = alignedSignedUrlDeadline(ttl, now);
  assert.equal(alignedSignedUrlDeadline(ttl, now + 60), deadline);
  assert.equal(alignedSignedUrlExpiresInSeconds(ttl, now), deadline - now);
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/bootstrap');
  const first = getSignedMiniAiAssetUrl({
    request,
    assetId: '81',
    enterpriseId: '23',
    ttlSeconds: ttl,
    alignDeadline: true,
  });
  const second = getSignedMiniAiAssetUrl({
    request,
    assetId: '81',
    enterpriseId: '23',
    ttlSeconds: ttl,
    alignDeadline: true,
  });
  assert.equal(first, second);
  assert.equal(new URL(first).searchParams.get('expires'), String(alignedSignedUrlDeadline(ttl)));
});

test('resolveMediaAssetDisplayUrls stays on aligned Mini API URLs when direct Qiniu display is off', async () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/workflows/1');
  const first = await resolveMediaAssetDisplayUrls({
    request,
    enterpriseId: '23',
    assetIds: ['81', '81', 'bad'],
    directQiniuDisplayUrls: false,
  });
  const second = await resolveMediaAssetDisplayUrls({
    request,
    enterpriseId: '23',
    assetIds: ['81'],
    directQiniuDisplayUrls: false,
  });
  assert.equal(first.get('81'), second.get('81'));
  assert.match(String(first.get('81')), /\/api\/miniprogram\/ai\/assets\/81\/image/);
  assert.equal(first.has('bad'), false);
  assert.equal(new URL(String(first.get('81'))).searchParams.get('expires'), String(alignedSignedUrlDeadline(mediaAssetDisplayUrlTtlSeconds())));
});

test('rewriteStudioImageUrl prefers a Qiniu display map and signs API paths with aligned expires', () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/bootstrap');
  const enterpriseId = '23';
  const qiniuUrl = 'https://media.example.com/23/2026/asset.jpg?e=1700000000&token=signed';
  assert.equal(
    rewriteStudioImageUrl(request, enterpriseId, '/api/ai/assets/81/image', new Map([['81', qiniuUrl]])),
    qiniuUrl,
  );
  const assetUrl = rewriteStudioImageUrl(request, enterpriseId, '/api/ai/assets/81/image');
  const generationUrl = rewriteStudioImageUrl(request, enterpriseId, '/api/ai/generations/901/image');
  assert.ok(assetUrl);
  assert.ok(generationUrl);
  const assetParsed = new URL(String(assetUrl));
  const generationParsed = new URL(String(generationUrl));
  assert.equal(assetParsed.pathname, '/api/miniprogram/ai/assets/81/image');
  assert.equal(generationParsed.pathname, '/api/miniprogram/ai/studio/generations/901/image');
  assert.equal(
    Number(assetParsed.searchParams.get('expires')),
    alignedSignedUrlDeadline(mediaAssetDisplayUrlTtlSeconds()),
  );
  assert.equal(verifyMiniAiAssetSignature({
    assetId: '81',
    enterpriseId,
    expires: Number(assetParsed.searchParams.get('expires')),
    signature: assetParsed.searchParams.get('signature') || '',
  }), true);
  assert.equal(verifyMiniAiStudioGenerationSignature({
    generationId: '901',
    enterpriseId,
    expires: Number(generationParsed.searchParams.get('expires')),
    signature: generationParsed.searchParams.get('signature') || '',
  }), true);
});

test('serializeWorkflowContextForMini preserves published flags and signs floor-plan preview', async () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/workflows/42');
  const serialized = await serializeWorkflowContextForMini(request, '23', {
    workflow: {
      id: '42',
      title: '灯光设计',
      generationCount: 2,
      floorPlanPreviewUrl: '/api/ai/workflows/42/floor-plan-preview?v=3',
      sourceFloorPlan: { id: '7', name: '正式户型' },
      latestGeneration: {
        id: '901',
        imageUrl: '/api/ai/assets/91/image',
      },
    },
    lead: { id: '12', name: '张先生' },
    generations: [
      { id: '901', status: 'succeeded', imageUrl: '/api/ai/assets/91/image', published: true },
      { id: '902', status: 'succeeded', imageUrl: '/api/ai/generations/902/image', published: false },
    ],
    publishedScheme: {
      title: '灯光设计',
      publishedAt: '2026-08-20T08:00:00.000Z',
      generationIds: ['901'],
    },
  } as never);
  assert.equal(serialized.workflow.publishedCount, 1);
  assert.equal(serialized.generations[0].published, true);
  assert.equal(serialized.generations[1].published, false);
  // Without a live media provider, asset display falls back to aligned Mini API URLs.
  assert.match(String(serialized.workflow.coverUrl), /\/api\/miniprogram\/ai\/assets\/91\/image/);
  assert.match(String(serialized.workflow.latestGeneration?.imageUrl), /\/api\/miniprogram\/ai\/assets\/91\/image/);
  assert.match(String(serialized.generations[0].imageUrl), /\/api\/miniprogram\/ai\/assets\/91\/image/);
  assert.match(String(serialized.generations[1].imageUrl), /\/api\/miniprogram\/ai\/studio\/generations\/902\/image/);
  assert.equal(
    String(serialized.generations[0].imageUrl),
    rewriteStudioImageUrl(request, '23', '/api/ai/assets/91/image'),
  );
  assert.match(String(serialized.workflow.floorPlanPreviewUrl), /\/api\/miniprogram\/ai\/studio\/workflows\/42\/floor-plan-preview/);
  assert.equal(verifyMiniAiStudioFloorPlanPreviewSignature({
    workflowId: '42',
    enterpriseId: '23',
    expires: Number(new URL(String(serialized.workflow.floorPlanPreviewUrl)).searchParams.get('expires')),
    signature: new URL(String(serialized.workflow.floorPlanPreviewUrl)).searchParams.get('signature') || '',
  }), true);
});

test('serializeWorkflowContextForMini drops bulky generation payloads', async () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/workflows/42');
  const serialized = await serializeWorkflowContextForMini(request, '23', {
    workflow: { id: '42', latestGeneration: { id: '901', output: { imageUrl: '/api/ai/assets/91/image', providerResult: { blob: 'x'.repeat(10000) } }, input: { roomData: { walls: 'x'.repeat(10000) } } } },
    lead: { id: '12', name: '张先生' },
    generations: [{
      id: '901',
      status: 'succeeded',
      input: { userMessage: '保留这句提示词', roomData: { walls: 'x'.repeat(10000) } },
      output: { imageUrl: '/api/ai/assets/91/image', providerResult: { blob: 'x'.repeat(10000) } },
      published: false,
    }],
    publishedScheme: null,
  } as never);
  assert.deepEqual(serialized.generations[0]?.input, { userMessage: '保留这句提示词' });
  assert.deepEqual(serialized.generations[0]?.output, {
    imageUrl: rewriteStudioImageUrl(request, '23', '/api/ai/assets/91/image'),
  });
});

test('serializeCreationTaskForMini rewrites batch generation image URLs stably', async () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/tasks');
  const serialized = await serializeCreationTaskForMini(request, '23', {
    id: BigInt(11),
    title: '自由出图',
    prompt: '奶油风客厅',
    status: 'ready',
    modelProfileId: BigInt(3),
    referenceAssetIds: [],
    createdAt: new Date('2026-08-20T08:00:00.000Z'),
    updatedAt: new Date('2026-08-20T08:00:00.000Z'),
    batches: [{
      id: BigInt(21),
      sequence: 1,
      prompt: '奶油风客厅',
      negativePrompt: null,
      referenceAssetIds: [],
      modelProfileId: BigInt(3),
      modelProfileSnapshot: {},
      parameterSnapshot: {},
      requestedCount: 1,
      status: 'succeeded',
      creditsEstimate: 4,
      createdAt: new Date('2026-08-20T08:01:00.000Z'),
      generations: [{
        id: BigInt(901),
        status: 'succeeded',
        output: { imageUrl: '/api/ai/assets/91/image' },
        input: {},
        errorMessage: null,
        provider: 'test',
        retryCount: 0,
        workflowId: null,
        createdAt: new Date('2026-08-20T08:02:00.000Z'),
        updatedAt: new Date('2026-08-20T08:02:00.000Z'),
      }],
    }],
  } as never);
  assert.equal(serialized.batches.length, 1);
  const imageUrl = String(serialized.batches[0].generations[0].imageUrl || '');
  assert.match(imageUrl, /\/api\/miniprogram\/ai\/assets\/91\/image/);
  const again = await serializeCreationTaskForMini(request, '23', {
    id: BigInt(11),
    title: '自由出图',
    prompt: '奶油风客厅',
    status: 'ready',
    modelProfileId: BigInt(3),
    referenceAssetIds: [],
    createdAt: new Date('2026-08-20T08:00:00.000Z'),
    updatedAt: new Date('2026-08-20T08:00:00.000Z'),
    batches: [{
      id: BigInt(21),
      sequence: 1,
      prompt: '奶油风客厅',
      negativePrompt: null,
      referenceAssetIds: [],
      modelProfileId: BigInt(3),
      modelProfileSnapshot: {},
      parameterSnapshot: {},
      requestedCount: 1,
      status: 'succeeded',
      creditsEstimate: 4,
      createdAt: new Date('2026-08-20T08:01:00.000Z'),
      generations: [{
        id: BigInt(901),
        status: 'succeeded',
        output: { imageUrl: '/api/ai/assets/91/image' },
        input: {},
        errorMessage: null,
        provider: 'test',
        retryCount: 0,
        workflowId: null,
        createdAt: new Date('2026-08-20T08:02:00.000Z'),
        updatedAt: new Date('2026-08-20T08:02:00.000Z'),
      }],
    }],
  } as never);
  assert.equal(imageUrl, String(again.batches[0].generations[0].imageUrl || ''));
  const parsed = new URL(imageUrl);
  assert.equal(verifyMiniAiAssetSignature({
    assetId: '91',
    enterpriseId: '23',
    expires: Number(parsed.searchParams.get('expires')),
    signature: parsed.searchParams.get('signature') || '',
  }), true);
});

test('serializeWorkflowListForMini signs scheme covers from confirmed or succeeded images', async () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/workflows?leadId=12');
  const serialized = await serializeWorkflowListForMini(request, '23', {
    data: [{
      id: '88',
      title: '灯光设计',
      publishedCount: 2,
      coverImageUrl: '/api/ai/assets/91/image',
      latestGeneration: {
        id: '903',
        status: 'processing',
        output: {},
      },
    }, {
      id: '89',
      title: 'AI 设计方案',
      publishedCount: 0,
      latestGeneration: {
        id: '904',
        status: 'succeeded',
        output: { imageUrl: '/api/ai/generations/904/image' },
      },
    }, {
      id: '90',
      title: '空方案',
      publishedCount: 0,
      generationCount: 0,
    }],
    pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
  });
  assert.match(String(serialized.data[0].coverUrl), /\/api\/miniprogram\/ai\/assets\/91\/image/);
  assert.match(String(serialized.data[1].coverUrl), /\/api\/miniprogram\/ai\/studio\/generations\/904\/image/);
  assert.match(String(serialized.data[1].latestGeneration?.imageUrl), /\/api\/miniprogram\/ai\/studio\/generations\/904\/image/);
  assert.equal(serialized.data[2].coverUrl, undefined);
});

test('serializePromptTemplatesForMini keeps HTTPS imported covers for WeChat', () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/prompt-templates');
  const serialized = serializePromptTemplatesForMini(request, '23', {
    revisionId: '1',
    items: [{
      id: '501',
      name: '原木奶油客厅',
      promptContent: 'cream living room',
      categorySourceId: 'living',
      bestModelSourceId: undefined,
      recommendedModelProfileId: undefined,
      parameterTemplateSourceId: undefined,
      adaptationModel: undefined,
      weight: 1,
      previewUrl: 'https://cdn.example.com/preview.jpg',
      localPreviewUrl: '/api/ai/creation/prompt-templates/501/preview',
    }],
    pagination: { page: 1, limit: 24, total: 1, totalPages: 1 },
  });
  assert.equal(serialized.items[0].previewUrl, 'https://cdn.example.com/preview.jpg');
});

test('serializePromptTemplatesForMini signs same-origin recipe covers for WeChat', () => {
  const request = new Request('http://192.168.10.111:3005/api/miniprogram/ai/studio/prompt-templates');
  const serialized = serializePromptTemplatesForMini(request, '23', {
    revisionId: '1',
    items: [{
      id: '501',
      name: '原木奶油客厅',
      promptContent: 'cream living room',
      categorySourceId: 'living',
      bestModelSourceId: undefined,
      recommendedModelProfileId: undefined,
      parameterTemplateSourceId: undefined,
      adaptationModel: undefined,
      weight: 1,
      previewUrl: '/api/ai/creation/prompt-templates/501/preview',
      localPreviewUrl: '/api/ai/creation/prompt-templates/501/preview',
    }],
    pagination: { page: 1, limit: 24, total: 1, totalPages: 1 },
  });
  const previewUrl = String(serialized.items[0].previewUrl || '');
  assert.match(previewUrl, /\/api\/miniprogram\/ai\/recipes\/501\/preview/);
  const parsed = new URL(previewUrl);
  assert.equal(verifyMiniAiRecipePreviewSignature({
    recipeId: '501',
    enterpriseId: '23',
    expires: Number(parsed.searchParams.get('expires')),
    signature: parsed.searchParams.get('signature') || '',
  }), true);
});
