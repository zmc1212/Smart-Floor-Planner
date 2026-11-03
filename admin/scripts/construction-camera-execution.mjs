// A physical execution copy for one bounded camera evaluation, including dirty
// source/configuration and installed Node dependencies. Never a Git checkout or
// a copied Mini Program project. No migration, provider call or device setup.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {cameraDeployment, cameraEnvironmentIdentity, inspectCameraEnvironment, cameraCommand, REMOTE_CAMERA_CONTEXT} from './construction-camera-environment.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
async function mapFiles(files, work) {
  const results = new Array(files.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(16, files.length)}, async () => {
    for (;;) { const index = next++; if (index >= files.length) return; results[index] = await work(files[index], index); }
  }));
  return results;
}
const inside = (base, file) => {
  const relative = path.relative(base, file);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Execution path must remain inside its batch');
  return relative;
};

export function snapshotFiles(base, relative = '') {
  return fs.readdirSync(path.join(base, relative), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Execution copies must not share linked files');
    return entry.isDirectory() ? snapshotFiles(base, file) : entry.isFile() ? [slash(file)] : [];
  });
}

export function copyExecutionFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  assert.ok(!fs.existsSync(destination), 'Never overwrite an existing execution file');
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(destination, bytes, {flag: 'wx'});
  const sha256 = digest(bytes);
  assert.equal(digest(fs.readFileSync(source)), sha256, 'Source changed while preparing execution');
  return {sha256, bytes: bytes.length};
}

export function readExecutionManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const {sha256, ...body} = manifest;
  assert.equal(digest(JSON.stringify(body)), sha256, 'Execution manifest changed');
  assert.equal(manifest.format, 1);
  assert.equal(path.resolve(file), path.join(manifest.output, 'execution-manifest.json'));
  assert.equal(manifest.executionRoot, path.join(manifest.output, 'execution'));
  return manifest;
}

export function verifyExecution(file, deep = true) {
  const manifest = readExecutionManifest(file);
  for (const entry of manifest.entries) {
    if (!deep && entry.kind === 'dependency') continue;
    const target = path.resolve(manifest.output, entry.target);
    inside(manifest.output, target);
    assert.ok(fs.lstatSync(target).isFile(), 'Execution file is missing or linked');
    assert.equal(digest(fs.readFileSync(target)), entry.sha256, 'Execution bytes changed: ' + entry.target);
  }
  for (const pin of manifest.externalPins) assert.equal(digest(fs.readFileSync(pin.path)), pin.sha256, 'Pinned execution resource changed');
  return {manifest: manifest.sha256, executionRoot: manifest.executionRoot, files: manifest.entries.length, deep};
}

export async function verifyExecutionAsync(file) {
  const manifest = readExecutionManifest(file);
  await mapFiles(manifest.entries, async entry => {
    const target = path.resolve(manifest.output, entry.target); inside(manifest.output, target);
    assert.ok((await fs.promises.lstat(target)).isFile(), 'Execution file is missing or linked');
    assert.equal(digest(await fs.promises.readFile(target)), entry.sha256, 'Execution bytes changed: ' + entry.target);
  });
  for (const pin of manifest.externalPins) assert.equal(digest(fs.readFileSync(pin.path)), pin.sha256, 'Pinned execution resource changed');
  return {manifest: manifest.sha256, executionRoot: manifest.executionRoot, files: manifest.entries.length, deep: true};
}

