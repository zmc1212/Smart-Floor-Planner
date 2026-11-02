import assert from 'node:assert/strict';
import test from 'node:test';
import { originalFileAllowed } from '../knowledge/file-service';
import type { SourceFile, FileLocator } from '../contracts/source-file';

const file: SourceFile = { version: 1, assetId: '12', hash: 'reviewed-file-hash', name: '工艺.pdf', format: 'pdf',
  parsed: { parser: 'pdf-v1', warnings: [], blocks: [{ id: 'p1', kind: 'paragraph', text: '公开工艺', section: [], page: 1 },
    { id: 'p2', kind: 'paragraph', text: '内部联系方式', section: [], page: 2 }] },
  review: { adminId: '18', at: '2026-11-02T00:00:00Z', excluded: [] } };
const locator: FileLocator = { assetId: '12', sourceHash: file.hash, name: file.name, format: 'pdf', parser: 'pdf-v1',
  blockId: 'p1', kind: 'paragraph', section: [], page: 1, label: 'PDF第1页' };
test('a published excerpt cannot disclose an original containing an excluded private page', () => {
  assert.equal(originalFileAllowed(file, locator), true);
  assert.equal(originalFileAllowed({ ...file, review: { ...file.review!, excluded: ['p2'] } }, locator), false);
  assert.equal(originalFileAllowed({ ...file, review: null }, locator), false);
  assert.equal(originalFileAllowed(null, locator), false);
});
test('a current excerpt locator cannot be reused to download another or replaced file', () => {
  for (const changed of [{ assetId: '13' }, { hash: 'replacement' }, { name: '内部.xlsx' }, { format: 'xlsx' as const }])
    assert.equal(originalFileAllowed({ ...file, ...changed }, locator), false);
});
