/** Development-only B5.5 worker identity fixture helpers.
 *
 * The B5.5 worker fixture owns exactly one base Mini Program user. Its
 * `context_version` belongs to the real identity lifecycle: an existing row
 * may legitimately carry a version higher than 1, so fixture setup may
 * initialise it to 1 for a brand-new row but must never lower it on update.
 *
 * These helpers are deliberately narrow and database-agnostic so the version
 * preservation rules can be tested offline with a fake pg-like client.
 */

export interface WorkerFixtureQueryClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface WorkerUserRow {
  id: string;
  enterprise_id: string | null;
  username: string | null;
  nickname: string | null;
  role: string | null;
  phone: string | null;
  context_version: unknown;
}

export interface PrepareWorkerUserParams {
  userId: string;
  enterpriseId: string;
  username: string;
  nickname: string;
  phone: string;
}

export interface PreparedWorkerUser {
  userId: string;
  contextVersion: number;
  mode: 'created' | 'updated';
}

/** Only a positive integer (>= 1) is a valid identity context version. */
export function parseContextVersion(value: unknown, label: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `${label} must be a positive integer (>=1); received ${JSON.stringify(value)}.`,
    );
  }
  return parsed;
}

const READ_USER_SQL = `select id::text, enterprise_id::text, username, nickname, role, phone, context_version
   from app.users where id=$1::bigint`;

const READ_VERSION_SQL = `select id::text, context_version from app.users where id=$1::bigint`;

export async function readWorkerContextVersion(
  client: WorkerFixtureQueryClient,
  userId: string,
  label = `app.users ${userId} context_version`,
): Promise<number> {
  const row = (await client.query<WorkerUserRow>(READ_VERSION_SQL, [userId])).rows[0];
  if (!row) {
    throw new Error(`${label}: app.users ${userId} does not exist.`);
  }
  return parseContextVersion(row.context_version, label);
}

/** Creates or refreshes the marked fixture user without ever lowering its
 * existing `context_version`. Ownership is proven by the fixture username; a
 * foreign row stops the fixture instead of being overwritten. */
export async function prepareWorkerUser(
  client: WorkerFixtureQueryClient,
  params: PrepareWorkerUserParams,
): Promise<PreparedWorkerUser> {
  const existing = (await client.query<WorkerUserRow>(READ_USER_SQL, [params.userId])).rows[0];

  let mode: PreparedWorkerUser['mode'];
  let expectedVersion: number;
  if (existing) {
    if (existing.username !== params.username) {
      throw new Error(
        `app.users ${params.userId} is already owned by ${JSON.stringify(existing.username)}; `
        + `refusing to overwrite it with the B5.5 marker ${JSON.stringify(params.username)}.`,
      );
    }
    expectedVersion = parseContextVersion(
      existing.context_version,
      `app.users ${params.userId} context_version`,
    );
    mode = 'updated';
    await client.query(
      `update app.users
          set enterprise_id=$2::bigint, username=$3, nickname=$4, role='user', phone=$5, updated_at=now()
        where id=$1::bigint`,
      [params.userId, params.enterpriseId, params.username, params.nickname, params.phone],
    );
  } else {
    expectedVersion = 1;
    mode = 'created';
    await client.query(
      `insert into app.users(id,enterprise_id,username,nickname,role,phone,context_version)
       overriding system value
       values($1::bigint,$2::bigint,$3,$4,'user',$5,1)
       on conflict(id) do update set enterprise_id=excluded.enterprise_id,username=excluded.username,
         nickname=excluded.nickname,role='user',phone=excluded.phone,updated_at=now()`,
      [params.userId, params.enterpriseId, params.username, params.nickname, params.phone],
    );
  }

  const readBack = (await client.query<WorkerUserRow>(READ_VERSION_SQL, [params.userId])).rows[0];
  if (!readBack) {
    throw new Error(`app.users ${params.userId} disappeared during the fixture write.`);
  }
  const contextVersion = parseContextVersion(
    readBack.context_version,
    `app.users ${params.userId} context_version after the fixture write`,
  );
  if (contextVersion !== expectedVersion) {
    throw new Error(
      `app.users ${params.userId} context_version changed from ${expectedVersion} to ${contextVersion} `
      + 'during the fixture write; refusing to continue.',
    );
  }
  return { userId: params.userId, contextVersion, mode };
}
