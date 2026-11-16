import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';
import { platformConfigs } from '@/db/schema';
import {
  DEFAULT_SUBSCRIPTION_TEMPLATES, normalizePlatformNotificationConfig, SUBSCRIPTION_TEMPLATE_KINDS,
  validateDistinctTemplateIds, validateMiniProgramTemplateId,
} from '@/lib/platform-notification-config';

export type AuditClient = Pick<Client, 'query'>;

type Relation = { name: string; kind: string; rls: boolean; forcedRls: boolean; readable: boolean; migrationOwner: boolean };
type Column = { relation: string; name: string; type: string };
type Constraint = {
  relation: string; name: string; type: string; validated: boolean; match: string;
  columns: string[]; targetSchema: string | null; target: string | null; targetColumns: string[];
  deleteAction: string; deleteSetColumns: string[];
};
type Index = { relation: string; columns: string[]; keyUsable: boolean; name: string; signature: string };
type Policy = {
  relation: string; name: string; command: string; roles: string[];
  permissive: string; qual: string | null; withCheck: string | null;
};

export async function readCatalog(client: AuditClient) {
  const { rows: relations } = await client.query<Relation>(`
    SELECT c.relname AS name, c.relkind AS kind, c.relrowsecurity AS rls, c.relforcerowsecurity AS "forcedRls",
      CASE WHEN c.relkind IN ('r','p') THEN has_table_privilege(c.oid,'SELECT') ELSE false END AS readable,
      pg_has_role('sfp_migrator',c.relowner,'USAGE') AS "migrationOwner"
    FROM pg_catalog.pg_class c WHERE c.relnamespace='app'::regnamespace ORDER BY c.relname
  `);
  const { rows: columns } = await client.query<Column>(`
    SELECT c.relname AS relation, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
  `);
  const { rows: constraints } = await client.query<Constraint>(`
    SELECT c.relname AS relation, con.conname AS name, con.contype AS type, con.convalidated AS validated,
      con.confmatchtype AS match, con.confdeltype AS "deleteAction", t.relname AS target, ns.nspname AS "targetSchema",
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum,n)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.n) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum,n)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY k.n) AS "targetColumns",
      ARRAY(SELECT a.attname::text FROM unnest(con.confdelsetcols) AS k(attnum)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum) AS "deleteSetColumns"
    FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
    LEFT JOIN pg_catalog.pg_class t ON t.oid=con.confrelid
    LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid=t.relnamespace
    WHERE c.relnamespace='app'::regnamespace ORDER BY c.relname,con.conname
  `);
  const { rows: indexes } = await client.query<Index>(`
    SELECT t.relname AS relation, c.relname AS name,
      ix.indisunique AND ix.indisvalid AND ix.indisready AND ix.indimmediate
        AND ix.indpred IS NULL AND ix.indexprs IS NULL AS "keyUsable",
      ARRAY(SELECT a.attname::text FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum,n)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
        WHERE k.n<=ix.indnkeyatts ORDER BY k.n) AS columns,
      jsonb_build_array(c.relam,ix.indisunique,ix.indnullsnotdistinct,ix.indnkeyatts,ix.indkey::text,
        ix.indclass::text,ix.indcollation::text,ix.indoption::text,pg_get_expr(ix.indexprs,t.oid),
        pg_get_expr(ix.indpred,t.oid))::text AS signature
    FROM pg_catalog.pg_index ix JOIN pg_catalog.pg_class c ON c.oid=ix.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid=ix.indrelid
    WHERE t.relnamespace='app'::regnamespace ORDER BY t.relname,c.relname
  `);
  const { rows: functions } = await client.query<{ name: string }>(`
    SELECT proname || '/' || pronargs AS name FROM pg_catalog.pg_proc
    WHERE pronamespace='app'::regnamespace
  `);
  const { rows: triggers } = await client.query<{ name: string }>(`
    SELECT c.relname || '.' || t.tgname AS name FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='app'::regnamespace AND NOT t.tgisinternal
  `);
  const { rows: policies } = await client.query<Policy>(`
    SELECT p.tablename AS relation,p.policyname AS name,p.cmd AS command,p.roles::text[] AS roles,
      p.permissive,p.qual,p.with_check AS "withCheck" FROM pg_catalog.pg_policies p
    WHERE p.schemaname='app' AND EXISTS (
      SELECT 1 FROM unnest(p.roles) AS r(name)
      WHERE CASE WHEN r.name='public' THEN true ELSE pg_has_role(r.name,'USAGE') END
    )
  `);
  const { rows: [scope] } = await client.query<{ platform: boolean }>('SELECT app.has_platform_access() AS platform');
  return {
    relations: new Map(relations.map(row => [row.name, row])),
    columns: new Map(columns.map(row => [row.relation + '.' + row.name, row.type])),
    constraints, indexes,
    functions: new Set(functions.map(row => row.name)), triggers: new Set(triggers.map(row => row.name)),
    policies, platform: scope.platform,
  };
}

