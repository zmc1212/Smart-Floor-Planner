import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SUBSCRIPTION_TEMPLATES } from '@/lib/platform-notification-config';
import { loadIntegrationMigrationInputs } from '../postgres-integration-migrations.mjs';
import {
  auditPendingMigration, notificationEvidence, type AuditClient, type readCatalog,
} from '../xiaok-migration-preflight-checks';
import { inspectLedger, readMigrationPreflight, resolveApprovedTarget } from '../xiaok-migration-preflight';

const folder = new URL('../../drizzle/', import.meta.url);
const inputs = loadIntegrationMigrationInputs(fileURLToPath(folder));
const approvedUrl = 'postgresql://sfp_app:synthetic%20password@localhost:5432/smart_floor_planner';
const identity = {
  database: 'smart_floor_planner', role: 'sfp_app', sessionRole: 'sfp_app', versionNumber: 170010,
  serverPort: 5432, readOnly: 'on', isolation: 'repeatable read', replica: false, rolsuper: false, rolbypassrls: false,
};

function fakeClient(reply: (sql: string) => object[] = () => []) {
  const statements: string[] = [];
  const client = { query: async (sql: string) => {
    statements.push(sql.trim());
    return { rows: reply(sql.trim()) };
  } } as unknown as AuditClient;
  return { client, statements };
}

test('preflight accepts only the approved database and app role on IPv4 loopback', () => {
  assert.deepEqual(resolveApprovedTarget(approvedUrl)?.target, {
    hostname: 'localhost', connectionAddress: '127.0.0.1', port: 5432, database: 'smart_floor_planner', user: 'sfp_app',
  });
  assert.equal(resolveApprovedTarget(approvedUrl, 'production'), null);
  for (const value of [
    undefined, approvedUrl.replace('localhost', 'prod.example.test'), approvedUrl.replace('5432', '55432'),
    approvedUrl.replace('smart_floor_planner', 'xiaok_embedding_eval'), approvedUrl.replace('sfp_app', 'sfp_owner'),
    approvedUrl + '?options=unsafe', approvedUrl + '#elsewhere', approvedUrl.replace('synthetic%20password', '%Q'),
  ]) assert.equal(resolveApprovedTarget(value), null);
});

