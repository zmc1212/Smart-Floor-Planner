import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import { B4ConfigError, resolveB4DatabaseTarget } from '../live/dev-config';
import {
  SHARED_FIXTURE,
  SHARED_FIXTURE_ADMINS,
  SHARED_FIXTURE_CUSTOMER_USERNAME,
  assertSharedFixtureOwned,
  runOwnedCleanup,
  runSharedFixturePreflight,
  type SharedFixtureEvidence,
  type SharedFixtureQueryClient,
} from '../live/fixture-ownership';

const APP_URL = 'postgresql://sfp_app:sfp_app_local_only@127.0.0.1:55433/smart_floor_planner';

type TestEnv = Record<string, string | undefined>;

interface EvidenceOverrides {
  enterpriseCode?: string;
  enterpriseName?: string;
  adminUsername?: string;
  customerUsername?: string;
  projectName?: string;
  conversationTitle?: string;
}

function validEvidence(overrides: EvidenceOverrides = {}): SharedFixtureEvidence {
  return {
    enterprise: {
      id: SHARED_FIXTURE.enterpriseId,
      code: overrides.enterpriseCode ?? SHARED_FIXTURE.enterpriseCode,
      name: overrides.enterpriseName ?? `${SHARED_FIXTURE.namePrefix} 微云原生编排测试`,
    },
    admins: SHARED_FIXTURE_ADMINS.map((admin, index) => ({
      id: admin.id,
      username: index === 0 ? (overrides.adminUsername ?? admin.username) : admin.username,
      enterpriseId: SHARED_FIXTURE.enterpriseId,
      status: 'active',
    })),
    customer: {
      id: SHARED_FIXTURE.customerUserId,
      username: overrides.customerUsername ?? SHARED_FIXTURE_CUSTOMER_USERNAME,
      enterpriseId: SHARED_FIXTURE.enterpriseId,
    },
    project: {
      id: SHARED_FIXTURE.mainProjectId,
      name: overrides.projectName ?? `${SHARED_FIXTURE.namePrefix} 水路阶段测试项目`,
    },
    conversation: {
      id: SHARED_FIXTURE.mainConversationId,
      title: overrides.conversationTitle ?? `${SHARED_FIXTURE.namePrefix} 水路阶段提醒测试会话`,
    },
  };
}

function fakeClient(evidence: SharedFixtureEvidence): {
  client: SharedFixtureQueryClient;
  queries: string[];
} {
  const queries: string[] = [];
  return {
    queries,
    client: {
      async query(text: string) {
        queries.push(text);
        return { rows: [evidence as unknown as Record<string, unknown>] };
      },
    },
  };
}

/** The resolver must reject before the harness would open a connection. */
function resolveWithConnectionCounter(env: TestEnv): { error: unknown; connections: number } {
  let connections = 0;
  const connect = () => {
    connections += 1;
  };
  try {
    resolveB4DatabaseTarget({ purpose: 'app', env, argv: [] });
    connect();
    return { error: null, connections };
  } catch (error) {
    return { error, connections };
  }
}

test('missing B4_LIVE_DEVELOPMENT rejects before any connection', () => {
  const result = resolveWithConnectionCounter({ B4_LIVE_APP_DATABASE_URL: APP_URL });
  assert.ok(result.error instanceof B4ConfigError);
  assert.equal(result.error.code, 'development-flag');
  assert.equal(result.connections, 0);
});

test('B4_LIVE_DEVELOPMENT=0 rejects before any connection', () => {
  const result = resolveWithConnectionCounter({
    B4_LIVE_APP_DATABASE_URL: APP_URL,
    B4_LIVE_DEVELOPMENT: '0',
  });
  assert.ok(result.error instanceof B4ConfigError);
  assert.equal(result.error.code, 'development-flag');
  assert.equal(result.connections, 0);
});

test('NODE_ENV=production rejects before any connection even with the opt-in', () => {
  const result = resolveWithConnectionCounter({
    B4_LIVE_APP_DATABASE_URL: APP_URL,
    B4_LIVE_DEVELOPMENT: '1',
    NODE_ENV: 'production',
  });
  assert.ok(result.error instanceof B4ConfigError);
  assert.equal(result.error.code, 'production');
  assert.equal(result.connections, 0);
});

test('the documented shared fixture markers pass the pure ownership check', () => {
  assert.doesNotThrow(() => assertSharedFixtureOwned(validEvidence(), 'guards shared fixture'));
});

test('a foreign shared fixture marker fails the read-only preflight with zero writes', async () => {
  const variants: Array<{ label: string; evidence: SharedFixtureEvidence }> = [
    { label: 'enterprise code', evidence: validEvidence({ enterpriseCode: 'FOREIGN-ENTERPRISE' }) },
    { label: 'enterprise name', evidence: validEvidence({ enterpriseName: 'Foreign Enterprise' }) },
    { label: 'admin username', evidence: validEvidence({ adminUsername: 'someone-else' }) },
    { label: 'customer username', evidence: validEvidence({ customerUsername: 'someone-else' }) },
    { label: 'project name', evidence: validEvidence({ projectName: 'Foreign Project' }) },
    { label: 'conversation title', evidence: validEvidence({ conversationTitle: 'Foreign Conversation' }) },
  ];

  for (const variant of variants) {
    const { client, queries } = fakeClient(variant.evidence);
    await assert.rejects(
      () => runSharedFixturePreflight(client, `guards ${variant.label}`),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'fixture_ownership_conflict',
      `shared fixture ${variant.label} must be rejected`,
    );
    assert.equal(queries.length, 1, 'the preflight must run exactly one statement');
    assert.match(queries[0], /^\s*select\b/i, 'the preflight must be read-only');
    assert.equal(
      queries.filter((query) => /\b(insert|update|delete|truncate|alter|drop)\b/i.test(query)).length,
      0,
      'a failed preflight must not write',
    );
  }
});

test('a failed preflight leaves the after hook with zero deletes', async () => {
  const { client } = fakeClient(validEvidence({ enterpriseCode: 'FOREIGN-ENTERPRISE' }));
  let preflightOk = true;
  try {
    await runSharedFixturePreflight(client, 'guards after hook');
  } catch {
    preflightOk = false;
  }
  assert.equal(preflightOk, false, 'the foreign fixture must fail the preflight');

  let deletes = 0;
  const ran = await runOwnedCleanup(preflightOk, true, async () => {
    deletes += 1;
  });
  assert.equal(ran, false);
  assert.equal(deletes, 0, 'a failed preflight must not delete anything');
});
