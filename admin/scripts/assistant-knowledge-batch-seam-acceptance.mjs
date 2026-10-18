import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fork, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { allowDatabase, networkReport } from './knowledge-batch-seam-acceptance/network-guard.mjs';

const admin = path.resolve(import.meta.dirname, '..'), workspace = path.dirname(admin);
const names = new Set(['--service', '--offline', '--business-sha', '--factory-module', '--factory-export', '--connection-file', '--env-dir', '--output-dir', '--lock-wait-ms']);
export function parseSeamArguments(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i]; if (!names.has(name) || Object.hasOwn(result, name)) throw Error('SEAM_INVALID_ARGUMENTS');
    if (['--service', '--offline'].includes(name)) result[name] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('SEAM_INVALID_ARGUMENTS'); result[name] = args[++i]; }
  }
  if (result['--service'] && result['--offline']) throw Error('SEAM_INVALID_ARGUMENTS');
  if (!result['--service'] && ['--business-sha', '--factory-module', '--factory-export', '--connection-file', '--env-dir', '--lock-wait-ms'].some(name => result[name])) throw Error('SEAM_OFFLINE_REJECTS_SERVICE_INPUT');
  return result;
}
export function verifySeamFactory(args) {
  const sha = args['--business-sha'], name = args['--factory-export'];
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[A-Za-z_$][\w$]*$/.test(name || '') || !args['--factory-module']) throw Error('SEAM_FACTORY_NOT_READY');
  const target = path.resolve(admin, args['--factory-module']), relative = path.relative(workspace, target).replaceAll('\\', '/');
  if (!relative.startsWith('admin/src/lib/assistant/') || relative.includes('..') || !/\.[cm]?ts$/.test(target)) throw Error('SEAM_FACTORY_PATH_INVALID');
  try {
    const git = (...input) => execFileSync('git', input, { cwd: workspace, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    git('merge-base', '--is-ancestor', sha, 'HEAD'); git('cat-file', '-e', sha + ':' + relative);
    git('diff', '--exit-code', sha, '--', relative);
    git('diff', '--exit-code', sha, '--', 'admin/src/lib/assistant/core', 'admin/src/lib/assistant/agent',
      'admin/src/lib/assistant/infrastructure', 'admin/src/lib/assistant/contracts', 'admin/src/lib/ai',
      'admin/src/lib/assistant/knowledge/sources.ts', 'admin/src/lib/assistant/knowledge/answer.ts', 'admin/src/lib/platform-llm-config.ts');
    git('diff', '--exit-code', 'HEAD', '--', 'admin/src/lib/assistant', 'admin/src/lib/ai', 'admin/src/db',
      'admin/src/app/api/assistant/knowledge/operations');
  } catch { throw Error('SEAM_FACTORY_COMMIT_NOT_INTEGRATED'); }
  if (!fs.existsSync(target)) throw Error('SEAM_FACTORY_NOT_READY');
  return { businessSha: sha, factoryModule: pathToFileURL(target).href, factoryExport: name,
    factoryHash: createHash('sha256').update(fs.readFileSync(target)).digest('hex') };
}
const safeCode = error => /^[A-Za-z0-9_]{1,100}$/.test(error?.code || error?.message || '') ? error.code || error.message : 'SEAM_ACCEPTANCE_FAILED';
async function main() {
  process.chdir(admin);
  const args = parseSeamArguments(process.argv.slice(2)), mode = args['--service'] ? 'service' : 'offline';
  const output = path.resolve(admin, args['--output-dir'] || '../tmp/knowledge-batch-seam-acceptance/' + mode + '-' + Date.now() + '-' + process.pid);
  const temporaryRoot = path.resolve(workspace, 'tmp');
  if (!output.startsWith(temporaryRoot + path.sep)) throw Error('SEAM_OUTPUT_MUST_BE_WORKTREE_TMP');
  if (fs.existsSync(path.join(output, 'runner-status.json'))) throw Error('SEAM_OUTPUT_ALREADY_USED');
  fs.mkdirSync(output, { recursive: true });
  const status = { mode, started: new Date().toISOString(), databaseOpened: false, lockHeld: false, passed: false };
  const save = () => fs.writeFileSync(path.join(output, 'runner-status.json'), JSON.stringify(status, null, 2));
  const sources = ['src/lib/assistant/knowledge/operations.ts', 'src/lib/assistant/knowledge/batch-execution-adapter.ts',
    'src/lib/assistant/knowledge/evaluation-batch.ts','src/app/api/assistant/knowledge/operations/[...path]/route.ts', 'scripts/assistant-knowledge-batch-seam-acceptance.mjs',
    ...fs.readdirSync(path.join(admin, 'scripts/knowledge-batch-seam-acceptance')).map(file => 'scripts/knowledge-batch-seam-acceptance/' + file)];
  const listed=execFileSync('git',['ls-files','--','src/lib/assistant','src/lib/ai','src/db/transaction.ts',
    'src/db/repositories/assistant-repository.ts','src/lib/postgresql.ts','src/lib/platform-llm-config.ts',':(exclude)**/__tests__/**'],
    {cwd:admin,encoding:'utf8',windowsHide:true}).trim().split('\n').filter(Boolean);
  sources.push(...listed.filter(file=>!sources.includes(file)));
  const hashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(admin, file))).digest('hex')]));
  let release = async () => {}, driver; const ownedPids = [];
  let env = { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
    LANGCHAIN_TRACING_V2: 'false', XIAOK_SEAM_MODE: mode };
  try {
    // SHA/factory checks happen before reading any environment/connection file or importing database code.
    const factory = mode === 'service' ? verifySeamFactory(args) : {};
    if(factory.factoryModule){const file=path.relative(admin,fileURLToPath(factory.factoryModule));if(!sources.includes(file))sources.push(file);}
    Object.assign(status, factory);
    if (mode === 'service') {
      if (!args['--connection-file']) throw Error('SEAM_APPROVED_CONNECTION_FILE_REQUIRED');
      const config = JSON.parse(fs.readFileSync(path.resolve(args['--connection-file']), 'utf8').replace(/^\uFEFF/, ''));
      const target = new URL(config.DATABASE_URL);
      if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55432' || target.pathname !== '/xiaok_embedding_eval') throw Error('SEAM_ISOLATED_DATABASE_REQUIRED');
      const wait = Number(args['--lock-wait-ms'] || 0);
      if (!Number.isSafeInteger(wait) || wait < 0 || wait > 1800000) throw Error('SEAM_INVALID_LOCK_WAIT');
      const { default: nextEnv } = await import('@next/env'); nextEnv.loadEnvConfig(path.resolve(args['--env-dir'] || admin), true);
      process.env.DATABASE_URL = config.DATABASE_URL; allowDatabase();
      const { lockAssistantAcceptance } = await import('./assistant-acceptance-safety.mjs');
      const lockApplication='kb_seam_'+process.pid+'_'+randomUUID(),lockTarget=new URL(config.DATABASE_URL);
      lockTarget.searchParams.set('application_name',lockApplication);
      const deadline = Date.now() + wait;
      while (true) {
        try { status.databaseOpened = true; release = await lockAssistantAcceptance(lockTarget.toString()); break; }
        catch (error) {
          if (error.message !== 'Another assistant acceptance run holds the isolated database lock.' || Date.now() >= deadline) throw error;
          console.log('Shared acceptance lock occupied; no fixtures or test child processes started.');
          await new Promise(resolve => setTimeout(resolve, Math.min(5000, deadline - Date.now())));
        }
      }
      status.lockHeld = true;
      env = { ...process.env, LANGCHAIN_TRACING_V2: 'false', XIAOK_SEAM_MODE: mode, XIAOK_SEAM_DATABASE_ALLOWED: '1',
        XIAOK_SEAM_LOCK_OWNER: String(process.pid),XIAOK_SEAM_LOCK_APPLICATION:lockApplication };
    }
    const before = hashes(); save();
    const log = fs.openSync(path.join(output, 'driver.log'), 'w');
    driver = fork(path.join(admin, 'scripts/knowledge-batch-seam-acceptance/driver.ts'), [], { cwd: admin,
      env: { ...env, XIAOK_SEAM_GUARD_REPORT: path.join(output, 'driver-network.json') },
      execArgv: ['--import', pathToFileURL(path.join(admin, 'scripts/knowledge-batch-seam-acceptance/network-guard.mjs')).href, '--import', 'tsx'],
      windowsHide: true, stdio: ['ignore', log, log, 'ipc'] }); fs.closeSync(log); status.driverPid = driver.pid;
    ownedPids.push(driver.pid);
    driver.on('message', message => {
      if (message.type === 'pids' && Array.isArray(message.pids) && message.pids.length === 2
        && message.pids.every(pid => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid && pid !== driver.pid)) ownedPids.push(...message.pids);
    });
    driver.send({ type: 'start', config: { mode, admin, output, ...factory } });
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { driver.kill(); reject(Error('SEAM_DRIVER_TIMEOUT_CLEANUP_UNCERTAIN')); }, 180000);
      driver.once('error', error => { clearTimeout(timer); reject(error); });
      driver.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
    });
    const after = hashes(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
    status.exitCode = exitCode;
    if (!fs.existsSync(path.join(output, 'driver-report.json'))) throw Error('SEAM_DRIVER_BOOT_FAILED');
    const report = JSON.parse(fs.readFileSync(path.join(output, 'driver-report.json'), 'utf8'));
    const guardReports = ['driver-network.json', 'process-0-network.json', 'process-1-network.json']
      .filter(file => fs.existsSync(path.join(output, file))).map(file => JSON.parse(fs.readFileSync(path.join(output, file), 'utf8')));
    const networkSafe = guardReports.length === 3 && guardReports.every(r => r.providerFetches === 0 && r.blockedSockets === 0);
    Object.assign(status, { exitCode, sourceStable, before, after, cases: report.cases.length, childrenStopped: report.childrenStopped,
      guardReports, networkSafe, passed: exitCode === 0 && report.passed === true && report.childrenStopped === true && sourceStable && networkSafe });
  } catch (error) { status.errorCode = safeCode(error); }
  finally {
    // The lock spans child shutdown and exact-fixture audit/cleanup. Never stop a pre-existing Worker/service.
    if (driver && driver.exitCode === null && !driver.signalCode) { driver.kill(); status.cleanupUncertain = true; status.passed = false; }
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const pid of ownedPids) if (alive(pid)) { try { process.kill(pid); } catch { status.cleanupUncertain = true; } }
    for (let i = 0; i < 20 && ownedPids.some(alive); i++) await new Promise(resolve => setTimeout(resolve, 100));
    const remaining = ownedPids.filter(alive);
    if (remaining.length) { status.remainingOwnedPids = remaining; status.cleanupUncertain = true; status.passed = false; }
    // A surviving own DB client is not permission to release the suite mutex. The open lock session keeps this parent pending.
    if (!(mode === 'service' && remaining.length && status.lockHeld)) { await release(); status.lockHeld = false; }
    status.network = networkReport(); status.finished = new Date().toISOString(); save();
    console.log(JSON.stringify({ mode, passed: status.passed, cases: status.cases || 0, databaseOpened: status.databaseOpened,
      errorCode: status.errorCode || null, childrenStopped: status.childrenStopped || false }));
    process.exitCode = status.passed ? 0 : 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch(error => { console.log(JSON.stringify({ errorCode: safeCode(error), databaseOpened: false })); process.exitCode = 1; });