test('unconfirmed server identity rolls back before any business or ledger query', async () => {
  for (const different of [
    { database: 'other' }, { role: 'sfp_owner' }, { rolsuper: true }, { rolbypassrls: true }, { readOnly: 'off' },
    { isolation: 'read committed' }, { replica: true }, { serverPort: 15432 }, { versionNumber: 180000 },
  ]) {
    const { client, statements } = fakeClient(sql => sql.startsWith('SELECT') ? [{ ...identity, ...different }] : []);
    assert.deepEqual(await readMigrationPreflight(client, inputs), { status: 'blocked', reason: 'server_identity_mismatch' });
    assert.equal(statements.length, 3);
    assert.equal(statements[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(statements.at(-1), 'ROLLBACK');
  }
});

test('inactive enterprise blocks before reading the migration ledger', async () => {
  const { client, statements } = fakeClient(sql => {
    if (sql.startsWith('SELECT current_database')) return [identity];
    if (sql.startsWith('SELECT EXISTS')) return [{ exists: true, active: false }];
    return [];
  });
  const result = await readMigrationPreflight(client, inputs);
  assert.equal(result.status, 'blocked');
  assert.equal('reason' in result && result.reason, 'enterprise_unavailable');
  assert.ok(statements.some(sql => sql.includes("set_config('app.current_enterprise_id'")));
  assert.ok(statements.every(sql => !sql.includes('__drizzle_migrations')));
  assert.equal(statements.at(-1), 'ROLLBACK');
});

type Ledger = Parameters<typeof inspectLedger>[0];
function baselineLedger(): Ledger {
  const active: { when: number; tag: string; hashes: Set<string> }[] = inputs.active;
  return active.slice(0, active.findIndex(item => item.tag.startsWith('0120_'))).map((entry, i) => {
    const historical = (inputs.knownHashes as { when: number; hash: string; ledgerId: number }[]).find(row => row.when === entry.when);
    return {
      id: historical?.ledgerId ?? i + 7,
      created_at: String(entry.when),
      hash: historical?.hash ?? [...entry.hashes][0],
    };
  });
}

test('the official validator recognizes both exact historical hashes and ten pending migrations', () => {
  const result = inspectLedger(baselineLedger(), inputs);
  assert.equal(result.status, 'passed');
  assert.equal(result.count, 119);
  assert.equal(result.recognized, 119);
  assert.equal(result.duplicateTimestamps, 0);
  assert.equal(result.prefixGap, false);
  assert.equal(result.mixedFork, false);
  assert.ok(result.historicalHashes.every(entry => entry.exact));
  assert.deepEqual(result.pending?.map(tag => tag.slice(0, 4)),
    ['0120', '0124', '0125', '0126', '0127', '0128', '0129', '0130', '0131', '0132']);
});

test('unrecognized, duplicate or gapped ledger rows cannot produce a pending plan', () => {
  const rows = baselineLedger();
  const unknown = [{ ...rows[0], hash: 'synthetic-sensitive-input' }, ...rows.slice(1)];
  const cases = [
    [unknown, 'unrecognized_migration'],
    [[...rows, rows[3]], 'duplicate_timestamp'],
    [rows.slice(1), 'prefix_gap'],
  ] as const;
  for (const [material, reason] of cases) {
    const result = inspectLedger(material, inputs);
    assert.equal(result.status, 'failed');
    assert.equal('reason' in result && result.reason, reason);
    assert.equal(result.pending, null);
    assert.equal(JSON.stringify(result).includes('synthetic-sensitive-input'), false);
  }
});

test('notification audit compares the actual sources and emits fingerprints only', () => {
  const config = { version: 2, templates: DEFAULT_SUBSCRIPTION_TEMPLATES, other: 'synthetic-sensitive-config' };
  const sql = readFileSync(new URL('0021_platform_notification_config.sql', folder), 'utf8');
  const document = readFileSync(new URL('../../../docs/miniprogram-subscription-notification-template-baseline.zh-CN.md', import.meta.url), 'utf8');
  const result = notificationEvidence(config, sql, document);
  assert.equal(result.normalizedVersion, 2);
  assert.equal(result.templateIdsValid, true);
  assert.equal(result.storedWriterShape, false);
  for (const template of result.comparison) {
    assert.equal(template.matchesRuntimeDefault, true);
    assert.equal(template.matchesDocument, true);
    assert.match(template.migrationFingerprint ?? '', /^[a-f0-9]{12}$/);
  }
  const output = JSON.stringify(result);
  assert.equal(output.includes('synthetic-sensitive-config'), false);
  assert.equal(output.includes(DEFAULT_SUBSCRIPTION_TEMPLATES.workflow_todo.templateId), false);
});

type Catalog = Awaited<ReturnType<typeof readCatalog>>;
function catalog(names: string[]): Catalog {
  return {
    relations: new Map(names.map(name => [name, {
      name, kind: 'r', readable: true, migrationOwner: true, rls: false, forcedRls: false,
    }])),
    columns: new Map(), constraints: [], indexes: [], policies: [], triggers: new Set(), functions: new Set(), platform: true,
  };
}

test('an unexpected 0120 column exposes both data conflicts and duplicate indexes', async () => {
  const table = 'construction_camera_sd_windows';
  const inventory = catalog([table]);
  inventory.columns.set(table + '.identity_version', 'smallint');
  inventory.indexes.push(
    { relation: table, columns: ['id'], keyUsable: true, name: 'a', signature: 'same' },
    { relation: table, columns: ['id'], keyUsable: true, name: 'b', signature: 'same' },
  );
  const { client, statements } = fakeClient(() => [{ count: '3' }]);
  const result = await auditPendingMigration(client, inventory, '0120_construction_camera_sd_identity_version', []);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.collisions, [table + '.identity_version']);
  assert.deepEqual(result.duplicateIndexes, [['a','b']]);
  assert.deepEqual(result.data?.identityVersion, { status: 'failed', count: 3 });
  assert.ok(statements.every(sql => sql.startsWith('SELECT')));
});

test('receipt checks expose delivered rows before adding a required message reference', async () => {
  const { client, statements } = fakeClient(() => [{ count: '2' }]);
  const result = await auditPendingMigration(client, catalog([
    'construction_stage_reminders', 'assistant_conversations', 'assistant_messages',
  ]), '0129_xiaok_v1_stage_reminder_receipts', []);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.data?.deliveredWithoutMessage, { status: 'failed', count: 2 });
  assert.match(statements[0], /status='delivered'$/);
});

test('0131 requires a jsonb column and one existing non-null default configuration', async () => {
  const tag = '0131_platform_notification_config_not_null';
  const inventory = catalog(['platform_configs']);
  inventory.columns.set('platform_configs.key', 'text');
  inventory.columns.set('platform_configs.notification_config', 'jsonb');
  const ready = fakeClient(() => [{ count: '0' }]);
  assert.equal((await auditPendingMigration(ready.client, inventory, tag, [tag])).status, 'passed');
  assert.match(ready.statements[0], /count\(notification_config\)=1/);
  const missing = fakeClient(() => [{ count: '1' }]);
  const result = await auditPendingMigration(missing.client, inventory, tag, [tag]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.data?.defaultConfig, { status: 'failed', count: 1 });
  inventory.columns.set('platform_configs.notification_config', 'text');
  assert.equal((await auditPendingMigration(ready.client, inventory, tag, [tag])).status, 'failed');
});

