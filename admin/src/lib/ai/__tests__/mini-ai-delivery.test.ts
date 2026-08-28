import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMiniAiPublicRequestUrl,
  resolveMiniRecipePreviewUrl,
  verifyMiniAiAssetSignature,
  verifyMiniAiTaskResultSignature,
} from '@/lib/ai/mini-ai-assets';
import { serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';

function generation(overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(1071),
    enterpriseId: BigInt(23),
    operatorId: BigInt(45),
    floorPlanId: null,
    leadId: null,
    workflowId: null,
    type: 'miniprogram',
    channel: 'miniprogram',
    stageKey: 'base_render',
    nextRecommendedStage: 'soft_furnishing',
    input: { mode: 'style_transform', outputAspectRatio: '16:9' },
    output: {},
    status: 'succeeded',
    provider: 'grs',
    billing: { price: 10, status: 'charged' },
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    isSelectedBaseline: false,
    deletedAt: null,
    createdAt: new Date('2026-08-12T12:00:00.000Z'),
    updatedAt: new Date('2026-08-12T12:01:00.000Z'),
    ...overrides,
  };
}

test('placeholder public origins fall back to the real Mini Program API host', () => {
  const previous = process.env.MINIPROGRAM_API_PUBLIC_ORIGIN;
  try {
    process.env.MINIPROGRAM_API_PUBLIC_ORIGIN = 'https://api.example.com';
    assert.equal(
      getMiniAiPublicRequestUrl(new Request('http://192.168.10.111:3005/api/miniprogram/ai/tasks/1071')),
      'http://192.168.10.111:3005/api/miniprogram/ai/tasks/1071'
    );
    process.env.MINIPROGRAM_API_PUBLIC_ORIGIN = 'https://smartfloor.zlyun168.com';
    assert.equal(
      getMiniAiPublicRequestUrl(new Request('http://admin:3005/api/miniprogram/ai/tasks/1071')),
      'https://smartfloor.zlyun168.com/api/miniprogram/ai/tasks/1071'
    );
  } finally {
    if (previous === undefined) delete process.env.MINIPROGRAM_API_PUBLIC_ORIGIN;
    else process.env.MINIPROGRAM_API_PUBLIC_ORIGIN = previous;
  }
});

test('Mini Program task DTO signs protected input and result assets', () => {
  const dto = serializePostgresMiniAiTask(generation({
    input: {
      mode: 'reference_recreate',
      spaceImage: '/api/ai/assets/81/image',
      referenceImage: '/api/ai/assets/82/image',
      controlImage: '/api/ai/assets/83/image',
    },
    output: { imageUrl: '/api/ai/assets/91/image' },
  }) as never, new Request('http://192.168.10.111:3005/api/miniprogram/ai/tasks/1071'));

  for (const [value, assetId] of [
    [dto.spaceImageUrl, '81'],
    [dto.referenceImageUrl, '82'],
    [dto.controlImageUrl, '83'],
    [dto.resultImageUrl, '91'],
  ] as const) {
    const url = new URL(String(value));
    assert.equal(url.pathname, `/api/miniprogram/ai/assets/${assetId}/image`);
    assert.equal(url.searchParams.get('tenant'), '23');
    assert.equal(verifyMiniAiAssetSignature({
      assetId,
      enterpriseId: '23',
      expires: Number(url.searchParams.get('expires')),
      signature: String(url.searchParams.get('signature')),
    }), true);
  }
});

test('Mini Program task DTO proxies external provider results through a signed same-origin URL', () => {
  const dto = serializePostgresMiniAiTask(generation({
    output: { imageUrl: 'https://provider.example.com/generated/result.png?temporary=1' },
  }) as never, new Request('http://192.168.10.111:3005/api/miniprogram/ai/tasks/1071'));

  const url = new URL(String(dto.resultImageUrl));
  assert.equal(url.origin, 'http://192.168.10.111:3005');
  assert.equal(url.pathname, '/api/miniprogram/ai/tasks/1071/image');
  assert.equal(url.searchParams.get('tenant'), '23');
  assert.equal(verifyMiniAiTaskResultSignature({
    taskId: '1071',
    enterpriseId: '23',
    expires: Number(url.searchParams.get('expires')),
    signature: String(url.searchParams.get('signature')),
  }), true);
  assert.doesNotMatch(String(dto.resultImageUrl), /provider\.example\.com/);
});

test('task-result signatures cannot be reused as asset signatures', () => {
  const dto = serializePostgresMiniAiTask(generation({
    output: { imageUrl: 'https://provider.example.com/generated/result.png' },
  }) as never, new Request('https://smartfloor.example.com/api/miniprogram/ai/tasks/1071'));
  const url = new URL(String(dto.resultImageUrl));
  assert.equal(verifyMiniAiAssetSignature({
    assetId: '1071',
    enterpriseId: '23',
    expires: Number(url.searchParams.get('expires')),
    signature: String(url.searchParams.get('signature')),
  }), false);
});

test('Mini recipe covers keep HTTPS source URLs and sign same-origin fallbacks', () => {
  const request = new Request('http://192.168.10.111:3006/api/miniprogram/ai/recipes');
  assert.equal(
    resolveMiniRecipePreviewUrl({
      request,
      recipeId: '245',
      enterpriseId: '1169',
      previewUrl: 'https://roomi-1308701317.cos.ap-beijing.myqcloud.com/roomi-ai/cover.png',
      localPreviewUrl: '/api/ai/creation/prompt-templates/245/preview',
    }),
    'https://roomi-1308701317.cos.ap-beijing.myqcloud.com/roomi-ai/cover.png',
  );
  const signed = resolveMiniRecipePreviewUrl({
    request,
    recipeId: '245',
    enterpriseId: '1169',
    previewUrl: '/api/ai/creation/prompt-templates/245/preview',
    localPreviewUrl: '/api/ai/creation/prompt-templates/245/preview',
  });
  assert.match(String(signed), /\/api\/miniprogram\/ai\/recipes\/245\/preview/);
});
