import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublishedSchemeFolioDto } from '@/lib/customer-project';

test('shared scheme folio exposes published schemes without owner PII', () => {
  const dto = buildPublishedSchemeFolioDto({
    leadId: '42',
    communityName: '阳光花园',
    customerName: '张三',
    customerPhone: '13800138000',
    publishedSchemes: [
      {
        id: 'wf-1',
        workflowId: 'wf-1',
        title: '现代简约',
        firstPublishedAt: new Date('2026-08-20T10:00:00.000Z'),
        publishedAt: new Date('2026-08-21T10:00:00.000Z'),
        finalized: true,
        images: [
          {
            id: 'pub-1',
            generationId: '9',
            type: 'image',
            stageKey: 'base_render',
            title: '全屋效果',
            publishedAt: new Date('2026-08-21T10:00:00.000Z'),
            imageUrl: 'https://cdn.example/scheme.png',
            imageEndpoint: '/miniprogram/customer-projects/42/published-generations/9/image',
          },
        ],
      },
    ],
  });

  assert.equal(dto.leadId, '42');
  assert.equal(dto.heroTitle, '阳光花园');
  assert.equal(dto.publishedSchemes[0]?.title, '现代简约');
  assert.equal(dto.publishedSchemes[0]?.images[0]?.imageUrl, 'https://cdn.example/scheme.png');
  assert.equal(dto.publishedSchemes[0]?.images[0]?.imageEndpoint, '');
  assert.equal('customerName' in dto, false);
  assert.equal('phone' in dto, false);
  assert.equal('designer' in dto, false);
  assert.equal('appointment' in dto, false);
  assert.equal('measurerPhone' in dto, false);
  assert.doesNotMatch(JSON.stringify(dto), /13800138000|张三/);
});

test('shared scheme folio falls back to the featured scheme title without a community', () => {
  const dto = buildPublishedSchemeFolioDto({
    leadId: '7',
    publishedSchemes: [
      {
        id: 'wf-2',
        workflowId: 'wf-2',
        title: '方案 1',
        firstPublishedAt: new Date('2026-08-20T10:00:00.000Z'),
        publishedAt: new Date('2026-08-20T10:00:00.000Z'),
        images: [],
      },
    ],
  });
  assert.equal(dto.heroTitle, '方案 1');
});
