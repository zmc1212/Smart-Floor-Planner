import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTables } from '../postgres-cleanup-dry-run.mjs';

test('cleanup dry-run classifies the current schema with explicit dispositions', () => {
  const classifications = classifyTables([
    'migration_checkpoints',
    'admin_users',
    'users',
    'wechat_identities',
    'media_assets',
    'leads',
  ]);

  assert.deepEqual(classifications, [
    { table: 'migration_checkpoints', disposition: 'retain' },
    { table: 'admin_users', disposition: 'split' },
    { table: 'users', disposition: 'split' },
    { table: 'wechat_identities', disposition: 'split' },
    { table: 'media_assets', disposition: 'delete' },
    { table: 'leads', disposition: 'delete' },
  ]);
});

test('cleanup dry-run refuses an unclassified table', () => {
  assert.throws(
    () => classifyTables(['future_business_table']),
    /Unclassified app tables require an approved cleanup classification/
  );
});
