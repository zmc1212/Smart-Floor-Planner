import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';
import pg from 'pg';
import { buildReport } from './postgres-cleanup-dry-run.mjs';

const { loadEnvConfig } = nextEnv;
const PLATFORM_ROLES = "'super_admin', 'admin'";
const DELETE_ORDER = [
  'ai_creation_batch_reference_assets', 'ai_creation_task_reference_assets',
  'ai_generation_publications', 'ai_provider_attempts', 'ai_credit_ledgers',
  'ai_creation_batches', 'ai_creation_tasks', 'ai_generations', 'ai_workflows',
  'ai_chat_sessions', 'ai_credit_accounts', 'enterprise_ai_usage_snapshots',
  'measurement_appointment_events', 'measurement_appointments', 'staff_unavailability_periods',
  'customer_attribution_locks', 'lead_assignment_events', 'staff_notifications',
  'lead_acquisition_commissions', 'lead_commissions', 'lead_lifecycle_events',
  'lead_floor_plans', 'measurements', 'floor_plans', 'leads',
  'ai_creation_batch_reference_assets', 'ai_creation_task_reference_assets',
  'commission_records', 'enterprise_orders', 'workflow_notification_logs',
  'promotion_enterprise_records', 'promotion_scan_audits', 'staff_activity_codes', 'referrer_promotion_codes',
  'referrer_enterprise_memberships', 'referrer_profiles', 'enterprise_join_code_events',
  'enterprise_join_codes', 'enterprise_commission_rules', 'enterprise_appointment_settings',
  'enterprise_role_capabilities', 'admin_user_capability_overrides', 'admin_user_promoters',
  'device_user_bindings', 'devices', 'measurer_designer_bindings', 'inspirations', 'media_assets',
  'wechat_identities', 'users', 'admin_users', 'departments', 'enterprises',
];

function parse(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--execute-local-production') values.local = true;
    else if (['--target-fingerprint', '--manifest-sha', '--approved-by'].includes(key)) values[key] = argv[++i];
    else throw new Error(`Unsupported argument: ${key}`);
  }
  if (!values.local || !/^[a-f0-9]{64}$/.test(values['--target-fingerprint'] || '') || !/^[a-f0-9]{64}$/.test(values['--manifest-sha'] || '') || !values['--approved-by']) {
    throw new Error('Required: --execute-local-production --target-fingerprint <sha256> --manifest-sha <sha256> --approved-by <name>');
  }
  return values;
}

function deleteStatement(table) {
  if (table === 'admin_users') return `delete from app.admin_users where role not in (${PLATFORM_ROLES})`;
  if (table === 'users' || table === 'wechat_identities') {
    const column = table === 'users' ? 'id' : 'user_id';
    return `delete from app.${table} where ${column} not in (select user_id from app.admin_users where role in (${PLATFORM_ROLES}) and user_id is not null)`;
  }
  return `delete from app.${table}`;
}

async function main() {
  const args = parse(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString, max: 1, statement_timeout: 120000, application_name: 'smart-floor-planner-production-cleanup' });
  const startedAt = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.current_enterprise_id', '', true), set_config('app.is_platform_admin', 'true', true)");
      const before = await buildReport(client);
      if (before.targetFingerprint !== args['--target-fingerprint']) throw new Error('Target fingerprint changed; rerun the dry-run and obtain new approval');
      if (before.qiniuCandidateManifest.sha256 !== args['--manifest-sha']) throw new Error('Qiniu manifest changed; human approval is stale');
      if (before.readiness.blockingFindings.length) throw new Error(before.readiness.blockingFindings.join(' '));
      const deleted = [];
      for (const table of [...new Set(DELETE_ORDER)]) {
        const result = await client.query(deleteStatement(table));
        deleted.push({ table, rows: String(result.rowCount) });
      }
      const after = await buildReport(client);
      const remaining = after.tableCounts.filter((entry) => entry.deleteCount !== '0');
      if (remaining.length) throw new Error(`Cleanup verification failed: ${remaining.map((entry) => entry.table).join(', ')}`);
      await client.query('commit');
      const audit = { operation: 'production-business-data-cleanup', executedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, targetFingerprint: before.targetFingerprint, qiniuManifestSha256: before.qiniuCandidateManifest.sha256, approvedBy: args['--approved-by'], confirmationNonceSha256: createHash('sha256').update(randomUUID()).digest('hex'), deleted, before, after, qiniuDeletion: before.qiniuCandidateManifest.count ? 'pending asynchronous deletion after human-approved manifest' : 'not_required' };
      const dir = path.resolve(process.cwd(), '.cleanup-audits');
      await fs.mkdir(dir, { recursive: true });
      const base = `cleanup-executed-${audit.executedAt.replace(/[:.]/g, '-')}`;
      await fs.writeFile(path.join(dir, `${base}.json`), `${JSON.stringify(audit, null, 2)}\n`, { flag: 'wx' });
      await fs.writeFile(path.join(dir, `${base}.md`), `# Production cleanup audit\n\n- Target fingerprint: \`${audit.targetFingerprint}\`\n- Approved by: ${audit.approvedBy}\n- Duration: ${audit.durationMs} ms\n- Qiniu deletion: ${audit.qiniuDeletion}\n`, { flag: 'wx' });
      console.log(JSON.stringify({ success: true, targetFingerprint: audit.targetFingerprint, durationMs: audit.durationMs, audit: path.relative(process.cwd(), path.join(dir, `${base}.json`)), qiniuDeletion: audit.qiniuDeletion }, null, 2));
    } catch (error) { await client.query('rollback').catch(() => undefined); throw error; } finally { client.release(); }
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
