import crypto from 'node:crypto';
import pg from 'pg';

// Keep the file portable: a production container normally provides its
// environment through Docker, while a checkout can still use its local .env
// files when @next/env is installed. An uploaded single-file copy does not
// require this optional project dependency.
try {
  const nextEnv = await import('@next/env');
  const loadEnvConfig = nextEnv.loadEnvConfig || nextEnv.default?.loadEnvConfig;
  loadEnvConfig?.(process.cwd());
} catch {
  // Process environment variables remain the source of truth when the
  // optional Next.js helper is unavailable.
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--') || arg === '-h'));
const kind = valueAfter('--kind') || 'all';
const enterpriseId = valueAfter('--enterprise-id');
const apply = flags.has('--apply');
const rotateAll = flags.has('--rotate-all');

if (!['all', 'staff', 'promotion'].includes(kind)) {
  fail('`--kind` must be one of: all, staff, promotion');
}
if (enterpriseId !== undefined && !/^[1-9]\d*$/.test(enterpriseId)) {
  fail('`--enterprise-id` must be a positive PostgreSQL bigint');
}
if (flags.has('--dry-run') && apply) {
  fail('`--dry-run` and `--apply` cannot be used together');
}
if (flags.has('--help') || flags.has('-h')) {
  printUsage();
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) fail('DATABASE_URL is required');

const configuredSecret = process.env.REFERRER_TOKEN_SECRET || process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && (!configuredSecret || Buffer.byteLength(configuredSecret, 'utf8') < 16)) {
  fail('REFERRER_TOKEN_SECRET or JWT_SECRET must contain at least 128 bits in production');
}
const secret = configuredSecret || 'local_referrer_token_secret_32_bytes';

const pool = new pg.Pool({
  application_name: 'smart-floor-planner-service-code-refresh',
  connectionString,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  max: 1,
});

const client = await pool.connect();
const changes = [];
let scanned = 0;
let matching = 0;
let rotated = 0;
let missingPrincipal = 0;

