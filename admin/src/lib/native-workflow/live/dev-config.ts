/** Development-database isolation for the B4 native-workflow live scripts.
 *
 * Pure Node: this module only parses environment variables and never opens a
 * connection. The live scripts must opt into development explicitly and must
 * point at the isolated B database on 127.0.0.1:55433. There is deliberately
 * no default URL and no fallback to `DATABASE_URL`.
 */

export type B4LiveDatabasePurpose = 'app' | 'fixture';

/** Kept as an alias for the existing live runner call sites. */
export type B4LiveDatabaseRole = B4LiveDatabasePurpose;

/** The resolver only reads string values; this also keeps tests free of NODE_ENV. */
export type B4Environment = Readonly<Record<string, string | undefined>>;

export interface B4LiveDatabaseTarget {
  url: string;
  host: string;
  port: string;
  database: string;
  username: string;
  purpose: B4LiveDatabasePurpose;
}

export class B4ConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'B4ConfigError';
    this.code = code;
  }
}

const ENV_KEY: Record<B4LiveDatabasePurpose, string> = {
  app: 'B4_LIVE_APP_DATABASE_URL',
  fixture: 'B4_LIVE_FIXTURE_DATABASE_URL',
};

const EXPECTED_USERNAME: Record<B4LiveDatabasePurpose, string> = {
  app: 'sfp_app',
  fixture: 'sfp_owner',
};

const EXPECTED_PORT = '55433';
const EXPECTED_DATABASE = 'smart_floor_planner';

function decode(value: string, envKey: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new B4ConfigError(`${envKey}.${field}`, `${envKey} ${field} is not valid percent-encoding.`);
  }
}

function assertDevelopmentEntry(argv: readonly string[], env: B4Environment): void {
  if (env.NODE_ENV === 'production') {
    throw new B4ConfigError('production', 'Refusing to run with NODE_ENV=production.');
  }
  if (!argv.includes('--development') && env.B4_LIVE_DEVELOPMENT !== '1') {
    throw new B4ConfigError(
      'development-flag',
      'Refusing to run: pass --development or set B4_LIVE_DEVELOPMENT=1.',
    );
  }
}

export function assertB4DevelopmentEntry(options: {
  argv?: readonly string[];
  env?: B4Environment;
} = {}): void {
  assertDevelopmentEntry(options.argv ?? process.argv, options.env ?? process.env);
}

export function resolveB4DatabaseTarget(options: {
  purpose: B4LiveDatabasePurpose;
  env?: B4Environment;
  argv?: readonly string[];
}): B4LiveDatabaseTarget {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  assertDevelopmentEntry(argv, env);

  const envKey = ENV_KEY[options.purpose];
  const raw = env[envKey];
  if (raw === undefined || raw.trim() === '') {
    throw new B4ConfigError(
      `${envKey}.missing`,
      `${envKey} is required for purpose ${options.purpose}; there is no DATABASE_URL fallback.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new B4ConfigError(`${envKey}.url`, `${envKey} must be a valid URL.`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new B4ConfigError(
      `${envKey}.protocol`,
      `${envKey} protocol must be postgres: or postgresql: (got ${parsed.protocol}).`,
    );
  }

  // No whitelist: any extra connection parameter or fragment is rejected, so
  // the exact URL handed to pg cannot silently override host/port/user/db.
  if (parsed.search !== '') {
    throw new B4ConfigError(
      `${envKey}.query`,
      `${envKey} must not contain a query string (got ${parsed.search}).`,
    );
  }
  if (parsed.hash !== '') {
    throw new B4ConfigError(
      `${envKey}.hash`,
      `${envKey} must not contain a URL fragment (got ${parsed.hash}).`,
    );
  }

  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new B4ConfigError(
      `${envKey}.host`,
      `${envKey} host must be 127.0.0.1 or localhost (got ${host || '(missing)'}).`,
    );
  }

  if (parsed.port === '') {
    throw new B4ConfigError(
      `${envKey}.port.missing`,
      `${envKey} must include an explicit port ${EXPECTED_PORT}.`,
    );
  }
  if (parsed.port !== EXPECTED_PORT) {
    throw new B4ConfigError(
      `${envKey}.port`,
      `${envKey} port must be ${EXPECTED_PORT} (got ${parsed.port}).`,
    );
  }

  const database = decode(parsed.pathname.replace(/^\//, ''), envKey, 'database');
  if (database !== EXPECTED_DATABASE) {
    throw new B4ConfigError(
      `${envKey}.database`,
      `${envKey} database must be ${EXPECTED_DATABASE} (got ${database || '(missing)'}).`,
    );
  }

  const username = decode(parsed.username, envKey, 'username');
  const expectedUsername = EXPECTED_USERNAME[options.purpose];
  if (username !== expectedUsername) {
    throw new B4ConfigError(
      `${envKey}.username`,
      `${envKey} username must be ${expectedUsername} for purpose ${options.purpose} (got ${username || '(missing)'}).`,
    );
  }

  if (host === 'localhost') parsed.hostname = '127.0.0.1';

  return {
    url: parsed.toString(),
    host: '127.0.0.1',
    port: parsed.port,
    database,
    username,
    purpose: options.purpose,
  };
}

/** Compatibility wrapper used by the existing live runner call site. */
export function resolveB4LiveDatabaseTarget(options: {
  role: B4LiveDatabaseRole;
  env?: B4Environment;
  argv?: readonly string[];
}): B4LiveDatabaseTarget {
  return resolveB4DatabaseTarget({
    purpose: options.role,
    env: options.env,
    argv: options.argv,
  });
}

/**
 * Runtime identity check: the verified target, the logged target and the
 * connection pg actually opened must agree. Host and port are guaranteed by
 * rejecting query parameters and passing `target.url` to pg unchanged, so the
 * server-side `current_database()` / `current_user` are the remaining proof.
 */
export function assertB4ConnectionIdentity(
  target: B4LiveDatabaseTarget,
  actual: { database: string; username: string },
): void {
  if (actual.database !== target.database || actual.username !== target.username) {
    throw new B4ConfigError(
      'b4_database_identity_mismatch',
      `Connected identity does not match the verified target: expected database=${target.database} username=${target.username}, `
        + `got database=${actual.database || '(missing)'} username=${actual.username || '(missing)'}.`,
    );
  }
}

/** Password-free description for logs: host:port/database/purpose/username. */
export function describeB4DatabaseTarget(target: B4LiveDatabaseTarget): string {
  return `purpose=${target.purpose} host=${target.host}:${target.port} database=${target.database} username=${target.username}`;
}
