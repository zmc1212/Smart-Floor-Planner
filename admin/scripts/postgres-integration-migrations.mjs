import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const forkStart = 1795075200000;
const originalDelegation = 1795507200000;
const reconciledDelegation = 1795593600000;

function hashes(source) {
  const lf = source.replace(/\r\n/g, '\n');
  return new Set([source, lf, lf.replace(/\n/g, '\r\n')]
    .map(text => createHash('sha256').update(text).digest('hex')));
}

function loadJournal(folder, journalFile) {
  return JSON.parse(readFileSync(path.join(folder, journalFile), 'utf8')).entries.map(({ when, tag }) => ({
    when, tag, hashes: hashes(readFileSync(path.join(folder, tag + '.sql'), 'utf8')),
  }));
}

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const knownHashesFile = 'legacy/known-hashes.json';

/**
 * Validates the approved historical-hash allowlist. Only full SHA-256 values are
 * accepted: no wildcards, no prefixes and no fuzzy matching. Every entry must
 * carry its approval record and must be unique in timestamp, tag, hash and
 * ledger id, so the allowlist cannot silently grow into a blanket exemption.
 */
export function parseKnownHashes(value, source = knownHashesFile) {
  const invalid = detail => new Error(`Invalid known-hash allowlist (${source}): ${detail}.`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('expected an object');
  if (value.version !== 1) throw invalid('unsupported version');
  if (!Array.isArray(value.entries)) throw invalid('entries must be an array');
  const seen = { timestamp: new Set(), tag: new Set(), hash: new Set(), ledgerId: new Set() };
  return value.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid('entry must be an object');
    if (!Number.isSafeInteger(entry.ledgerId) || entry.ledgerId <= 0) throw invalid('ledgerId must be a positive integer');
    if (!Number.isSafeInteger(entry.when) || entry.when <= 0) throw invalid('when must be a positive integer');
    if (typeof entry.tag !== 'string' || !/^\S+$/.test(entry.tag)) throw invalid('tag must be a non-empty string');
    if (typeof entry.hash !== 'string' || !SHA256.test(entry.hash)) {
      throw invalid('hash must be a full lowercase SHA-256');
    }
    if (typeof entry.approvedBy !== 'string' || !entry.approvedBy.trim()) throw invalid('approvedBy is required');
    if (typeof entry.approvedAt !== 'string' || !ISO_DATE.test(entry.approvedAt)
      || Number.isNaN(Date.parse(`${entry.approvedAt}T00:00:00Z`))) {
      throw invalid('approvedAt must be an ISO date');
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) throw invalid('reason is required');
    for (const [name, key] of [['timestamp', entry.when], ['tag', entry.tag],
      ['hash', entry.hash], ['ledgerId', entry.ledgerId]]) {
      if (seen[name].has(key)) throw invalid(`duplicate ${name}`);
      seen[name].add(key);
    }
    return Object.freeze({
      ledgerId: entry.ledgerId, when: entry.when, tag: entry.tag, hash: entry.hash,
      approvedBy: entry.approvedBy, approvedAt: entry.approvedAt, reason: entry.reason,
    });
  });
}

