import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertB4ConnectionIdentity,
  assertB4DevelopmentEntry,
  B4ConfigError,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
  resolveB4LiveDatabaseTarget,
} from '../live/dev-config';

const APP_URL = 'postgresql://sfp_app:sfp_app_local_only@127.0.0.1:55433/smart_floor_planner';
const FIXTURE_URL = 'postgresql://sfp_owner:sfp_owner_local_only@127.0.0.1:55433/smart_floor_planner';
const DEVELOPMENT = ['--development'];

type TestEnv = Record<string, string | undefined>;

function appEnv(overrides: TestEnv = {}): TestEnv {
  return { B4_LIVE_APP_DATABASE_URL: APP_URL, ...overrides };
}

function fixtureEnv(overrides: TestEnv = {}): TestEnv {
  return { B4_LIVE_FIXTURE_DATABASE_URL: FIXTURE_URL, ...overrides };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof B4ConfigError, `expected B4ConfigError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected the resolver to throw');
}

test('resolves the valid app target and normalizes localhost', () => {
  const target = resolveB4DatabaseTarget({
    purpose: 'app',
    argv: DEVELOPMENT,
    env: appEnv({ B4_LIVE_APP_DATABASE_URL: APP_URL.replace('127.0.0.1', 'localhost') }),
  });
  assert.deepEqual(target, {
    url: APP_URL,
    host: '127.0.0.1',
    port: '55433',
    database: 'smart_floor_planner',
    username: 'sfp_app',
    purpose: 'app',
  });
});

test('resolves the valid fixture target', () => {
  const target = resolveB4DatabaseTarget({ purpose: 'fixture', argv: DEVELOPMENT, env: fixtureEnv() });
  assert.equal(target.username, 'sfp_owner');
  assert.equal(target.purpose, 'fixture');
  assert.equal(target.url, FIXTURE_URL);
});

test('keeps the legacy role wrapper aligned with purpose resolution', () => {
  const target = resolveB4LiveDatabaseTarget({ role: 'app', argv: DEVELOPMENT, env: appEnv() });
  assert.equal(target.purpose, 'app');
  assert.equal(target.username, 'sfp_app');
});

test('requires the purpose-specific environment variable', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({ purpose: 'app', argv: DEVELOPMENT, env: {} })),
    'B4_LIVE_APP_DATABASE_URL.missing',
  );
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({ purpose: 'fixture', argv: DEVELOPMENT, env: {} })),
    'B4_LIVE_FIXTURE_DATABASE_URL.missing',
  );
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: { B4_LIVE_APP_DATABASE_URL: '   ' },
    })),
    'B4_LIVE_APP_DATABASE_URL.missing',
  );
});

test('never falls back to DATABASE_URL', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({ purpose: 'app', argv: DEVELOPMENT, env: { DATABASE_URL: APP_URL } })),
    'B4_LIVE_APP_DATABASE_URL.missing',
  );
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'fixture',
      argv: DEVELOPMENT,
      env: { DATABASE_URL: FIXTURE_URL },
    })),
    'B4_LIVE_FIXTURE_DATABASE_URL.missing',
  );
});

test('rejects a missing port', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: appEnv({ B4_LIVE_APP_DATABASE_URL: 'postgresql://sfp_app:pw@127.0.0.1/smart_floor_planner' }),
    })),
    'B4_LIVE_APP_DATABASE_URL.port.missing',
  );
});

test('rejects a wrong host', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: appEnv({ B4_LIVE_APP_DATABASE_URL: 'postgresql://sfp_app:pw@db.example.com:55433/smart_floor_planner' }),
    })),
    'B4_LIVE_APP_DATABASE_URL.host',
  );
});

test('rejects a wrong port including 5432', () => {
  for (const port of ['5432', '55432']) {
    assert.equal(
      codeOf(() => resolveB4DatabaseTarget({
        purpose: 'app',
        argv: DEVELOPMENT,
        env: appEnv({ B4_LIVE_APP_DATABASE_URL: `postgresql://sfp_app:pw@127.0.0.1:${port}/smart_floor_planner` }),
      })),
      'B4_LIVE_APP_DATABASE_URL.port',
    );
  }
});

test('rejects a wrong database', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'fixture',
      argv: DEVELOPMENT,
      env: fixtureEnv({ B4_LIVE_FIXTURE_DATABASE_URL: 'postgresql://sfp_owner:pw@127.0.0.1:55433/postgres' }),
    })),
    'B4_LIVE_FIXTURE_DATABASE_URL.database',
  );
});

test('rejects a wrong username for the purpose', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: appEnv({ B4_LIVE_APP_DATABASE_URL: FIXTURE_URL }),
    })),
    'B4_LIVE_APP_DATABASE_URL.username',
  );
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'fixture',
      argv: DEVELOPMENT,
      env: fixtureEnv({ B4_LIVE_FIXTURE_DATABASE_URL: APP_URL }),
    })),
    'B4_LIVE_FIXTURE_DATABASE_URL.username',
  );
});

