import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sourceDatabase =
  process.env.POSTGRES_BACKUP_DATABASE || 'smart_floor_planner';
const drillDatabase = 'smart_floor_planner_restore_drill';
const owner = process.env.POSTGRES_BACKUP_USER || 'sfp_owner';
const service = process.env.POSTGRES_DOCKER_SERVICE || 'postgres';
const expectedTableCount = Number(process.env.POSTGRES_RESTORE_EXPECTED_TABLES || 68);
const expectedRlsTableCount = Number(
  process.env.POSTGRES_RESTORE_EXPECTED_RLS_TABLES || 47
);
const expectedPolicyCount = Number(
  process.env.POSTGRES_RESTORE_EXPECTED_POLICIES || 88
);

function assertSafeIdentifier(label, value) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier`);
  }
}

for (const [label, value] of [
  ['POSTGRES_BACKUP_DATABASE', sourceDatabase],
  ['POSTGRES_BACKUP_USER', owner],
  ['POSTGRES_DOCKER_SERVICE', service],
  ['drill database', drillDatabase],
]) {
  assertSafeIdentifier(label, value);
}

if (sourceDatabase === drillDatabase) {
  throw new Error('Restore drill database must differ from the source database');
}

const backupDirectory = path.resolve(process.cwd(), '.postgres-backups');
const requestedBackup = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : undefined;

async function latestBackup() {
  if (requestedBackup) return requestedBackup;
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(`${sourceDatabase}-`) &&
        entry.name.endsWith('.dump')
    )
    .map((entry) => path.join(backupDirectory, entry.name));
  const withTimes = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      modifiedAt: (await fs.stat(candidate)).mtimeMs,
    }))
  );
  withTimes.sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (!withTimes[0]) {
    throw new Error('No PostgreSQL backup is available for the restore drill');
  }
  return withTimes[0].candidate;
}

function dockerCommand(args, stdinFile) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', 'exec', '-T', service, ...args], {
      cwd: process.cwd(),
      stdio: [stdinFile ? 'pipe' : 'ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    if (stdinFile) createReadStream(stdinFile).pipe(child.stdin);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${args[0]} failed with exit code ${code}`));
    });
  });
}

const backupPath = await latestBackup();
const resolvedBackupDirectory = `${backupDirectory}${path.sep}`;
if (
  backupPath !== backupDirectory &&
  !backupPath.startsWith(resolvedBackupDirectory)
) {
  throw new Error('Restore drill backup must be inside .postgres-backups');
}

await fs.access(backupPath);
const startedAt = Date.now();

try {
  await dockerCommand([
    'dropdb',
    '-U',
    owner,
    '--if-exists',
    drillDatabase,
  ]);
  await dockerCommand(['createdb', '-U', owner, drillDatabase]);
  await dockerCommand(
    [
      'pg_restore',
      '-U',
      owner,
      '-d',
      drillDatabase,
      '--no-owner',
      '--no-privileges',
    ],
    backupPath
  );
  const verification = await dockerCommand([
    'psql',
    '-U',
    owner,
    '-d',
    drillDatabase,
    '-At',
    '-F',
    '|',
    '-c',
    `select
       (select count(*) from information_schema.tables where table_schema = 'app'),
       (select count(*) from pg_tables where schemaname = 'app' and rowsecurity),
       (select count(*) from pg_policies where schemaname = 'app'),
       (select count(*) from app.migration_checkpoints);`,
  ]);
  const [tableCount, rlsTableCount, policyCount, checkpointCount] = verification
    .split('|')
    .map(Number);
  if (
    tableCount !== expectedTableCount
    || rlsTableCount !== expectedRlsTableCount
    || policyCount !== expectedPolicyCount
  ) {
    throw new Error(
      `Restored schema verification failed: tables=${tableCount}, `
      + `rlsTables=${rlsTableCount}, policies=${policyCount}`
    );
  }
  console.log(
    JSON.stringify(
      {
        success: true,
        backup: path.relative(process.cwd(), backupPath),
        drillDatabase,
        tableCount,
        rlsTableCount,
        policyCount,
        migrationCheckpointRows: checkpointCount,
        restoreDurationMs: Date.now() - startedAt,
      },
      null,
      2
    )
  );
} finally {
  await dockerCommand([
    'dropdb',
    '-U',
    owner,
    '--if-exists',
    drillDatabase,
  ]);
}