type Catalog = Awaited<ReturnType<typeof readCatalog>>;

// These are the repository's global reads under the existing platform RLS scope.
// An unfamiliar or restrictive SELECT policy leaves data coverage unverified.
const citationTenantPredicate = 'selectapp.has_platform_accessashas_platform_accessorenterprise_id=selectapp.current_enterprise_idascurrent_enterprise_id';
const platformReadPolicies = new Set([
  'true', 'app.has_platform_access',
  'app.has_platform_accessorenterprise_id=app.current_enterprise_id',
  'enterprise_id=app.current_enterprise_idorapp.has_platform_access',
  citationTenantPredicate,
]);
const normalizePolicy = (predicate: string | null) => predicate?.replace(/[\s()]/g, '').toLowerCase() ?? '';

function readableAcrossTenants(catalog: Catalog, name: string) {
  const relation = catalog.relations.get(name);
  if (!relation?.readable) return false;
  if (!relation.rls) return true;
  const policies = catalog.policies.filter(policy => policy.relation === name
    && (policy.command === 'SELECT' || policy.command === 'ALL'));
  return catalog.platform && policies.every(policy => policy.permissive === 'PERMISSIVE')
    && policies.some(policy => platformReadPolicies.has(normalizePolicy(policy.qual)));
}

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
type DataCheck = { status: 'passed' | 'failed' | 'limited' | 'not_run'; count?: number; reason?: string };

async function countViolations(client: AuditClient, catalog: Catalog, tables: string[], sql: string): Promise<DataCheck> {
  if (!tables.every(table => readableAcrossTenants(catalog, table))) {
    return { status: 'limited', reason: 'full_rls_visibility_unverified' };
  }
  const { rows: [result] } = await client.query<{ count: string }>(sql);
  const count = Number(result.count);
  return { status: count ? 'failed' : 'passed', count };
}

const docs = 'assistant_knowledge_documents', assets = 'assistant_knowledge_assets';
const versions = 'assistant_knowledge_versions', chunks = 'assistant_knowledge_chunks', attempts = 'assistant_knowledge_attempts';
const citations = 'assistant_message_citations', managedLibraries = 'assistant_managed_knowledge_libraries';
const platformLibrary = 'assistant_platform_knowledge_library';
const projects = 'construction_projects', leads = 'leads', plans = 'construction_plans';
const camera = 'construction_camera_sd_windows', reminders = 'construction_stage_reminders';
const pauses = 'construction_stage_reminder_pauses', pilot = 'xiaok_pilot_project_scopes';
const deliveries = 'domain_event_deliveries', outbox = 'domain_event_outbox';
const delegations = 'native_workflow_delegations', events = 'native_workflow_delegation_events';
const memories = 'assistant_long_term_memories';
const platform = 'platform_configs';
const enterpriseKey = 'enterprises.id', projectKey = 'construction_projects.enterprise_id,id';
const messageKey = 'assistant_messages.enterprise_id,id', messageSource = 'assistant_messages.enterprise_id,conversation_id,id';

