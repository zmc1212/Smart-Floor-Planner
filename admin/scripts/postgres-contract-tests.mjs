import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
// Take only shared signing/encryption secrets from the developer env file.
// Loading the whole file would also apply provider, WeChat, search and assistant
// settings that legitimately change test behavior (for example the offered tool
// set or the Mini Program code endpoint). Suites that need those values load
// them explicitly.
const sharedTestSecrets = ['JWT_SECRET', 'INTERNAL_SECRET', 'CRON_SECRET',
  'MEDIA_STORAGE_KEY_ENCRYPTION_SECRET', 'AI_PROVIDER_KEY_ENCRYPTION_SECRET'];
try {
  const envFile = parseEnv(readFileSync(path.join(root, '.env.local'), 'utf8'));
  for (const key of sharedTestSecrets) {
    if (process.env[key] === undefined && envFile[key]) process.env[key] = envFile[key];
  }
} catch {
  // Suites that need no shared secret keep their development fallbacks.
}

// Several suites hold the isolated acceptance lock and fail closed when another
// run still has queued/running assistant jobs. Check that once up front instead
// of letting a busy shared clone produce dozens of confusing per-file failures.
async function assertIdleAcceptanceDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[preflight] DATABASE_URL is required for the PostgreSQL contract gate.');
    return false;
  }
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });
  try {
    await client.connect();
    await client.query('begin read only');
    try {
      await client.query("select set_config('app.is_platform_admin','true',true)");
      const { rows: [table] } = await client.query("select to_regclass('app.assistant_jobs') present");
      if (!table.present) return true;
      const { rows: [active] } = await client.query(
        "select count(*)::int active from app.assistant_jobs where status in ('queued','running')",
      );
      if (active.active > 0) {
        console.error(`[preflight] The isolated acceptance database still has ${active.active} queued/running assistant job(s). `
          + 'Stop the assistant worker and any concurrent acceptance run, wait for the queue to drain, then rerun the release gate.');
        return false;
      }
      const { rows: [lock] } = await client.query(
        "select pg_try_advisory_lock(hashtext('assistant_isolated_acceptance')) acquired",
      );
      if (!lock.acquired) {
        console.error('[preflight] Another assistant acceptance run holds the isolated database lock. '
          + 'Wait for it to finish, then rerun the release gate.');
        return false;
      }
      await client.query("select pg_advisory_unlock(hashtext('assistant_isolated_acceptance'))");
      return true;
    } finally {
      await client.query('rollback');
    }
  } finally {
    await client.end();
  }
}

try {
  if (!await assertIdleAcceptanceDatabase()) process.exit(1);
} catch (error) {
  console.error(`[preflight] Could not check the isolated acceptance database: ${error.message}`);
  console.error('[preflight] Check the loopback database and tunnel before retrying the contract tests.');
  process.exit(1);
}

if (process.argv.includes('--preflight')) {
  console.log('[preflight] Isolated acceptance database is idle and unlocked.');
  process.exit(0);
}

// These suites own a dedicated database (or an acceptance-only environment)
// and are executed by their own runners: construction-camera-check.mjs
// (`npm run test:camera`), the camera activity/capacity/cleanup acceptance
// scripts and the retention/operations acceptance scripts. Running them inside
// the shared knowledge clone fails their isolation guard.
const dedicatedAcceptanceSuites = new Set([
  'construction-camera.test.ts',
  'construction-camera-cover.test.ts',
  'construction-camera-customer.test.ts',
  'construction-camera-retention-defaults.test.ts',
  'construction-camera-sd.test.ts',
  'construction-camera-snapshot-retention.test.ts',
  'construction-recordings.test.ts',
  'construction-camera-activity.test.ts',
  'construction-camera-capacity.test.ts',
  'construction-camera-cleanup.test.ts',
  'construction-camera-coverage.test.ts',
  'construction-camera-snapshot-scope.test.ts',
  'assistant-retention.test.ts',
]);
const libTests = [
  'src/lib/__tests__/postgresql.test.ts',
  'src/lib/__tests__/lead-lifecycle.test.ts',
  'src/lib/__tests__/lead-conversion.test.ts',
  'src/lib/__tests__/lead-source.test.ts',
  'src/lib/__tests__/lead-staff-visibility.test.ts',
  'src/lib/__tests__/subscription-notification.test.ts',
  'src/lib/__tests__/referral-attribution.test.ts',
  'src/lib/__tests__/wechat-access-token.test.ts',
  'src/lib/__tests__/miniprogram-request-log.test.ts',
  'src/lib/__tests__/customer-phone.test.ts',
].filter(file => existsSync(path.join(root, file)));
const dbTests = readdirSync(path.join(root, 'src/db/__tests__'))
  .filter(file => file.endsWith('.test.ts') && !dedicatedAcceptanceSuites.has(file))
  .sort()
  .map(file => 'src/db/__tests__/' + file);
const targets = [...libTests, ...dbTests];
console.log(`Contract files: ${targets.length} (dedicated camera/retention suites run via their own runners)`);
// A single contract file drives dozens of synthetic runs for one enterprise in
// a few seconds. The production per-minute protection is not under test here and
// would otherwise fail closed halfway through a file.
const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...targets],
  { cwd: root, env: { ...process.env, ASSISTANT_REQUESTS_PER_MINUTE: process.env.ASSISTANT_REQUESTS_PER_MINUTE ?? '1000' }, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
