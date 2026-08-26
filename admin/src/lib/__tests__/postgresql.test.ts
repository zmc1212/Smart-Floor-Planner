import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aiChatSessionSummaryToDto,
  aiChatSessionToDto,
  floorPlanToDto,
} from '@/db/postgres-dto';
import type { FloorPlanWithCreator } from '@/db/repositories';
import { resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { httpError, httpErrorStatus } from '@/lib/http-error';

test('floor plan DTO falls back to creator id when the users join is hidden', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const record = {
    id: 11n,
    enterpriseId: 7n,
    creatorId: 42n,
    staffId: null,
    name: '测试户型',
    layoutData: {
      version: 4,
      measurementMode: 'surveying',
      surveyGraph: { kind: 'survey-wall-graph' },
    },
    createIdempotencyKey: null,
    source: 'manual',
    externalSource: null,
    status: 'completed',
    completedAt: now,
    previewAssetId: null,
    previewRenderRevision: null,
    createdAt: now,
    updatedAt: now,
    creator: {
      id: null,
      nickname: null,
      avatar: null,
      openid: null,
      communityName: null,
      phone: null,
    },
  } as unknown as FloorPlanWithCreator;

  const dto = floorPlanToDto(record);
  assert.equal(dto.creator, '42');
  assert.doesNotThrow(() => JSON.stringify({ success: true, data: [dto] }));
});

test('floor plan DTO keeps a joined creator object with string ids', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const dto = floorPlanToDto({
    id: 11n,
    enterpriseId: 7n,
    creatorId: 42n,
    staffId: 23n,
    name: '测试户型',
    layoutData: {},
    createIdempotencyKey: null,
    source: 'manual',
    externalSource: null,
    status: 'completed',
    completedAt: now,
    previewAssetId: null,
    previewRenderRevision: null,
    createdAt: now,
    updatedAt: now,
    creator: {
      id: 42n,
      nickname: '量房顾问',
      avatar: null,
      openid: 'oid-42',
      communityName: null,
      phone: '13800138000',
    },
  });
  assert.deepEqual(dto.creator, {
    _id: '42',
    nickname: '量房顾问',
    avatar: null,
    openid: 'oid-42',
    communityName: null,
    phone: '13800138000',
  });
  assert.doesNotThrow(() => JSON.stringify({ success: true, data: dto }));
});

test('AI conversation DTOs serialize PostgreSQL bigint identifiers as strings', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const record = {
    id: 31n,
    enterpriseId: 41n,
    adminId: 51n,
    title: 'New conversation',
    messages: [{ role: 'assistant', content: 'Ready', createdAt: now }],
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  } as const;

  const summary = aiChatSessionSummaryToDto(record);
  const detail = aiChatSessionToDto(record);

  assert.equal(summary._id, '31');
  assert.equal(detail.id, '31');
  assert.equal(detail.enterpriseId, '41');
  assert.equal(detail.adminId, '51');
  assert.doesNotThrow(() => JSON.stringify({ success: true, data: detail }));
});

test('HTTP errors preserve intentional client status codes', () => {
  assert.equal(httpErrorStatus(httpError('Missing conversationId', 400), 500), 400);
  assert.equal(httpErrorStatus(httpError('Provider not found', 404), 502), 404);
  assert.equal(httpErrorStatus(new Error('upstream failure'), 502), 502);
});

const managedKeys = [
  'DATABASE_URL',
  'POSTGRES_APPLICATION_NAME',
  'POSTGRES_POOL_MAX',
  'POSTGRES_CONNECTION_TIMEOUT_MS',
  'POSTGRES_IDLE_TIMEOUT_MS',
  'POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS',
  'POSTGRES_STATEMENT_TIMEOUT_MS',
] as const;

function withEnvironment(
  values: Partial<Record<(typeof managedKeys)[number], string>>,
  callback: () => void
) {
  const original = Object.fromEntries(
    managedKeys.map((key) => [key, process.env[key]])
  );
  for (const key of managedKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const key of managedKeys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('PostgreSQL runtime configuration requires DATABASE_URL', () => {
  withEnvironment({}, () => {
    assert.throws(
      () => resolvePostgresRuntimeConfig(),
      /DATABASE_URL is required/
    );
  });
});

test('PostgreSQL runtime configuration uses bounded defaults', () => {
  withEnvironment(
    {
      DATABASE_URL:
        'postgresql://app:password@localhost:5432/smart_floor_planner',
    },
    () => {
      const config = resolvePostgresRuntimeConfig();
      assert.equal(config.applicationName, 'smart-floor-planner-admin');
      assert.equal(config.maxConnections, 10);
      assert.equal(config.connectionTimeoutMillis, 5_000);
      assert.equal(config.idleTimeoutMillis, 30_000);
      assert.equal(config.idleInTransactionSessionTimeoutMillis, 30_000);
      assert.equal(config.statementTimeoutMillis, 30_000);
    }
  );
});

test('PostgreSQL runtime configuration rejects unsafe pool sizes', () => {
  withEnvironment(
    {
      DATABASE_URL:
        'postgresql://app:password@localhost:5432/smart_floor_planner',
      POSTGRES_POOL_MAX: '200',
    },
    () => {
      assert.throws(
        () => resolvePostgresRuntimeConfig(),
        /POSTGRES_POOL_MAX must be an integer between 1 and 50/
      );
    }
  );
});

test('floor plan creator select keeps wechat openid outside the nested users object', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/db/repositories/floor-plan-repository.ts'),
    'utf8'
  );
  assert.match(source, /identityOpenid: wechatIdentities.openid/);
  assert.match(source, /openid: row.identityOpenid \|\| row.creator\?\.openid \|\| null/);
  assert.doesNotMatch(
    source,
    /coalesce\(\$\{wechatIdentities.openid\}, \$\{users.openid\}\)/
  );
});
