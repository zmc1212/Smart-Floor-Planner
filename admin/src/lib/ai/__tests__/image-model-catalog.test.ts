import assert from 'node:assert/strict';
import test from 'node:test';
import { sortWorkbenchImageModels } from '@/lib/ai/image-model-catalog';

test('workbench image models sort isDefault first then weight', () => {
  const sorted = sortWorkbenchImageModels([
    { key: 'heavy', isDefault: false, weight: 90, name: 'Heavy' },
    { key: 'default', isDefault: true, weight: 1, name: 'Default' },
    { key: 'alpha', isDefault: false, weight: 90, name: 'Alpha' },
  ]);
  assert.deepEqual(sorted.map((item) => item.key), ['default', 'alpha', 'heavy']);
});