type Risk = {
  requires: string[]; owners?: string[]; columns?: string[]; keys?: string[]; oldConstraints?: string[];
  newRelations?: string[]; newColumns?: string[]; newConstraints?: string[]; newFunctions?: string[]; newTriggers?: string[];
};

const migrationRisks: Record<string, Risk> = {
  '0120_construction_camera_sd_identity_version': {
    requires: [camera], owners: [camera], newColumns: [camera + '.identity_version'],
    newConstraints: [camera + '.construction_camera_sd_identity_version_check'],
  },
  '0124_assistant_knowledge_integration': {
    requires: [docs, assets, versions, chunks, attempts, projects, 'assistant_knowledge_index_profiles', 'assistant_jobs'],
    owners: [docs, assets, versions, chunks, attempts],
    columns: [docs + '.enterprise_id', assets + '.format', versions + '.source_asset_id', versions + '.source_file',
      attempts + '.operation', chunks + '.embedding'],
    keys: [projectKey, 'assistant_knowledge_index_profiles.enterprise_id,id', 'assistant_jobs.enterprise_id,id',
      'assistant_knowledge_versions.enterprise_id,id'],
    oldConstraints: [assets + '.assistant_knowledge_assets_format_check', versions + '.assistant_source_file_shape',
      attempts + '.assistant_knowledge_attempts_operation_check'],
    newRelations: ['assistant_knowledge_project_documents', managedLibraries,
      'assistant_managed_knowledge_imports', 'assistant_managed_version', 'assistant_managed_cleanup'],
    newColumns: [docs + '.scope', docs + '.project_id', attempts + '.provider_request_id'],
    newConstraints: [docs + '.assistant_knowledge_document_scope', docs + '.assistant_knowledge_document_project_fk'],
    newFunctions: ['assistant_knowledge_scope_immutable/0'],
    newTriggers: [docs + '.assistant_knowledge_document_scope_immutable'],
  },
  '0125_native_workflow_runtime_integration': {
    requires: ['enterprises', deliveries], owners: [deliveries], keys: [enterpriseKey],
    columns: ['enterprise_id', 'available_at', 'id', 'consumer_key', 'status'].map(name => deliveries + '.' + name),
    newRelations: ['native_workflow_runs', 'native_workflow_schedule_runs', 'native_workflow_report_batches',
      'native_workflow_schedule_controls', 'native_workflow_schedule_ledgers', 'native_workflow_durable_tasks',
      'native_workflow_run_recent', 'native_workflow_schedule_recent', 'native_workflow_durable_ready',
      'native_workflow_durable_manual', 'native_workflow_tool_callback_due'],
  },
  '0126_native_workflow_delegation_integration': {
    requires: ['enterprises', 'users', 'assistant_messages', projects, plans, outbox, deliveries],
    owners: [projects, plans, outbox, deliveries],
    columns: [projects + '.version', deliveries + '.enterprise_id', deliveries + '.event_id', deliveries + '.status',
      deliveries + '.consumer_key', outbox + '.payload', plans + '.project_id'],
    keys: [enterpriseKey, 'users.id', projectKey, messageSource, 'domain_event_outbox.enterprise_id,id'],
    newRelations: [memories, delegations, events, 'assistant_long_term_memory_scope', 'native_delegation_project_open',
      'native_delegation_conversation', 'native_delegation_wake', 'native_delegation_by_event',
      'native_delegation_delivery_open', 'native_delegation_project_scope'],
    newFunctions: ['native_delegation_review_state/1', 'queue_native_delegation_event/0',
      'emit_native_delegation_project_change/0', 'emit_native_schedule_change/0'],
    newTriggers: [outbox + '.native_delegation_event_delivery', projects + '.native_delegation_project_change',
      plans + '.native_delegation_schedule_change'],
  },
  '0127_native_workflow_delegation_compatibility': {
    requires: [projects, plans, outbox, deliveries], owners: [projects, plans, outbox],
    newRelations: ['native_delegation_electrical_origin'],
  },
  '0128_xiaok_v1_stage_reminders': {
    requires: ['enterprises', projects], keys: [enterpriseKey, projectKey],
    newRelations: [reminders, pauses, 'construction_stage_reminders_inbox', 'construction_stage_reminders_project'],
  },
  '0129_xiaok_v1_stage_reminder_receipts': {
    requires: ['assistant_conversations', 'assistant_messages'],
    keys: ['assistant_conversations.enterprise_id,id', messageKey],
    newColumns: [reminders + '.conversation_id', reminders + '.message_id'],
    newConstraints: ['conversation_fk', 'message_fk', 'receipt_check'].map(name => reminders + '.construction_stage_reminders_' + name),
  },
  '0130_xiaok_pilot_project_scopes': {
    requires: ['enterprises', projects, leads], keys: [enterpriseKey, projectKey],
    columns: ['construction_projects.lead_id', 'construction_projects.status', 'leads.id', 'leads.enterprise_id', 'leads.archived_at'],
    newRelations: [pilot], newFunctions: ['xiaok_validate_pilot_projects/0'],
    newTriggers: [pilot + '.xiaok_pilot_projects_available'],
  },
  '0131_platform_notification_config_not_null': {
    requires: [platform], owners: [platform], columns: [platform + '.key', platform + '.notification_config'],
  },
  '0132_assistant_platform_knowledge_citations': {
    requires: ['enterprises', 'admin_users', citations, versions, chunks], owners: [citations],
    columns: [
      ...['enterprise_id', 'document_id', 'document_version_id', 'chunk_id'].map(name => citations + '.' + name),
      ...['id', 'status', 'must_change_password', 'role'].map(name => 'admin_users.' + name),
    ],
    keys: [enterpriseKey, versions + '.enterprise_id,document_id,id', chunks + '.enterprise_id,document_version_id,id'],
    newRelations: [platformLibrary],
    newColumns: [citations + '.platform_knowledge_enterprise_id', citations + '.source_enterprise_id'],
    newConstraints: ['owner', 'version_fk', 'chunk_fk'].map(name => citations + '.assistant_citation_source_' + name),
    newFunctions: ['assistant_citation_bind_source_owner/0', 'assistant_platform_knowledge_admin_is_current/1',
      'assistant_managed_knowledge_mapping_immutable/0'],
    newTriggers: [citations + '.assistant_citation_bind_source_owner', managedLibraries + '.assistant_managed_knowledge_mapping_immutable'],
  },
};