test('rejects a malformed URL and a non-postgres protocol', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: appEnv({ B4_LIVE_APP_DATABASE_URL: 'not a url' }),
    })),
    'B4_LIVE_APP_DATABASE_URL.url',
  );
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: appEnv({ B4_LIVE_APP_DATABASE_URL: 'mysql://sfp_app:pw@127.0.0.1:55433/smart_floor_planner' }),
    })),
    'B4_LIVE_APP_DATABASE_URL.protocol',
  );
});

test('refuses production before reading the environment', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: appEnv({ NODE_ENV: 'production' }),
    })),
    'production',
  );
  assert.equal(
    codeOf(() => assertB4DevelopmentEntry({ argv: DEVELOPMENT, env: { NODE_ENV: 'production' } })),
    'production',
  );
});

test('requires the development flag or environment opt-in', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({ purpose: 'app', argv: [], env: appEnv() })),
    'development-flag',
  );
  assert.equal(codeOf(() => assertB4DevelopmentEntry({ argv: [], env: {} })), 'development-flag');
  assert.equal(
    codeOf(() => assertB4DevelopmentEntry({ argv: [], env: { B4_LIVE_DEVELOPMENT: '0' } })),
    'development-flag',
  );
  assert.doesNotThrow(() => assertB4DevelopmentEntry({ argv: DEVELOPMENT, env: {} }));
  assert.doesNotThrow(() => assertB4DevelopmentEntry({ argv: [], env: { B4_LIVE_DEVELOPMENT: '1' } }));
  assert.doesNotThrow(() => resolveB4DatabaseTarget({
    purpose: 'app',
    argv: [],
    env: { ...appEnv(), B4_LIVE_DEVELOPMENT: '1' },
  }));
});

test('describes a target without leaking the password', () => {
  const target = resolveB4DatabaseTarget({ purpose: 'fixture', argv: DEVELOPMENT, env: fixtureEnv() });
  const described = describeB4DatabaseTarget(target);
  assert.equal(described, 'purpose=fixture host=127.0.0.1:55433 database=smart_floor_planner username=sfp_owner');
  assert.equal(described.includes('sfp_owner_local_only'), false);
  assert.equal(described.includes('@'), false);
});

test('a valid target carries no query string or fragment', () => {
  const target = resolveB4DatabaseTarget({ purpose: 'fixture', argv: DEVELOPMENT, env: fixtureEnv() });
  const parsed = new URL(target.url);
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
  assert.equal(target.url, FIXTURE_URL);
});

test('rejects any query string, including overrides and duplicates', () => {
  for (const query of ['?host=evil.example', '?port=5432', '?user=sfp_owner', '?host=a&host=b', '?h%6fst=evil']) {
    assert.equal(
      codeOf(() => resolveB4DatabaseTarget({
        purpose: 'app',
        argv: DEVELOPMENT,
        env: appEnv({ B4_LIVE_APP_DATABASE_URL: `${APP_URL}${query}` }),
      })),
      'B4_LIVE_APP_DATABASE_URL.query',
      `query ${query} must be rejected`,
    );
  }
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'fixture',
      argv: DEVELOPMENT,
      env: fixtureEnv({ B4_LIVE_FIXTURE_DATABASE_URL: `${FIXTURE_URL}?user=sfp_app` }),
    })),
    'B4_LIVE_FIXTURE_DATABASE_URL.query',
  );
});

test('rejects a URL fragment', () => {
  assert.equal(
    codeOf(() => resolveB4DatabaseTarget({
      purpose: 'app',
      argv: DEVELOPMENT,
      env: appEnv({ B4_LIVE_APP_DATABASE_URL: `${APP_URL}#hash` }),
    })),
    'B4_LIVE_APP_DATABASE_URL.hash',
  );
});

test('connection identity must match the verified target', () => {
  const target = resolveB4DatabaseTarget({ purpose: 'fixture', argv: DEVELOPMENT, env: fixtureEnv() });
  assert.doesNotThrow(() => assertB4ConnectionIdentity(target, {
    database: 'smart_floor_planner',
    username: 'sfp_owner',
  }));

  for (const actual of [
    { database: 'postgres', username: 'sfp_owner' },
    { database: 'smart_floor_planner', username: 'sfp_app' },
  ]) {
    assert.throws(
      () => assertB4ConnectionIdentity(target, actual),
      (error: unknown) => error instanceof B4ConfigError && error.code === 'b4_database_identity_mismatch',
      `identity ${JSON.stringify(actual)} must be rejected`,
    );
  }
});