try {
  await client.query('begin');
  await client.query(`
    select
      set_config('app.current_enterprise_id', '', true),
      set_config('app.is_platform_admin', 'true', true)
  `);

  if (kind === 'all' || kind === 'staff') {
    const rows = await client.query(`
      select staff_id
      from app.staff_activity_codes
      where status = 'active'
        ${enterpriseId ? 'and enterprise_id = $1' : ''}
      order by staff_id
    `, enterpriseId ? [enterpriseId] : []);
    for (const row of rows.rows) {
      await refreshStaffCode(String(row.staff_id));
    }
  }

  if (kind === 'all' || kind === 'promotion') {
    const rows = await client.query(`
      select membership_id
      from app.referrer_promotion_codes
      where status = 'active'
        ${enterpriseId ? 'and enterprise_id = $1' : ''}
      order by membership_id
    `, enterpriseId ? [enterpriseId] : []);
    for (const row of rows.rows) {
      await refreshPromotionCode(String(row.membership_id));
    }
  }

  const result = {
    success: true,
    mode: apply ? 'apply' : 'dry-run',
    kind,
    ...(enterpriseId ? { enterpriseId } : {}),
    rotateAll,
    scanned,
    matching,
    wouldRotate: rotated,
    ...(apply ? { rotated } : {}),
    missingPrincipal,
    changes,
    changesTruncated: Math.max(0, rotated - changes.length),
  };
  if (apply) {
    await client.query('commit');
  } else {
    await client.query('rollback');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function refreshStaffCode(staffId) {
  const principal = await client.query(
    `select id from app.admin_users where id = $1 and enterprise_id is not null for update`,
    [staffId],
  );
  if (!principal.rows[0]) {
    missingPrincipal += 1;
    return;
  }
  const current = await client.query(
    `select id, enterprise_id, version, token_hash
     from app.staff_activity_codes
     where staff_id = $1 and status = 'active'
     limit 1
     for update`,
    [staffId],
  );
  if (!current.rows[0]) return;
  const row = current.rows[0];
  scanned += 1;
  const expectedHash = hashToken(createStaffActivityToken(staffId, row.version));
  if (!rotateAll && row.token_hash === expectedHash) {
    matching += 1;
    return;
  }
  const nextVersion = await nextVersionFor('staff_activity_codes', 'staff_id', staffId);
  if (apply) {
    await client.query(
      `update app.staff_activity_codes
       set status = 'rotated', disabled_at = now(), updated_at = now()
       where id = $1`,
      [row.id],
    );
    const token = createStaffActivityToken(staffId, nextVersion);
    await client.query(
      `insert into app.staff_activity_codes
        (enterprise_id, staff_id, token_hash, status, version)
       values ($1, $2, $3, 'active', $4)`,
      [row.enterprise_id, staffId, hashToken(token), nextVersion],
    );
  }
  rotated += 1;
  rememberChange('staff_activity', staffId, row.version, nextVersion);
}

async function refreshPromotionCode(membershipId) {
  const principal = await client.query(
    `select id from app.referrer_enterprise_memberships where id = $1 for update`,
    [membershipId],
  );
  if (!principal.rows[0]) {
    missingPrincipal += 1;
    return;
  }
  const current = await client.query(
    `select id, enterprise_id, version, token_hash
     from app.referrer_promotion_codes
     where membership_id = $1 and status = 'active'
     limit 1
     for update`,
    [membershipId],
  );
  if (!current.rows[0]) return;
  const row = current.rows[0];
  scanned += 1;
  const expectedHash = hashToken(createReferrerPromotionToken(membershipId, row.version));
  if (!rotateAll && row.token_hash === expectedHash) {
    matching += 1;
    return;
  }
  const nextVersion = await nextVersionFor('referrer_promotion_codes', 'membership_id', membershipId);
  if (apply) {
    await client.query(
      `update app.referrer_promotion_codes
       set status = 'rotated', disabled_at = now(), updated_at = now()
       where id = $1`,
      [row.id],
    );
    const token = createReferrerPromotionToken(membershipId, nextVersion);
    await client.query(
      `insert into app.referrer_promotion_codes
        (enterprise_id, membership_id, token_hash, status, version)
       values ($1, $2, $3, 'active', $4)`,
      [row.enterprise_id, membershipId, hashToken(token), nextVersion],
    );
  }
  rotated += 1;
  rememberChange('referrer_promotion', membershipId, row.version, nextVersion);
}

async function nextVersionFor(table, ownerColumn, ownerId) {
  const result = await client.query(
    `select version from app.${table} where ${ownerColumn} = $1 order by version desc limit 1`,
    [ownerId],
  );
  return Number(result.rows[0]?.version || 0) + 1;
}

function createStaffActivityToken(staffId, version) {
  return `sa_${digest(`staff-activity:${staffId}:${version}`)}`;
}

function createReferrerPromotionToken(membershipId, version) {
  return `rp_${digest(`referrer-promotion:${membershipId}:${version}`)}`;
}

function digest(value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest().subarray(0, 24).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function rememberChange(type, ownerId, oldVersion, newVersion) {
  if (changes.length < 200) changes.push({ type, ownerId, oldVersion, newVersion });
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${flag} requires a value`);
  return value;
}

function fail(message) {
  console.error(`refresh-service-codes: ${message}`);
  printUsage();
  process.exit(2);
}

function printUsage() {
  console.error(`Usage:
  node scripts/refresh-service-codes.mjs [--kind all|staff|promotion]
    [--enterprise-id ID] [--apply] [--rotate-all]

Default is dry-run and repairs only rows whose token hash does not match the
current REFERRER_TOKEN_SECRET (or JWT_SECRET) and entity/version.
--apply commits the rotation. --rotate-all also rotates matching active rows.`);
}
