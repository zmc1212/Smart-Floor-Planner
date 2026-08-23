import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_ACTION_KEYS } from '@/lib/ai/provider-types';
import { normalizePlatformCreditAmount, selectPlatformCreditPriceUpdates, serializeAiCreditPrice } from '@/lib/ai/credits';
import { catalogResolutionTiersForPrice, selectCatalogImageModelPrices } from '@/lib/ai/image-model-catalog';
import {
  clonePriceRows,
  creditPriceFormHasChanges,
  creditPriceSaveDisabled,
} from '@/lib/ai/credit-price-form';

test('credit-price save enables after cloning server rows so a model toggle is dirty', () => {
  const loaded = [
    { modelProfileKey: 'grs-nano-banana-2', resolutionTier: '1K', credits: 10, enabled: false },
  ];
  const items = clonePriceRows([]);
  const savedItems = clonePriceRows([]);
  const modelPrices = clonePriceRows(loaded);
  const savedModelPrices = clonePriceRows(loaded);
  assert.equal(creditPriceFormHasChanges(items, savedItems, modelPrices, savedModelPrices), false);
  const edited = modelPrices.map((item) => (
    item.modelProfileKey === 'grs-nano-banana-2' ? { ...item, enabled: true } : item
  ));
  loaded[0].enabled = true;
  assert.equal(creditPriceFormHasChanges(items, savedItems, edited, savedModelPrices), true);
  assert.equal(creditPriceFormHasChanges(
    [{ actionKey: 'image.free_create', credits: 10, enabled: 1 }],
    [{ actionKey: 'image.free_create', credits: 10, enabled: true }],
    savedModelPrices,
    savedModelPrices,
  ), false);
  assert.equal(creditPriceSaveDisabled({ hasRows: edited.length > 0, hasChanges: true }), false);
  assert.equal(creditPriceSaveDisabled({
    hasRows: false,
    hasChanges: true,
  }), true);
});

test('credit-price saves drop leftover non-platform action keys instead of rejecting the whole payload', () => {
  const selected = selectPlatformCreditPriceUpdates([
    { actionKey: 'image.free_create', credits: 10, enabled: true },
    { actionKey: 'phase2-123.price', credits: 18, enabled: true },
    { actionKey: 'text.design_advice', credits: 1, enabled: true },
  ]);
  assert.deepEqual(selected.map((item) => item.actionKey), ['image.free_create', 'text.design_advice']);
  assert.ok(selected.every((item) => AI_ACTION_KEYS.includes(item.actionKey)));
});

test('image-model price saves drop leftover non-catalog model keys instead of rejecting the whole payload', () => {
  const selected = selectCatalogImageModelPrices(
    [
      { modelProfileKey: 'grs-gpt-image-2', resolutionTier: '1K', credits: 10, enabled: true },
      { modelProfileKey: 'phase2-123.model', resolutionTier: '1K', credits: 25, enabled: true },
      { modelProfileKey: 'grs-nano-banana-2', resolutionTier: '1K', credits: 10, enabled: true },
    ],
    ['grs-gpt-image-2', 'grs-nano-banana-2']
  );
  assert.deepEqual(
    selected.map((item) => item.modelProfileKey),
    ['grs-gpt-image-2', 'grs-nano-banana-2']
  );
});

test('credit-price list DTO JSON-serializes postgres bigint updatedBy after a save', () => {
  const dto = serializeAiCreditPrice({
    id: BigInt(42),
    actionKey: 'image.free_create',
    mode: null,
    label: 'AI 自由创作',
    credits: BigInt(10),
    enabled: true,
    updatedBy: BigInt(7),
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
  });
  assert.equal(dto._id, '42');
  assert.equal(dto.credits, 10);
  assert.equal(dto.enabled, true);
  assert.doesNotThrow(() => JSON.stringify(dto));
  assert.equal(JSON.parse(JSON.stringify(dto)).credits, 10);
});

test('credit-price saves clamp empty or out-of-range points instead of rejecting the whole form', () => {
  assert.equal(normalizePlatformCreditAmount(''), 1);
  assert.equal(normalizePlatformCreditAmount(0), 1);
  assert.equal(normalizePlatformCreditAmount(null), 1);
  assert.equal(normalizePlatformCreditAmount(10), 10);
  assert.equal(normalizePlatformCreditAmount(100001), 100000);
});

test('image-model price saves accept Map keys and fall back to the GRS catalog for resolution tiers', () => {
  const selected = selectCatalogImageModelPrices(
    [
      { modelProfileKey: 'grs-nano-banana-2', resolutionTier: '1K', credits: 10, enabled: true },
      { modelProfileKey: 'phase2-123.model', resolutionTier: '1K', credits: 25, enabled: true },
    ],
    new Map([['grs-nano-banana-2', true], ['grs-gpt-image-2', true]]).keys()
  );
  assert.deepEqual(selected.map((item) => item.modelProfileKey), ['grs-nano-banana-2']);
  assert.deepEqual(
    catalogResolutionTiersForPrice({ remoteModel: 'nano-banana-2', capabilities: {} }),
    ['1K', '2K', '4K']
  );
  assert.ok(catalogResolutionTiersForPrice({
    remoteModel: 'nano-banana-2',
    capabilities: { resolutionTiers: ['1K', '2K', '4K'] },
  }).includes('1K'));
});
