import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';
import pg from 'pg';

const { loadEnvConfig } = nextEnv;

export const RETAIN_TABLES = new Set([
  '__drizzle_migrations',
  'migration_checkpoints',
  'system_roles',
  'platform_configs',
  'media_storage_configs',
  'ai_provider_configs',
  'ai_creation_model_profiles',
  'ai_credit_prices',
  'ai_model_credit_prices',
  'packages',
  'ai_prompt_library_revisions',
  'ai_prompt_categories',
  'ai_prompt_parameter_templates',
  'ai_prompt_source_models',
  'ai_prompt_template_assets',
  'ai_prompt_templates',
  'ai_prompt_import_runs',
  'ai_style_presets',
]);

export const SPLIT_TABLES = new Set([
  'admin_users',
  'users',
  'wechat_identities',
]);

export const DELETE_TABLES = new Set([
  'enterprises',
  'departments',
  'enterprise_role_capabilities',
  'admin_user_capability_overrides',
  'admin_user_promoters',
  'referrer_profiles',
  'enterprise_join_codes',
  'enterprise_join_code_events',
  'referrer_enterprise_memberships',
  'referrer_promotion_codes',
  'promotion_scan_audits',
  'promotion_enterprise_records',
  'leads',
  'customer_attribution_locks',
  'lead_assignment_events',
  'lead_acquisition_commissions',
  'enterprise_appointment_settings',
  'staff_unavailability_periods',
  'measurement_appointments',
  'measurement_appointment_events',
  'enterprise_commission_rules',
  'lead_commissions',
  'lead_lifecycle_events',
  'staff_notifications',
  'floor_plans',
  'lead_floor_plans',
  'measurements',
  'measurer_designer_bindings',
  'devices',
  'device_user_bindings',
  'enterprise_orders',
  'commission_records',
  'workflow_notification_logs',
  'media_assets',
  'ai_workflows',
  'ai_creation_tasks',
  'ai_creation_batches',
  'ai_creation_task_reference_assets',
  'ai_creation_batch_reference_assets',
  'ai_generations',
  'ai_generation_publications',
  'ai_provider_attempts',
  'ai_credit_accounts',
  'ai_credit_ledgers',
  'ai_chat_sessions',
  'inspirations',
  'enterprise_ai_usage_snapshots',
]);

/**
 * This is intentionally an allow-list. A newly added app table makes the
 * dry-run fail until an operator explicitly classifies it as retained, deleted,
 * or split. That prevents a later cleanup executor from silently handling a
 * new business domain with an outdated plan.
 */
export function classifyTables(tableNames) {
  const unknown = tableNames.filter(
    (tableName) => !RETAIN_TABLES.has(tableName) && !SPLIT_TABLES.has(tableName) && !DELETE_TABLES.has(tableName)
  );
  if (unknown.length) {
    throw new Error(
      `Unclassified app tables require an approved cleanup classification: ${unknown.join(', ')}`
    );
  }

  return tableNames.map((tableName) => ({
    table: tableName,
    disposition: RETAIN_TABLES.has(tableName)
      ? 'retain'
      : SPLIT_TABLES.has(tableName)
        ? 'split'
        : 'delete',
  }));
}

