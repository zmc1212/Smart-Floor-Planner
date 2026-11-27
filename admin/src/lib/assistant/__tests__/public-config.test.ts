import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresTransaction } from '@/db/transaction';
import { readPublicAssistantScope } from '../application/public-scope';
import {
  DEFAULT_PUBLIC_ASSISTANT_CONFIG,
  normalizePublicAssistantConfig,
} from '../public-config';

test('public XiaoK config uses the safe defaults for missing or malformed values', () => {
  const config = normalizePublicAssistantConfig({
    enabled: 'yes',
    opening: '   ',
    prompts: [{ title: '只有标题', text: '' }, null, { title: '有效', text: '可以问装修吗？' }],
    version: 0,
  });
  assert.equal(config.enabled, DEFAULT_PUBLIC_ASSISTANT_CONFIG.enabled);
  assert.equal(config.enabled, false);
  assert.equal(config.opening, DEFAULT_PUBLIC_ASSISTANT_CONFIG.opening);
  assert.deepEqual(config.prompts, [{ title: '有效', text: '可以问装修吗？' }]);
  assert.equal(config.version, DEFAULT_PUBLIC_ASSISTANT_CONFIG.version);
});

test('public XiaoK topics are bounded to three short prompts', () => {
  const config = normalizePublicAssistantConfig({
    prompts: Array.from({ length: 5 }, (_, index) => ({ title: `标题${index}`, text: `问题${index}` })),
  });
  assert.equal(config.prompts.length, 3);
  assert.equal(config.prompts[0].title, '标题0');
});

test('a schema without the public mapping returns no scope without querying the missing table', async () => {
  const dialect = new PgDialect();
  const transaction = {
    execute: async (query: SQL) => {
      assert.match(dialect.sqlToQuery(query).sql, /to_regclass\('app\.assistant_public_agent_library'\)/);
      return { rows: [{ ready: false }] };
    },
  } as unknown as PostgresTransaction;

  assert.equal(await readPublicAssistantScope(transaction), null);
});
