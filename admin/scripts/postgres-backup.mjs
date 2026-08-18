import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const database = process.env.POSTGRES_BACKUP_DATABASE || 'smart_floor_planner';
const owner = process.env.POSTGRES_BACKUP_USER || 'sfp_owner';
const service = process.env.POSTGRES_DOCKER_SERVICE || 'postgres';

function assertSafeIdentifier(label, value) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier`);
  }
}

for (const [label, value] of [
  ['POSTGRES_BACKUP_DATABASE', database],
  ['POSTGRES_BACKUP_USER', owner],
  ['POSTGRES_DOCKER_SERVICE', service],
]) {
  assertSafeIdentifier(label, value);
}

const backupDirectory = path.resolve(process.cwd(), '.postgres-backups');
await fs.mkdir(backupDirectory, { recursive: true });
const startedAt = Date.now();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(backupDirectory, `${database}-${timestamp}.dump`);

const child = spawn(
  'docker',
  [
    'compose',
    'exec',
    '-T',
    service,
    'pg_dump',
    '-U',
    owner,
    '-d',
    database,
    '--format=custom',
    '--no-owner',
    '--no-privileges',
  ],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'inherit'],
  }
);

child.stdout.pipe(createWriteStream(outputPath, { flags: 'wx' }));

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});

if (exitCode !== 0) {
  await fs.rm(outputPath, { force: true });
  throw new Error(`pg_dump failed with exit code ${exitCode}`);
}

const stats = await fs.stat(outputPath);
if (!stats.size) {
  await fs.rm(outputPath, { force: true });
  throw new Error('pg_dump created an empty backup');
}

console.log(
  JSON.stringify(
    {
      success: true,
      backup: path.relative(process.cwd(), outputPath),
      bytes: stats.size,
      durationMs: Date.now() - startedAt,
    },
    null,
    2
  )
);