export function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  if (process.platform === 'win32') {
    const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if($p){@{pid=$p.ProcessId;executable=$p.ExecutablePath;command=$p.CommandLine;created=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`;
    const result = cp.execFileSync('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf8', windowsHide: true}).trim();
    return result ? JSON.parse(result) : null;
  }
  try {
    return {pid, executable: fs.readlinkSync(`/proc/${pid}/exe`), command: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' '), created: fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[21]};
  } catch { return null; }
}

export function assertExecutionProcess(expected, actual) {
  assert.ok(actual, 'Execution process is absent');
  assert.equal(actual.pid, expected.pid);
  assert.equal(actual.created, expected.created, 'Execution PID was reused');
  assert.ok(samePath(actual.executable, expected.executable), 'Execution interpreter changed');
  assert.ok(slash(actual.command).toLowerCase().includes(slash(expected.script).toLowerCase()), 'Process does not execute this snapshot');
}

export async function executionIdentity(deep = false, gateway = true) {
  const file = process.env.CAMERA_EXECUTION_MANIFEST;
  if (!file) return null; // Historical drivers remain independently reproducible.
  const manifest = readExecutionManifest(file);
  assert.ok(samePath(process.cwd(), path.join(manifest.executionRoot, 'admin')), 'Controller must execute the frozen source');
  assert.ok(samePath(process.argv[1], path.join(manifest.executionRoot, 'admin/scripts/construction-camera-soak.ts')), 'Controller script must belong to the snapshot');
  const identity = deep ? await verifyExecutionAsync(file) : verifyExecution(file, false);
  if (gateway) {
    const expected = JSON.parse(fs.readFileSync(path.join(manifest.output, 'gateway-process.json'), 'utf8'));
    assert.equal(expected.manifest, manifest.sha256);
    assertExecutionProcess(expected, processIdentity(expected.pid));
    identity.gatewayPid = expected.pid;
  }
  return identity;
}

function privateDirectory(folder) {
  fs.mkdirSync(folder, {recursive: false, mode: 0o700});
  if (process.platform === 'win32') cp.execFileSync('icacls', [folder, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], {windowsHide: true, stdio: 'pipe'});
}

export function executionDeploymentEnvironment(context) {
  const deployment = cameraDeployment(context);
  return {CAMERA_DOCKER_CONTEXT: deployment.context, CAMERA_RECORDING_HOST_PATH: deployment.recordingHostPath};
}

async function prepare(workspace, output, flags) {
  assert.ok(flags.length === 2 && flags[0] === '--context', 'Prepare requires explicit --context sfp-remote-dev or --context desktop-linux');
  const deploymentEnv = executionDeploymentEnvironment(flags[1]);
  assert.ok(path.basename(output).startsWith('cloud-camera-operations-'));
  assert.ok(samePath(path.dirname(output), path.join(workspace, 'tmp')));
  assert.ok(!fs.existsSync(output), 'Use a new batch; never replace a prior execution or receipt');
  const admin = path.join(workspace, 'admin');
  const nextEnv = await import(pathToFileURL(path.join(admin, 'node_modules/@next/env/dist/index.js')).href);
  nextEnv.default.loadEnvConfig(admin, true);
  assert.ok(!process.env.NODE_OPTIONS, 'Unbound NODE_OPTIONS cannot enter a frozen execution');
  privateDirectory(output);
  const externalFiles = [process.execPath, process.env.CAMERA_SD_PYTHON || 'E:/anaconda3/python.exe'];
  if (flags[1] === REMOTE_CAMERA_CONTEXT) {
    for (const binary of ['ssh.exe', 'docker.exe']) externalFiles.push(cameraCommand('where.exe', [binary]).split(/\r?\n/)[0]);
    externalFiles.push(path.join(os.homedir(), '.ssh/config'), path.join(os.homedir(), '.ssh/known_hosts'));
    const contextMetadata = JSON.parse(cameraCommand('docker', ['context', 'inspect', flags[1], '--format', '{{json .Storage.MetadataPath}}']));
    assert.ok(typeof contextMetadata === 'string' && path.isAbsolute(contextMetadata), 'Docker context metadata must be a local configuration file');
    externalFiles.push(path.join(contextMetadata, 'meta.json'));
  }
  const externalPins = [...new Set(externalFiles)].map(file => ({path: file, sha256: digest(fs.readFileSync(file))}));
  const storageConfig = JSON.parse(fs.readFileSync(path.join(workspace, 'tmp/cloud-camera/storage.private.json'), 'utf8'));
  const deploymentBefore = await inspectCameraEnvironment(flags[1], storageConfig);
  const executionRoot = path.join(output, 'execution'), entries = [];
  const copy = (source, relative, kind = 'source') => {
    const target = path.join(output, relative);
    inside(output, target);
    const receipt = copyExecutionFile(source, target);
    entries.push({source, target: slash(relative), kind, ...receipt});
  };
  const sourceFiles = ['src', 'scripts', 'public', 'drizzle', 'docker'].flatMap(folder => snapshotFiles(path.join(admin, folder)).map(file => folder + '/' + file));
  sourceFiles.push(...fs.readdirSync(admin).filter(name => /^(?:package(?:-lock)?\.json|(?:next|postcss|eslint|drizzle)\.config\.[cm]?[jt]s|tsconfig\.json|\.env(?:\.[\w-]+)?)$/.test(name)));
  // Next regenerates this declaration; its original-to-copy hash is recorded
  // separately, before any run. Generated output is not immutable source.
  for (const file of sourceFiles) copy(path.join(admin, file), 'execution/admin/' + file);
  const generatedSources = [];
  if (fs.existsSync(path.join(admin, 'next-env.d.ts'))) {
    const source = path.join(admin, 'next-env.d.ts'), target = 'execution/admin/next-env.d.ts';
    generatedSources.push({source, target, ...copyExecutionFile(source, path.join(output, target))});
  }
  console.log(JSON.stringify({phase: 'sources-copied', files: entries.length}));
  const dependencies = snapshotFiles(path.join(admin, 'node_modules'));
  if (process.platform === 'win32') {
    // Parallel native copies avoid serial antivirus latency for 80k small
    // installed files. /E copies only; never /MIR, /PURGE, /MOVE or deletion.
    const target = path.join(executionRoot, 'admin/node_modules');
    const copied = cp.spawnSync('robocopy', [path.join(admin, 'node_modules'), target, '/E', '/MT:16', '/COPY:DAT', '/DCOPY:DAT', '/XJ', '/R:0', '/W:0', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {windowsHide: true, encoding: 'utf8'});
    assert.ok(!copied.error && copied.status !== null && copied.status < 8, 'Installed dependency copy failed');
    assert.deepEqual(snapshotFiles(target), dependencies, 'Installed dependency file set changed during copy');
    let hashed = 0;
    const copiedEntries = await mapFiles(dependencies, async file => {
      const bytes = await fs.promises.readFile(path.join(target, file));
      if (++hashed % 16000 === 0) console.log(JSON.stringify({phase: 'dependency-hashes', files: hashed}));
      return {source: path.join(admin, 'node_modules', file), target: 'execution/admin/node_modules/' + file, kind: 'dependency', sha256: digest(bytes), bytes: bytes.length};
    });
    for (const entry of copiedEntries) entries.push(entry);
  } else {
    for (const file of dependencies) copy(path.join(admin, 'node_modules', file), 'execution/admin/node_modules/' + file, 'dependency');
  }
  console.log(JSON.stringify({phase: 'dependencies-copied', files: dependencies.length}));
  for (const file of ['tmp/xiaok-vector/connection.private.json', 'tmp/cloud-camera/storage.private.json', 'tmp/cloud-camera/storage-deployment.json']) copy(path.join(workspace, file), 'execution/' + file, 'configuration');
  const vendorEnv = process.env.CAMERA_LOCAL_WVP_ENV || 'G:/workspace/向总/wvp/.env';
  const vendorAdapter = process.env.CAMERA_SD_VENDOR_ADAPTER || 'G:/workspace/向总/wvp/onboarding';
  copy(vendorEnv, 'execution/external/vendor.env', 'configuration');
  for (const file of fs.readdirSync(vendorAdapter).filter(name => name.endsWith('.py'))) copy(path.join(vendorAdapter, file), 'execution/external/vendor/' + file);
  copy(path.join(workspace, 'tmp/cloud-camera-dual-20261103/devices.private.json'), 'execution/external/devices.private.json', 'configuration');
  copy(path.join(workspace, 'tmp/cloud-camera-reliability-20261103/fixture.private.json'), 'fixture.private.json', 'configuration');
  const db = new URL(JSON.parse(fs.readFileSync(path.join(executionRoot, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(db.hostname) && db.port === '55432');
  db.pathname = '/cloud_camera_eval';
  const vendor = Object.fromEntries(fs.readFileSync(path.join(executionRoot, 'external/vendor.env'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
  const storage = JSON.parse(fs.readFileSync(path.join(executionRoot, 'tmp/cloud-camera/storage.private.json'), 'utf8'));
  const manifestFile = path.join(output, 'execution-manifest.json');
  const env = {...process.env, ...deploymentEnv, NODE_ENV: 'development', DATABASE_URL: db.toString(), NODE_PATH: path.join(executionRoot, 'admin/node_modules'), TSX_TSCONFIG_PATH: path.join(executionRoot, 'admin/tsconfig.json'), NEXT_DIST_DIR: '.next-camera', CAMERA_PUBLIC_ORIGIN: 'http://localhost:3017', CAMERA_APP_ORIGIN: 'http://127.0.0.1:3018', CAMERA_WVP_ORIGIN: 'http://127.0.0.1:18080', CAMERA_MEDIA_ORIGIN: `http://127.0.0.1:${vendor.MEDIA_HTTP_PORT || '8080'}`, CAMERA_WVP_USERNAME: 'admin', CAMERA_WVP_PASSWORD: vendor.WVP_ADMIN_PASSWORD, CAMERA_ZLM_SECRET: vendor.ZLM_SECRET, CAMERA_MEDIA_SERVER_ID: 'wvp-zlm-01', CAMERA_NODE_RETENTION_DAYS: vendor.RECORD_DAYS || '7', CAMERA_RECORDING_ROOT: '/opt/media/www/record', CAMERA_STORAGE_ORIGIN: storage.origin, CAMERA_STORAGE_TOKEN: storage.token, CAMERA_SD_PYTHON: process.env.CAMERA_SD_PYTHON || 'E:/anaconda3/python.exe', CAMERA_SD_VENDOR_ADAPTER: path.join(executionRoot, 'external/vendor'), CAMERA_SD_DEVICES_FILE: path.join(executionRoot, 'external/devices.private.json'), CAMERA_LOCAL_WVP_ENV: path.join(executionRoot, 'external/vendor.env'), CAMERA_TEST_OUTPUT: output, CAMERA_SOAK_BINDING_MANIFEST: path.join(output, 'binding-manifest.json'), CAMERA_EXECUTION_MANIFEST: manifestFile};
  const generated = (relative, value) => {
    const content = JSON.stringify(value, null, 2);
    fs.writeFileSync(path.join(output, relative), content, {flag: 'wx', mode: 0o600});
    entries.push({source: null, target: relative, kind: 'configuration', sha256: digest(content), bytes: Buffer.byteLength(content)});
  };
  const deploymentAfter = await inspectCameraEnvironment(flags[1], storage);
  assert.deepEqual(cameraEnvironmentIdentity(deploymentAfter), cameraEnvironmentIdentity(deploymentBefore), 'Camera deployment changed during preparation');
  generated('camera-environment.json', {before: deploymentBefore, after: deploymentAfter});
  generated('runtime.private.json', env);
  generated('binding-manifest.json', {files: entries.filter(entry => entry.kind !== 'dependency').map(entry => path.join(output, entry.target)).concat(manifestFile)});
  const body = {format: 1, created: new Date().toISOString(), workspace, output, executionRoot, head: cp.execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workspace, encoding: 'utf8', windowsHide: true}).trim(), entries, generatedSources, generatedMutable: ['execution/admin/next-env.d.ts', 'execution/admin/.next-camera/'], externalPins};
  // Recheck the complete captured inputs once. Later working-tree changes are
  // independent of these physical copies and cannot alter this run's identity.
  await mapFiles(entries.filter(entry => entry.source), async entry => assert.equal(digest(await fs.promises.readFile(entry.source)), entry.sha256, 'Input drift during snapshot preparation'));
  for (const pin of externalPins) assert.equal(digest(fs.readFileSync(pin.path)), pin.sha256, 'External binding changed during preparation');
  fs.writeFileSync(manifestFile, JSON.stringify({...body, sha256: digest(JSON.stringify(body))}), {flag: 'wx'});
  console.log(JSON.stringify({phase: 'prepared', ...await verifyExecutionAsync(manifestFile), bytes: entries.reduce((n, entry) => n + entry.bytes, 0)}));
}

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function launch(command, output, flags) {
  const manifestFile = path.join(output, 'execution-manifest.json');
  const identity = await verifyExecutionAsync(manifestFile), manifest = readExecutionManifest(manifestFile);
  const admin = path.join(manifest.executionRoot, 'admin');
  const env = JSON.parse(fs.readFileSync(path.join(output, 'runtime.private.json'), 'utf8'));
  assert.ok(samePath(env.CAMERA_EXECUTION_MANIFEST, manifestFile));
  // Stopping an owned recorder must still work during a capacity-probe outage.
  if (command !== 'soak-control') {
    const deployment = JSON.parse(fs.readFileSync(path.join(output, 'camera-environment.json'), 'utf8'));
    const current = await inspectCameraEnvironment(env.CAMERA_DOCKER_CONTEXT, {origin: env.CAMERA_STORAGE_ORIGIN, token: env.CAMERA_STORAGE_TOKEN});
    assert.deepEqual(cameraEnvironmentIdentity(current), cameraEnvironmentIdentity(deployment.after), 'Camera deployment differs from the prepared batch');
  }
  const scripts = {gateway: 'construction-camera-gateway.ts', 'soak-preflight': 'construction-camera-soak.ts', 'soak-smoke': 'construction-camera-soak.ts', 'soak-crash': 'construction-camera-soak.ts', 'soak-start': 'construction-camera-soak.ts', 'soak-control': 'construction-camera-soak-control.ts'};
  if (command === 'next') await freePort(3018);
  if (command === 'gateway') await freePort(3017);
  assert.ok(command === 'next' || Object.hasOwn(scripts, command), 'Unknown execution command');
  const script = command === 'next' ? path.join(admin, 'node_modules/next/dist/bin/next') : path.join(admin, 'scripts', scripts[command]);
  const args = command === 'next' ? [script, 'dev', '--webpack', '-H', '127.0.0.1', '-p', '3018'] : ['--import', 'tsx', script];
  if (command === 'soak-preflight') args.push('--preflight');
  if (command === 'soak-smoke' || command === 'soak-crash') args.push('--smoke');
  if (command === 'soak-crash') args.push('--cleanup-recovery-check');
  if (command === 'soak-control') {
    for (const flag of flags) assert.ok(['--request-stop', '--cleanup-orphan'].includes(flag));
    args.push(...flags);
  }
  const background = ['gateway', 'next', 'soak-start'].includes(command);
  const log = path.join(output, command + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.log');
  const fd = fs.openSync(log, 'wx');
  const child = cp.spawn(process.execPath, args, {cwd: admin, env, detached: background, windowsHide: true, stdio: ['ignore', fd, fd]}); fs.closeSync(fd);
  if (background) {
    child.unref(); await delay(500);
    const actual = processIdentity(child.pid);
    assert.ok(actual, 'Execution exited before its process identity was captured');
    const receipt = {...actual, script, manifest: manifest.sha256, log};
    fs.writeFileSync(path.join(output, command + '-process.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({command, pid: child.pid, log, manifest: identity.manifest}));
  } else {
    const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', resolve);});
    const after = await verifyExecutionAsync(manifestFile);
    const receipt = {command, code, log, manifest: after.manifest, finished: new Date().toISOString()};
    fs.writeFileSync(log + '.json', JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt)); process.exitCode = code ?? 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [command, outputArg, ...flags] = process.argv.slice(2);
  const workspace = path.resolve(import.meta.dirname, '../..');
  const output = path.resolve(outputArg || '');
  Promise.resolve().then(async () => {
    if (command === 'prepare') await prepare(workspace, output, flags);
    else if (command === 'verify') console.log(JSON.stringify(await verifyExecutionAsync(path.join(output, 'execution-manifest.json'))));
    else await launch(command, output, flags);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