function parseArguments(argv) {
  const args = { writeAuditDirectory: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write-audit') {
      const directory = argv[index + 1];
      if (!directory || directory.startsWith('--')) {
        throw new Error('--write-audit requires a directory path');
      }
      args.writeAuditDirectory = directory;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return args;
}

function stableFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function markdownReport(report) {
  const lines = [
    '# Production cleanup dry-run audit',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Target fingerprint: \`${report.targetFingerprint}\``,
    `- Database: \`${report.databaseFingerprint.databaseName}\``,
    `- Schema: \`${report.databaseFingerprint.schemaName}\``,
    `- Mode: read-only dry-run; no database or object-store deletion was attempted.`,
    '',
    '## Table counts',
    '',
    '| Table | Disposition | Retain | Delete |',
    '| --- | --- | ---: | ---: |',
    ...report.tableCounts.map(
      (entry) => `| ${entry.table} | ${entry.disposition} | ${entry.retainCount} | ${entry.deleteCount} |`
    ),
    '',
    '## Qiniu candidate manifest',
    '',
    `- Candidate objects: ${report.qiniuCandidateManifest.count}`,
    `- Candidate bytes: ${report.qiniuCandidateManifest.totalBytes}`,
    `- Manifest SHA-256: \`${report.qiniuCandidateManifest.sha256}\``,
    '',
    '## Readiness',
    '',
    ...(report.readiness.blockingFindings.length
      ? report.readiness.blockingFindings.map((finding) => `- Blocking: ${finding}`)
      : ['- No automatic blocking finding was detected by the dry-run.']),
    '- Manual production approval is always required.',
    '',
    'Human approval of this manifest, a backup, a restore drill, and a separately approved production confirmation are still required before any cleanup executor may exist or run.',
    '',
  ];
  return lines.join('\n');
}

async function countTable(client, tableName) {
  const result = await client.query(`select count(*)::text as count from app.${tableName}`);
  return result.rows[0].count;
}

async function readMigrationHead(client) {
  const relation = await client.query(
    "select to_regclass('app.__drizzle_migrations') as relation"
  );
  if (!relation.rows[0].relation) return { appliedCount: 0, latestCreatedAt: null };

  const result = await client.query(
    'select count(*)::text as count, max(created_at)::text as latest_created_at from app.__drizzle_migrations'
  );
  return {
    appliedCount: Number(result.rows[0].count),
    latestCreatedAt: result.rows[0].latest_created_at,
  };
}

export async function buildReport(client) {
  const catalog = await client.query(`
    select tablename as table_name
    from pg_tables
    where schemaname = 'app'
    order by tablename
  `);
  const tableNames = catalog.rows.map((row) => row.table_name);
  const classifications = classifyTables(tableNames);

  const tableCounts = [];
  for (const classification of classifications) {
    const totalCount = await countTable(client, classification.table);
    if (classification.disposition === 'retain') {
      tableCounts.push({
        ...classification,
        retainCount: totalCount,
        deleteCount: '0',
      });
      continue;
    }

    if (classification.disposition === 'delete') {
      tableCounts.push({
        ...classification,
        retainCount: '0',
        deleteCount: totalCount,
      });
      continue;
    }

    if (classification.table === 'admin_users') {
      const result = await client.query(`
        select
          count(*) filter (where role in ('super_admin', 'admin'))::text as retain_count,
          count(*) filter (where role not in ('super_admin', 'admin'))::text as delete_count
        from app.admin_users
      `);
      tableCounts.push({
        ...classification,
        retainCount: result.rows[0].retain_count,
        deleteCount: result.rows[0].delete_count,
      });
      continue;
    }

    const result = await client.query(`
      select
        count(*) filter (
          where id in (
            select user_id from app.admin_users
            where role in ('super_admin', 'admin')
              and user_id is not null
          )
        )::text as retain_count,
        count(*) filter (
          where id not in (
            select user_id from app.admin_users
            where role in ('super_admin', 'admin')
              and user_id is not null
          )
        )::text as delete_count
      from app.${classification.table}
    `);
    tableCounts.push({
      ...classification,
      retainCount: result.rows[0].retain_count,
      deleteCount: result.rows[0].delete_count,
    });
  }

  const qiniuCandidates = await client.query(`
    select storage_provider, storage_bucket, storage_key, size_bytes::text as size_bytes, owner_type, owner_id::text as owner_id
    from app.media_assets
    where storage_provider = 'qiniu' and purged_at is null
    order by storage_bucket nulls first, storage_key
  `);
  const manifestEntries = qiniuCandidates.rows.map((row) => ({
    storageProvider: row.storage_provider,
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    sizeBytes: row.size_bytes,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
  }));

  const identity = await client.query(`
    select current_database() as database_name,
      'app'::text as schema_name,
      current_setting('server_version_num') as server_version_num,
      exists(select 1 from pg_namespace where nspname = 'app') as app_schema_exists
  `);
  if (!identity.rows[0].app_schema_exists) {
    throw new Error('The required app schema does not exist on the cleanup target');
  }
  const migrationHead = await readMigrationHead(client);
  const configSummary = await client.query(`
    select count(*)::text as count,
      coalesce(string_agg(key || ':' || updated_at::text, ',' order by key), '') as digest_input
    from app.platform_configs
  `);
  const platformAdminCount = tableCounts.find((entry) => entry.table === 'admin_users').retainCount;
  const databaseFingerprint = {
    environment: process.env.NODE_ENV || 'development',
    databaseName: identity.rows[0].database_name,
    schemaName: identity.rows[0].schema_name,
    serverVersionNum: identity.rows[0].server_version_num,
    migrationHead: {
      localFile: '0024_same_shockwave.sql',
      ...migrationHead,
    },
    platformAdminCount,
    platformConfig: {
      count: configSummary.rows[0].count,
      summarySha256: createHash('sha256')
        .update(configSummary.rows[0].digest_input)
        .digest('hex'),
    },
  };

  const qiniuCandidateManifest = {
    count: manifestEntries.length,
    totalBytes: manifestEntries
      .reduce((total, entry) => total + BigInt(entry.sizeBytes), 0n)
      .toString(),
    sha256: stableFingerprint(manifestEntries),
    entries: manifestEntries,
  };
  const blockingFindings = [];
  if (platformAdminCount === '0') {
    blockingFindings.push('No platform administrator would be retained.');
  }
  return {
    operation: 'production-business-data-cleanup',
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    databaseFingerprint,
    targetFingerprint: stableFingerprint(databaseFingerprint),
    tableCounts,
    qiniuCandidateManifest,
    readiness: {
      blockingFindings,
      requiresHumanManifestApproval: true,
      requiresBackupAndRestoreDrill: true,
      requiresSeparateProductionApproval: true,
    },
    deletionOrder: [
      'business event and join tables',
      'business notifications, commissions, appointments, floor plans, AI tasks and media rows',
      'enterprise staff and ordinary user identities',
      'enterprises',
    ],
    safeguards: [
      'The database session is read-only and rolls back before exit.',
      'No object-storage list or delete operation is called; the manifest is derived from app.media_assets only.',
      'Prompt-template assets are retained and excluded because they are stored in app.ai_prompt_template_assets.',
      'No cleanup executor or production confirmation flag exists in this script.',
    ],
  };
}

async function writeAudit(directory, report) {
  const outputDirectory = path.resolve(process.cwd(), directory);
  await fs.mkdir(outputDirectory, { recursive: true });
  const baseName = `cleanup-dry-run-${report.generatedAt.replace(/[:.]/g, '-')}`;
  const jsonPath = path.join(outputDirectory, `${baseName}.json`);
  const markdownPath = path.join(outputDirectory, `${baseName}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await fs.writeFile(markdownPath, markdownReport(report), { flag: 'wx' });
  return {
    json: path.relative(process.cwd(), jsonPath),
    markdown: path.relative(process.cwd(), markdownPath),
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required for a cleanup dry-run');

  const pool = new pg.Pool({
    application_name: 'smart-floor-planner-cleanup-dry-run',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
    statement_timeout: 30_000,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin read only');
      await client.query(`
        select
          set_config('app.current_enterprise_id', '', true),
          set_config('app.is_platform_admin', 'true', true)
      `);
      const report = await buildReport(client);
      await client.query('rollback');
      if (args.writeAuditDirectory) report.auditFiles = await writeAudit(args.writeAuditDirectory, report);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
