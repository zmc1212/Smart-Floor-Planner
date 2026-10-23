import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, '../tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
const source = new URL(config.EMBEDDING_EVAL_OWNER_URL), app = new URL(config.DATABASE_URL);
const database=process.argv.includes('--runtime-schema')?'cloud_camera_eval':'cloud_camera_unit_eval';
for (const u of [source, app]) if (!['localhost','127.0.0.1'].includes(u.hostname) || u.port !== '55432') throw Error('Local isolated PostgreSQL required');
const control = new pg.Pool({ connectionString: source.toString(), max: 1 });
// The real gateway has a STOP watchdog. Its database must never contain these
// mocked PTZ obligations, or it can race the deterministic recovery assertions.
try { if (!(await control.query('select 1 from pg_database where datname=$1',[database])).rowCount) await control.query('create database '+database); }
finally { await control.end(); }
source.pathname = app.pathname = '/'+database;
const owner = new pg.Pool({ connectionString: source.toString(), max: 1 });
try { await migrate(drizzle(owner), { migrationsFolder: path.join(root, 'drizzle'), migrationsSchema: 'app' }); }
finally { await owner.end(); }
if(process.argv.includes('--runtime-schema')){console.log('Isolated cloud_camera_eval schema migrated');process.exit(0);}
const env = { ...process.env, DATABASE_URL: app.toString(), CAMERA_PUBLIC_ORIGIN: 'http://localhost:3017', NODE_ENV: 'test' };
const out = path.join(root, '../tmp/cloud-camera'); fs.mkdirSync(out, { recursive: true });
const child = spawn(process.execPath, ['--import','tsx','--test','--test-concurrency=1','src/lib/construction/camera/__tests__/adapter.test.ts','src/lib/construction/camera/__tests__/storage.test.ts','src/db/__tests__/construction-camera.test.ts','src/db/__tests__/construction-recordings.test.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
process.exitCode = await new Promise((resolve,reject) => { child.on('error',reject); child.on('exit', c => resolve(c ?? 1)); });
fs.writeFileSync(path.join(out, 'checks.log'), log);
fs.writeFileSync(path.join(out,'checks-'+new Date().toISOString().replace(/[:.]/g,'-')+'.log'),log);
console.log(log.split('\n').filter((line,i,a) => /✔|✖|tests |pass |fail |error:|Error:|expected:|actual:/.test(line) || /error:|expected:|actual:/.test(a[i-1] || '')).slice(-70).join('\n'));