const findPending = (pending: string[], prefix: string) => pending.some(tag => tag.startsWith(prefix + '_'));
const constraintName = (row: Constraint) => row.relation + '.' + row.name;

function duplicateIndexes(indexes: Index[]) {
  const groups = new Map<string, string[]>();
  for (const { relation, signature, name } of indexes) {
    const key = relation + ':' + signature;
    const names = groups.get(key) ?? [];
    names.push(name);
    groups.set(key, names);
  }
  return [...groups.values()].filter(names => names.length > 1);
}

async function foreignKeyCheck(client: AuditClient, catalog: Catalog, fk: Constraint) {
  if (fk.targetSchema !== 'app' || !fk.target || !fk.columns.length || fk.columns.length !== fk.targetColumns.length) {
    return { status: 'limited', reason: 'unsupported_fk_target' } satisfies DataCheck;
  }
  const source = fk.columns.map(column => 's.' + quote(column));
  const present = source.map(column => column + ' IS NOT NULL');
  const equality = source.map((column, i) => column + '=t.' + quote(fk.targetColumns[i]));
  const target = `NOT EXISTS (SELECT 1 FROM app.${quote(fk.target)} t WHERE ${equality.join(' AND ')})`;
  const predicate = fk.match === 'f'
    ? `(${present.join(' OR ')}) AND (NOT (${present.join(' AND ')}) OR ${target})`
    : `${present.join(' AND ')} AND ${target}`;
  return countViolations(client, catalog, [fk.relation, fk.target],
    `SELECT count(*) FROM app.${quote(fk.relation)} s WHERE ${predicate}`);
}

