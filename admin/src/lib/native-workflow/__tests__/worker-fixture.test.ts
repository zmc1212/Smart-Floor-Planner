import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseContextVersion,
  prepareWorkerUser,
  readWorkerContextVersion,
  type PrepareWorkerUserParams,
  type WorkerFixtureQueryClient,
} from '../live/worker-fixture';

const PARAMS: PrepareWorkerUserParams = {
  userId: '1454000008',
  enterpriseId: '1454',
  username: 'b5-5-worker-user-1454',
  nickname: '[B5.5] 施工工人',
  phone: '14500000008',
};

interface FakeUserRow {
  id: string;
  enterprise_id: string | null;
  username: string | null;
  nickname: string | null;
  role: string | null;
  phone: string | null;
  context_version: unknown;
}

function fixtureRow(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
  return {
    id: PARAMS.userId,
    enterprise_id: PARAMS.enterpriseId,
    username: PARAMS.username,
    nickname: PARAMS.nickname,
    role: 'user',
    phone: PARAMS.phone,
    context_version: 1,
    ...overrides,
  };
}

/** In-memory pg-like client. Only the four statements used by the helper are
 * implemented; anything else fails so a write cannot silently go unnoticed. */
class FakeClient implements WorkerFixtureQueryClient {
  readonly users = new Map<string, FakeUserRow>();
  readonly writes: string[] = [];

  constructor(initial?: FakeUserRow) {
    if (initial) this.users.set(initial.id, { ...initial });
  }

  async query<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith(
      'select id::text, enterprise_id::text, username, nickname, role, phone, context_version from app.users',
    )) {
      const row = this.users.get(String(params[0]));
      return { rows: row ? [{ ...row } as T] : [] };
    }

    if (sql.startsWith('insert into app.users')) {
      this.writes.push('insert');
      const [id, enterpriseId, username, nickname, phone] = params.map(String);
      const existing = this.users.get(id);
      if (existing) {
        existing.enterprise_id = enterpriseId;
        existing.username = username;
        existing.nickname = nickname;
        existing.role = 'user';
        existing.phone = phone;
      } else {
        this.users.set(id, {
          id,
          enterprise_id: enterpriseId,
          username,
          nickname,
          role: 'user',
          phone,
          context_version: 1,
        });
      }
      return { rows: [] };
    }

    if (sql.startsWith('update app.users set enterprise_id=')) {
      this.writes.push('update');
      const [id, enterpriseId, username, nickname, phone] = params.map(String);
      const row = this.users.get(id);
      if (!row) throw new Error(`fake update has no row ${id}`);
      row.enterprise_id = enterpriseId;
      row.username = username;
      row.nickname = nickname;
      row.role = 'user';
      row.phone = phone;
      return { rows: [] };
    }

    if (sql.startsWith('select id::text, context_version from app.users')) {
      const row = this.users.get(String(params[0]));
      return { rows: row ? [{ id: row.id, context_version: row.context_version } as T] : [] };
    }

    throw new Error(`unexpected SQL: ${sql}`);
  }
}

test('parseContextVersion only accepts positive integers', () => {
  assert.equal(parseContextVersion(1, 'v'), 1);
  assert.equal(parseContextVersion(2, 'v'), 2);
  assert.equal(parseContextVersion('3', 'v'), 3);
  for (const invalid of [0, -1, 1.5, '', '2.5', 'abc', null, undefined, true]) {
    assert.throws(
      () => parseContextVersion(invalid, 'context_version'),
      /context_version must be a positive integer/,
      `expected ${JSON.stringify(invalid)} to be rejected`,
    );
  }
});

test('an existing fixture user keeps context_version 2 across repeated prepares', async () => {
  const client = new FakeClient(fixtureRow({ context_version: 2 }));

  const first = await prepareWorkerUser(client, PARAMS);
  const second = await prepareWorkerUser(client, PARAMS);

  assert.deepEqual(first, { userId: PARAMS.userId, contextVersion: 2, mode: 'updated' });
  assert.deepEqual(second, { userId: PARAMS.userId, contextVersion: 2, mode: 'updated' });
  assert.equal(client.users.get(PARAMS.userId)?.context_version, 2);
  assert.equal(await readWorkerContextVersion(client, PARAMS.userId), 2);
});

test('a new fixture user is initialised with context_version 1', async () => {
  const client = new FakeClient();

  const prepared = await prepareWorkerUser(client, PARAMS);

  assert.deepEqual(prepared, { userId: PARAMS.userId, contextVersion: 1, mode: 'created' });
  assert.equal(client.users.get(PARAMS.userId)?.context_version, 1);
  assert.equal(await readWorkerContextVersion(client, PARAMS.userId), 1);
});

test('an existing row owned by another username fails without any write', async () => {
  const client = new FakeClient(fixtureRow({ username: 'some-other-user', context_version: 2 }));

  await assert.rejects(() => prepareWorkerUser(client, PARAMS), /already owned by/);

  assert.deepEqual(client.writes, []);
  const row = client.users.get(PARAMS.userId);
  assert.equal(row?.username, 'some-other-user');
  assert.equal(row?.context_version, 2);
});

test('an existing invalid context_version fails without a fallback write', async () => {
  for (const invalid of [0, null, 1.5, 'abc', undefined]) {
    const client = new FakeClient(fixtureRow({ context_version: invalid }));

    await assert.rejects(
      () => prepareWorkerUser(client, PARAMS),
      /context_version must be a positive integer/,
      `expected context_version=${JSON.stringify(invalid)} to fail`,
    );

    assert.deepEqual(client.writes, [], `no write for ${JSON.stringify(invalid)}`);
    assert.equal(
      client.users.get(PARAMS.userId)?.context_version,
      invalid,
      `version unchanged for ${JSON.stringify(invalid)}`,
    );
  }
});