test('pilot constraints do not mistake an absent table for checked historical data', async () => {
  const ready = catalog(['enterprises', 'construction_projects', 'leads']);
  for (const table of ['enterprises', 'construction_projects']) {
    const names = table === 'enterprises' ? ['id'] : ['enterprise_id', 'id'];
    ready.indexes.push({ relation: table, name: 'primary', keyUsable: true, columns: names, signature: 'primary' });
    for (const name of names) ready.columns.set(table + '.' + name, 'bigint');
  }
  for (const name of ['construction_projects.lead_id', 'construction_projects.status', 'leads.id', 'leads.enterprise_id', 'leads.archived_at']) {
    ready.columns.set(name, 'available');
  }
  const tag = '0130_xiaok_pilot_project_scopes';
  const { client, statements } = fakeClient(() => [{ count: '1' }]);
  const absent = await auditPendingMigration(client, ready, tag, [tag]);
  assert.equal(absent.status, 'passed');
  assert.equal(absent.data?.historicalRows.status, 'not_run');
  assert.deepEqual(statements, []);
  ready.relations.set('xiaok_pilot_project_scopes', {
    name: 'xiaok_pilot_project_scopes', kind: 'r', rls: false, forcedRls: false, readable: true, migrationOwner: true,
  });
  const drift = await auditPendingMigration(client, ready, tag, [tag]);
  assert.equal(drift.status, 'failed');
  assert.deepEqual(drift.collisions, ['xiaok_pilot_project_scopes']);
  assert.deepEqual(drift.data?.invalidScope, { status: 'failed', count: 1 });
});

test('0132 verifies citation ownership, existing foreign keys and full backfill visibility', async () => {
  const citations = 'assistant_message_citations';
  const versions = 'assistant_knowledge_versions';
  const chunks = 'assistant_knowledge_chunks';
  const tag = '0132_assistant_platform_knowledge_citations';
  const pending = ['0124_assistant_knowledge_integration', tag];
  const inventory = catalog(['enterprises', 'admin_users', citations, versions, chunks]);
  const tenantPredicate = '((SELECT app.has_platform_access() AS has_platform_access) OR '
    + 'enterprise_id = (SELECT app.current_enterprise_id() AS current_enterprise_id))';
  for (const name of [citations, versions, chunks]) {
    Object.assign(inventory.relations.get(name)!, { rls: true, forcedRls: true });
    inventory.policies.push({
      relation: name, name: name + '_tenant', command: 'ALL', roles: ['sfp_app'],
      permissive: 'PERMISSIVE', qual: tenantPredicate, withCheck: tenantPredicate,
    });
  }
  const versionColumns = ['enterprise_id', 'document_id', 'id'];
  const chunkColumns = ['enterprise_id', 'document_version_id', 'id'];
  for (const [relation, columns] of [['enterprises', ['id']], [versions, versionColumns], [chunks, chunkColumns]] as const) {
    inventory.indexes.push({ relation, columns: [...columns], name: 'candidate', keyUsable: true, signature: 'candidate' });
    for (const name of columns) inventory.columns.set(relation + '.' + name, 'bigint');
  }
  for (const name of ['enterprise_id', 'document_id', 'document_version_id', 'chunk_id']) {
    inventory.columns.set(citations + '.' + name, 'bigint');
  }
  for (const name of ['id', 'status', 'must_change_password', 'role']) inventory.columns.set('admin_users.' + name, 'available');
  const options = { relation: citations, type: 'f', validated: true, targetSchema: 'app', match: 's' };
  inventory.constraints.push(
    { ...options, name: 'source_version', target: versions, columns: ['enterprise_id', 'document_id', 'document_version_id'],
      targetColumns: versionColumns, deleteAction: 'a', deleteSetColumns: [] },
    { ...options, name: 'source_chunk', target: chunks, columns: ['enterprise_id', 'document_version_id', 'chunk_id'],
      targetColumns: chunkColumns, deleteAction: 'n', deleteSetColumns: ['chunk_id'] },
  );
  const { client, statements } = fakeClient(() => [{ count: '0' }]);
  const ready = await auditPendingMigration(client, inventory, tag, pending);
  assert.equal(ready.status, 'passed');
  assert.equal(ready.foreignKeys?.length, 2);
  assert.deepEqual(ready.data?.backfillSourceOwner, { status: 'passed', count: 0 });
  assert.ok(statements.every(sql => sql.startsWith('SELECT')));

  const missingDependency = await auditPendingMigration(client, inventory, tag, [tag]);
  assert.equal(missingDependency.status, 'failed');
  assert.deepEqual(missingDependency.missingRelations, ['assistant_managed_knowledge_libraries']);

  inventory.platform = false;
  const hiddenRows = await auditPendingMigration(client, inventory, tag, pending);
  assert.equal(hiddenRows.status, 'limited');
  assert.equal(hiddenRows.data?.backfillSourceOwner.reason, 'full_rls_visibility_unverified');

  inventory.relations.get(citations)!.forcedRls = false;
  inventory.constraints[1].deleteSetColumns = [];
  inventory.policies[0].withCheck = 'true';
  const drifted = await auditPendingMigration(client, inventory, tag, pending);
  assert.equal(drifted.status, 'failed');
  assert.equal(drifted.data?.forcedRls.reason, 'citation_or_source_force_rls_missing');
  assert.equal(drifted.data?.tenantPolicy.reason, 'citation_tenant_policy_drift');
  assert.equal(drifted.data?.previousSourceKeys.reason, 'legacy_citation_source_keys_mismatch');
});