async function checkChangingData(client: AuditClient, catalog: Catalog, tag: string): Promise<Record<string, DataCheck>> {
  if (tag.startsWith('0131_')) {
    if (catalog.columns.get(platform + '.notification_config') !== 'jsonb') {
      return { notificationType: { status: 'failed', reason: 'notification_config_must_be_jsonb' } };
    }
    return { defaultConfig: await countViolations(client, catalog, [platform], `
      SELECT CASE WHEN count(*)=1 AND count(notification_config)=1 THEN 0 ELSE 1 END AS count
      FROM app.platform_configs WHERE key='default'
    `) };
  }
  if (tag.startsWith('0120_') && catalog.columns.has(camera + '.identity_version')) {
    return { identityVersion: await countViolations(client, catalog, [camera], `
      SELECT count(*) FROM app.construction_camera_sd_windows
      WHERE identity_version IS NULL OR identity_version NOT IN (0,1)
    `) };
  }
  if (tag.startsWith('0124_')) {
    const formats = "('docx','pdf','xlsx','txt','md')";
    return {
      assetFormat: await countViolations(client, catalog, [assets],
        `SELECT count(*) FROM app.assistant_knowledge_assets WHERE (format IN ${formats}) IS FALSE`),
      versionSource: await countViolations(client, catalog, [versions], `
        SELECT count(*) FROM app.assistant_knowledge_versions WHERE (
          (source_asset_id IS NULL AND source_file IS NULL) OR
          (source_asset_id IS NOT NULL AND jsonb_typeof(source_file)='object' AND source_file->>'version'='1'
           AND source_file->>'assetId'=source_asset_id::text AND source_file->>'format' IN ${formats})
        ) IS FALSE`),
      attemptOperation: await countViolations(client, catalog, [attempts], `
        SELECT count(*) FROM app.assistant_knowledge_attempts WHERE
        (operation IN ('chunk','embed','parse','managed_upload','managed_create','managed_import')) IS FALSE`),
    };
  }
  if (tag.startsWith('0127_') && catalog.relations.has(delegations)) {
    return { duplicateElectricalOrigin: await countViolations(client, catalog, [delegations], `
      SELECT count(*) FROM (
        SELECT 1 FROM app.native_workflow_delegations
        WHERE scope IS NULL GROUP BY enterprise_id,conversation_id,origin_message_id HAVING count(*)>1
      ) duplicates`) };
  }
  if (tag.startsWith('0129_') && catalog.relations.has(reminders)) {
    const missingReceipt = catalog.columns.has(reminders + '.message_id') ? ' AND message_id IS NULL' : '';
    return { deliveredWithoutMessage: await countViolations(client, catalog, [reminders],
      "SELECT count(*) FROM app.construction_stage_reminders WHERE status='delivered'" + missingReceipt) };
  }
  if (tag.startsWith('0130_') && catalog.relations.has(pilot)) {
    return {
      invalidScope: await countViolations(client, catalog, [pilot, 'enterprises', projects, leads], `
        SELECT count(*) FROM app.xiaok_pilot_project_scopes s WHERE
          s.enterprise_id IS NULL OR NOT EXISTS(SELECT 1 FROM app.enterprises e WHERE e.id=s.enterprise_id)
          OR s.pilot_id IS NULL OR s.pilot_id !~ '^[a-zA-Z0-9._:-]{1,128}$'
          OR s.project_ids IS NULL OR cardinality(s.project_ids)=0 OR s.created_by IS NULL OR s.created_by<=0
          OR s.scope_version IS NULL OR s.scope_version<=0 OR s.status IS NULL OR s.status NOT IN ('active','inactive')
          OR (NOT (s.status='inactive' AND EXISTS (
              SELECT 1 FROM app.xiaok_pilot_project_scopes previous
              WHERE previous.enterprise_id=s.enterprise_id AND previous.pilot_id=s.pilot_id
                AND previous.scope_version=s.scope_version-1 AND previous.project_ids=s.project_ids
            )) AND cardinality(s.project_ids) <> (
              SELECT count(*) FROM app.construction_projects p JOIN app.leads l
                ON l.enterprise_id=p.enterprise_id AND l.id=p.lead_id
              WHERE p.enterprise_id=s.enterprise_id AND p.id=ANY(s.project_ids)
                AND p.status<>'archived' AND l.archived_at IS NULL
            ))
      `),
      duplicateVersions: await countViolations(client, catalog, [pilot], `
        SELECT count(*) FROM (
          SELECT 1 FROM app.xiaok_pilot_project_scopes
          GROUP BY enterprise_id,pilot_id,scope_version HAVING count(*)>1
        ) duplicates`),
    };
  }
  if (tag.startsWith('0132_')) {
    const forcedRls = [citations, versions, chunks].every(name => {
      const relation = catalog.relations.get(name);
      return relation?.rls && relation.forcedRls;
    });
    const citationPolicies = catalog.policies.filter(policy => policy.relation === citations);
    const [policy] = citationPolicies;
    const tenantPolicy = citationPolicies.length === 1 && policy.name === 'assistant_message_citations_tenant'
      && policy.command === 'ALL' && policy.permissive === 'PERMISSIVE' && policy.roles.join(',') === 'sfp_app'
      && normalizePolicy(policy.qual) === citationTenantPredicate && normalizePolicy(policy.withCheck) === citationTenantPredicate;
    const sourceKeys = catalog.constraints.filter(fk => fk.relation === citations && fk.type === 'f'
      && (fk.target === versions || fk.target === chunks));
    const versionKey = sourceKeys.find(fk => fk.target === versions);
    const chunkKey = sourceKeys.find(fk => fk.target === chunks);
    const previousSourceKeys = sourceKeys.length === 2
      && sourceKeys.every(fk => fk.targetSchema === 'app' && fk.validated && fk.match === 's')
      && versionKey?.columns.join(',') === 'enterprise_id,document_id,document_version_id'
      && versionKey.targetColumns.join(',') === 'enterprise_id,document_id,id' && versionKey.deleteAction === 'a'
      && chunkKey?.columns.join(',') === 'enterprise_id,document_version_id,chunk_id'
      && chunkKey.targetColumns.join(',') === 'enterprise_id,document_version_id,id'
      && chunkKey.deleteAction === 'n' && chunkKey.deleteSetColumns.join(',') === 'chunk_id';
    return {
      forcedRls: forcedRls ? { status: 'passed' } : { status: 'failed', reason: 'citation_or_source_force_rls_missing' },
      tenantPolicy: tenantPolicy ? { status: 'passed' } : { status: 'failed', reason: 'citation_tenant_policy_drift' },
      previousSourceKeys: previousSourceKeys ? { status: 'passed' }
        : { status: 'failed', reason: 'legacy_citation_source_keys_mismatch' },
      backfillSourceOwner: await countViolations(client, catalog, [citations],
        'SELECT count(*) FROM app.assistant_message_citations WHERE enterprise_id IS NULL'),
    };
  }
  return { historicalRows: { status: 'not_run', reason: 'no_existing_rows_require_the_new_constraint' } };
}