/** Fails closed: a missing or malformed allowlist aborts the migration run. */
export function loadKnownHashes(folder) {
  const file = path.join(folder, knownHashesFile);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot load the approved known-hash allowlist at ${file}: ${error.message}`);
  }
  return parseKnownHashes(parsed);
}

export function validateLedger(rows, active, forks, knownHashes = []) {
  const activeByTime = new Map(active.map(entry => [entry.when, entry.hashes]));
  const tagByTime = new Map(active.map(entry => [entry.when, entry.tag]));
  const knownByTime = new Map();
  for (const entry of knownHashes) {
    const options = knownByTime.get(entry.when) ?? [];
    options.push(entry);
    knownByTime.set(entry.when, options);
  }
  // The allowlist is consulted only after both the active journal and the legacy
  // forks reject a row, and it requires the timestamp, the current journal tag
  // and the full hash to agree. An approved row is treated as already applied;
  // it never runs again and never joins a fork.
  const approved = (when, hash) => {
    const tag = tagByTime.get(when);
    return Boolean(tag) && (knownByTime.get(when) ?? [])
      .some(entry => entry.hash === hash && entry.tag === tag);
  };
  const forkByTime = new Map();
  for (const [fork, entries] of Object.entries(forks)) {
    for (const entry of entries) {
      const options = forkByTime.get(entry.when) ?? [];
      options.push({ ...entry, fork });
      forkByTime.set(entry.when, options);
    }
  }
  const seen = new Set();
  let fork;
  for (const row of rows) {
    const when = Number(row.created_at);
    const legacy = forkByTime.get(when)?.find(entry => entry.hashes.has(row.hash));
    if (!legacy && !activeByTime.get(when)?.has(row.hash) && !approved(when, row.hash)) {
      throw new Error(`Unrecognized migration at ledger row ${row.id} (timestamp ${row.created_at}).`);
    }
    if (seen.has(when)) throw new Error(`Duplicate migration timestamp ${when}.`);
    seen.add(when);
    if (legacy) {
      if (fork && fork !== legacy.fork) throw new Error('Mixed XiaoK fork migration history.');
      fork = legacy.fork;
    }
  }

  const forkEntries = forks[fork]?.filter(entry => entry.when >= forkStart) ?? [];
  const lastForkEntry = forkEntries.findLastIndex(entry => seen.has(entry.when));
  const hasBailianDelegation = fork === 'bailian' && seen.has(forkEntries.at(-1)?.when);
  // The additive migration contains the original Bailian upgrade for the
  // source-message siblings that the old integration constraint cannot admit.
  const supersedesOriginal = hasBailianDelegation && !seen.has(originalDelegation);
  const timeline = [...active.filter(entry => entry.when < forkStart), ...forkEntries.slice(0, lastForkEntry + 1),
    ...active.filter(entry => entry.when >= forkStart && (!supersedesOriginal || entry.when !== originalDelegation))];
  const prefix = timeline.slice(0, seen.size);
  if (prefix.length !== seen.size || prefix.some(entry => !seen.has(entry.when))) {
    throw new Error('Migration history has a gap before an applied entry.');
  }
  const integrated = seen.has(originalDelegation) || seen.has(reconciledDelegation);
  const schema = integrated ? 'integrated' : hasBailianDelegation ? 'bailian'
    : fork === 'native' && seen.has(forkEntries[0].when) ? 'native' : 'absent';
  return { seen, schema, supersedesOriginal };
}

/** Ledger entries already applied are skipped, including allowlisted historical rows. */
export function pendingMigrations(migrations, seen, supersedesOriginal) {
  return migrations.filter(migration => !(seen.has(migration.folderMillis)
    || supersedesOriginal && migration.folderMillis === originalDelegation));
}

async function verifyDelegationSchema(client, expected) {
  const { rows } = await client.query(`
    select c.relname,c.relrowsecurity and c.relforcerowsecurity as forced,
      array_agg(a.attname::text) as columns
    from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where c.relnamespace='app'::regnamespace and c.relkind='r'
      and c.relname in ('native_workflow_delegations','native_workflow_delegation_events')
    group by c.oid
  `);
  if (!rows.length && expected === 'absent') return;
  const parent = rows.find(row => row.relname === 'native_workflow_delegations');
  const events = rows.find(row => row.relname === 'native_workflow_delegation_events');
  if (parent?.forced && events?.forced) {
    const native = ['requester_id', 'goal', 'state', 'tasks'].every(name => parent.columns.includes(name))
      && events.columns.includes('task_changes');
    const bailian = ['owner_id', 'title', 'scope', 'current_status', 'operation_key'].every(name => parent.columns.includes(name))
      && ['to_status', 'receipt'].every(name => events.columns.includes(name));
    const actual = native && bailian ? 'integrated' : native ? 'native' : bailian ? 'bailian' : 'unknown';
    if (actual === expected) return;
  }
  throw new Error(`Delegation tables or forced RLS do not match the ${expected} migration history.`);
}

/** The session's migration transaction owns both DDL and its ledger writes. */
export async function migratePostgresIntegration(client, folder) {
  const active = loadJournal(folder, 'meta/_journal.json');
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const forks = Object.fromEntries(['native', 'bailian'].map(fork =>
    [fork, loadJournal(path.join(folder, 'legacy', fork), '_journal.json')]));
  const knownHashes = loadKnownHashes(folder);
  await client.query('begin');
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('smart-floor-planner:drizzle:migrate'))");
    await client.query('create schema if not exists app');
    await client.query(`create table if not exists app.__drizzle_migrations
      (id serial primary key, hash text not null, created_at bigint)`);
    const { rows } = await client.query('select id,hash,created_at from app.__drizzle_migrations order by id');
    const { seen, schema, supersedesOriginal } = validateLedger(rows, active, forks, knownHashes);
    await verifyDelegationSchema(client, schema);
    for (const migration of pendingMigrations(migrations, seen, supersedesOriginal)) {
      const when = migration.folderMillis;
      for (const statement of migration.sql) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query('insert into app.__drizzle_migrations(hash,created_at) values($1,$2)', [migration.hash, when]);
    }
    await verifyDelegationSchema(client, 'integrated');
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