export async function auditPendingMigration(client: AuditClient, catalog: Catalog, tag: string, pending: string[]) {
  const risk = migrationRisks[tag];
  if (!risk) return { tag, status: 'limited', reason: 'migration_without_preflight_checks' };
  const tables = new Set(risk.requires);
  const owners = [...(risk.owners ?? [])];
  if (tag.startsWith('0127_') && !findPending(pending, '0126')) {
    tables.add(delegations); tables.add(events); owners.push(delegations, events);
  }
  if (tag.startsWith('0129_') && !findPending(pending, '0128')) {
    tables.add(reminders); owners.push(reminders);
  }
  if (tag.startsWith('0132_') && !findPending(pending, '0124')) {
    tables.add(managedLibraries); owners.push(managedLibraries);
  }
  if (tag.startsWith('0130_') && catalog.relations.has(pilot)) tables.add(pilot);
  const missingRelations = [...tables].filter(name => !['r','p'].includes(catalog.relations.get(name)?.kind ?? ''));
  const missingOwnership = owners.filter(name => catalog.relations.get(name)?.migrationOwner !== true);
  const missingColumns = (risk.columns ?? []).filter(name => !catalog.columns.has(name));
  const constraintNames = new Set(catalog.constraints.map(constraintName));
  const missingConstraints = (risk.oldConstraints ?? []).filter(name => !constraintNames.has(name));
  const missingFkKeys = (risk.keys ?? []).filter(key => {
    const [table, columns] = key.split('.');
    const names = columns.split(',');
    return !catalog.indexes.some(index => index.relation === table && index.keyUsable
      && index.columns.length === names.length && names.every(name => index.columns.includes(name)))
      || names.some(name => catalog.columns.get(table + '.' + name) !== 'bigint');
  });
  const collisions = [
    ...(risk.newRelations ?? []).filter(name => catalog.relations.has(name)),
    ...(risk.newColumns ?? []).filter(name => catalog.columns.has(name)),
    ...(risk.newConstraints ?? []).filter(name => constraintNames.has(name)),
    ...(risk.newFunctions ?? []).filter(name => catalog.functions.has(name)),
    ...(risk.newTriggers ?? []).filter(name => catalog.triggers.has(name)),
  ];
  const indexes = duplicateIndexes(catalog.indexes.filter(index => tables.has(index.relation)));
  const foreignKeys = catalog.constraints.filter(fk => fk.type === 'f' && tables.has(fk.relation));
  const fkResults = [];
  for (const fk of foreignKeys) fkResults.push({ name: constraintName(fk), validated: fk.validated, ...await foreignKeyCheck(client, catalog, fk) });
  const data = await checkChangingData(client, catalog, tag);
  const failure = [missingRelations, missingOwnership, missingColumns, missingConstraints, missingFkKeys, collisions].some(items => items.length)
    || [...Object.values(data), ...fkResults].some(check => check.status === 'failed');
  const limited = [...Object.values(data), ...fkResults].some(check => check.status === 'limited')
    || fkResults.some(check => !check.validated);
  return {
    tag, status: failure ? 'failed' : limited ? 'limited' : 'passed',
    missingRelations, missingOwnership, missingColumns, missingConstraints, missingFkKeys, collisions,
    duplicateIndexes: indexes, foreignKeys: fkResults, data,
  };
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const repositoryKinds = ['workflow_todo', 'lead_assignment', 'new_lead', 'measurement_appointment'] as const;

export function notificationEvidence(value: unknown, migration: string, document: string) {
  const config = object(value);
  const templates = object(config.templates);
  const normalized = normalizePlatformNotificationConfig(config);
  let templateIdsValid = true;
  try {
    validateDistinctTemplateIds(normalized.templates);
    for (const kind of SUBSCRIPTION_TEMPLATE_KINDS) {
      const id = normalized.templates[kind].templateId;
      if (kind !== 'lead_claim_available' || id) validateMiniProgramTemplateId(id);
    }
  } catch {
    templateIdsValid = false;
  }
  const comparison = repositoryKinds.map(kind => {
    const sqlSeed = migration.match(new RegExp(
      "'" + kind + "',\\s*jsonb_build_object\\(\\s*'title',\\s*'(?:[^']|'')*',\\s*'templateId',\\s*'([A-Za-z0-9_-]+)'",
    ))?.[1];
    const docLine = document.split(/\r?\n/).find(line => line.startsWith('|') && line.includes('`' + kind + '`')
      && /\x60[A-Za-z0-9_-]{35,128}\x60/.test(line));
    const docSeed = docLine?.match(/\x60([A-Za-z0-9_-]{35,128})\x60/)?.[1];
    const current = object(templates[kind]).templateId;
    return {
      kind, currentFingerprint: typeof current === 'string' ? fingerprint(current) : null,
      migrationFingerprint: sqlSeed ? fingerprint(sqlSeed) : null,
      matchesMigration: sqlSeed ? current === sqlSeed : null,
      matchesDocument: docSeed ? current === docSeed : null,
      migrationMatchesDocument: sqlSeed && docSeed ? sqlSeed === docSeed : null,
      matchesRuntimeDefault: current === DEFAULT_SUBSCRIPTION_TEMPLATES[kind].templateId,
    };
  });
  return {
    version: typeof config.version === 'number' && Number.isSafeInteger(config.version) ? config.version : null,
    templateCount: Object.keys(templates).length,
    normalizedVersion: normalized.version,
    templateIdsValid,
    storedWriterShape: config.version === 2 && typeof config.subscriptionMessagesEnabled === 'boolean'
      && SUBSCRIPTION_TEMPLATE_KINDS.every(kind => typeof object(templates[kind]).templateId === 'string'),
    subscriptionSwitchStored: typeof config.subscriptionMessagesEnabled === 'boolean',
    comparison,
  };
}

export async function auditNotificationConfig(client: AuditClient, migrationFile: string, templateDocument: string) {
  const { rows: [column] } = await client.query<{ is_nullable: string; column_default: string | null; data_type: string }>(`
    SELECT is_nullable,column_default,data_type FROM information_schema.columns
    WHERE table_schema='app' AND table_name='platform_configs' AND column_name='notification_config'
  `);
  if (!column) return { status: 'failed', reason: 'notification_config_column_missing' };
  const { rows: [totals] } = await client.query<{ null_rows: string }>(
    'SELECT count(*) FILTER (WHERE notification_config IS NULL) AS null_rows FROM app.platform_configs',
  );
  const { rows } = await client.query<{ notification_config: unknown; digest: string | null }>(
    "SELECT notification_config, encode(sha256(convert_to(notification_config::text,'UTF8')),'hex') AS digest FROM app.platform_configs WHERE key=$1",
    ['default'],
  );
  const emptyObjectDefault = "'{}'::jsonb";
  const schema = platformConfigs.notificationConfig;
  const comparison = notificationEvidence(rows[0]?.notification_config,
    await readFile(migrationFile, 'utf8'), await readFile(templateDocument, 'utf8'));
  const matchesSchema = column.data_type === 'jsonb' && (column.is_nullable === 'NO') === schema.notNull
    && (schema.hasDefault ? column.column_default === emptyObjectDefault : column.column_default === null);
  return {
    status: matchesSchema ? 'passed' : 'failed', is_nullable: column.is_nullable,
    column_default: column.column_default === null || column.column_default === emptyObjectDefault ? column.column_default : 'other_redacted',
    nullRows: Number(totals.null_rows), defaultRowCount: rows.length, defaultRowExists: rows.length === 1,
    defaultRowDigest: rows[0]?.digest ?? null,
    schemaNotNull: schema.notNull, schemaHasDefault: schema.hasDefault, matchesSchema, ...comparison,
  };
}
