// Read-only deployment evidence. Remote failures never fall back to local Docker
// or local statfs, and this module never deploys or controls a camera.
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REMOTE_CAMERA_CONTEXT = 'sfp-remote-dev';
export const REMOTE_CAMERA_RECORDING_PATH = 'D:/Smart-Floor-Planner-Dev/migrated-services-20261103/record';
export const LOCAL_CAMERA_RECORDING_PATH = 'F:/SmartFloorPlannerCamera/media/record';
const containers = ['wvp-stack-zlm-1', 'wvp-stack-wvp-1', 'sfp-camera-storage-storage-1'];
const normalize = value => value.replaceAll('\\', '/').replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i, (_all, drive) => drive.toUpperCase() + ':/').replace(/\/$/, '').toLowerCase();

export function cameraDeployment(context) {
  assert.ok([REMOTE_CAMERA_CONTEXT, 'desktop-linux'].includes(context), 'An explicit approved camera Docker context is required');
  return {context, recordingHostPath: context === REMOTE_CAMERA_CONTEXT ? REMOTE_CAMERA_RECORDING_PATH : LOCAL_CAMERA_RECORDING_PATH};
}

export function cameraCommand(command, args) {
  try {
    return cp.execFileSync(command, args, {encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}).trim();
  } catch {
    // Native error objects can include stderr and private command arguments.
    throw Error('Camera deployment read failed: ' + command);
  }
}

export function cameraTransport(context, command = cameraCommand) {
  cameraDeployment(context);
  const endpoint = JSON.parse(command('docker', ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}']));
  if (context === 'desktop-linux') {
    assert.ok(typeof endpoint === 'string' && (endpoint.startsWith('npipe:') || endpoint.startsWith('unix:')), 'Local context must use the local Docker socket');
    return {context, endpoint};
  }
  assert.equal(endpoint, 'ssh://sfp-remote-dev', 'Camera context must use the approved SSH alias');
  const values = {};
  for (const line of command('ssh', ['-G', context]).split(/\r?\n/)) {
    const at = line.indexOf(' '); if (at < 1) continue;
    const key = line.slice(0, at), value = line.slice(at + 1);
    (values[key] ||= []).push(value);
  }
  assert.equal(values.hostname?.[0], '192.168.10.54');
  assert.equal(values.user?.[0]?.toLowerCase(), 'administrator');
  assert.equal(values.port?.[0], '22');
  assert.equal(values.batchmode?.[0], 'yes');
  assert.ok(['yes', 'true'].includes(values.stricthostkeychecking?.[0]), 'SSH host checking must remain strict');
  assert.equal(values.connecttimeout?.[0], '8');
  assert.ok(!values.proxycommand && !values.proxyjump, 'Do not redirect the approved camera SSH connection');
  const identityFile = path.join(os.homedir(), '.ssh/toonflow_remote_ed25519');
  assert.deepEqual(values.identityfile?.map(normalize), [normalize(identityFile)], 'Use only the existing approved SSH identity');
  return {context, endpoint, ssh: {host: values.hostname[0], user: values.user[0], port: 22, identityFile, strictHostKeyChecking: true, batchMode: true, connectTimeout: 8}};
}

export function cameraImages(context, command = cameraCommand) {
  cameraDeployment(context);
  const format = '{"name":{{json .Name}},"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}';
  const images = command('docker', ['--context', context, 'inspect', '--format', format, ...containers]).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assert.deepEqual(images.map(image => image.name).sort(), containers.map(name => '/' + name).sort(), 'All camera dependencies must exist');
  for (const image of images) {
    assert.equal(image.running, true, 'Camera dependency must already be running');
    assert.match(image.id, /^[a-f0-9]{64}$/);
    assert.match(image.image, /^sha256:[a-f0-9]{64}$/);
    assert.ok(Array.isArray(image.mounts));
    image.mounts.sort((a, b) => a.Destination.localeCompare(b.Destination));
  }
  return images.sort((a, b) => a.name.localeCompare(b.name));
}

export function assertCameraMounts(images, recordingHostPath) {
  const find = (name, destination) => images.find(image => image.name === '/' + name)?.mounts.find(mount => mount.Destination === destination);
  const recorder = find(containers[0], '/opt/media/www/record'), probe = find(containers[2], '/media/record');
  assert.ok(recorder?.Type === 'bind' && recorder.RW === true && probe?.Type === 'bind' && probe.RW === false, 'Recorder and probe require approved read-write/read-only overlays');
  assert.equal(normalize(recorder.Source || ''), normalize(recordingHostPath), 'Recorder physical source differs');
  assert.equal(normalize(probe.Source || ''), normalize(recordingHostPath), 'Probe physical source differs');
  for (const [name, destination, writable] of [[containers[0], '/opt/media/www', true], [containers[1], '/opt/media/www', true], [containers[2], '/media', false]]) {
    const media = find(name, destination);
    assert.ok(media?.Type === 'volume' && media.Name === 'wvp-stack_media-data' && media.RW === writable, 'Camera media volume identity or access differs');
  }
}

function nativeCapacity(deployment, command) {
  if (deployment.context === 'desktop-linux') {
    const real = fs.realpathSync(deployment.recordingHostPath);
    assert.equal(normalize(real), normalize(deployment.recordingHostPath));
    const stat = fs.statfsSync(real, {bigint: true});
    return {host: os.hostname(), recordingHostPath: deployment.recordingHostPath, totalBytes: String(stat.blocks * stat.bsize), availableBytes: String(stat.bavail * stat.bsize)};
  }
  // Fixed, read-only script: no arbitrary remote paths/commands or key reads.
  const script = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$p=Get-Item -LiteralPath '${REMOTE_CAMERA_RECORDING_PATH}';if(-not $p.PSIsContainer){throw 'Recording directory missing'};$cursor=$p;while($cursor){if(($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Recording path is redirected'};$cursor=$cursor.Parent};$disk=[IO.DriveInfo]::new('D');@{host=$env:COMPUTERNAME;recordingHostPath=$p.FullName.Replace('\\','/');totalBytes=[string]$disk.TotalSize;availableBytes=[string]$disk.AvailableFreeSpace}|ConvertTo-Json -Compress`;
  const result = command('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', REMOTE_CAMERA_CONTEXT, 'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  const native = JSON.parse(result.replace(/^\uFEFF/, ''));
  assert.equal(native.host?.toLowerCase(), 'user-2026pkprrp', 'Unexpected remote Windows host');
  assert.equal(normalize(native.recordingHostPath || ''), normalize(deployment.recordingHostPath));
  return native;
}

const bytes = value => { assert.ok(typeof value === 'string' && /^\d+$/.test(value), 'Missing physical capacity evidence'); return BigInt(value); };
export function assertCameraCapacity(sample, native, now = Date.now()) {
  assert.equal(sample?.version, 1);
  assert.equal(sample.node, 'wvp-zlm-01');
  const age = now - Date.parse(sample.sampledAt);
  assert.ok(Number.isFinite(age) && age >= -5000 && age <= 15000, 'Probe capacity evidence must be fresh');
  const total = bytes(native.totalBytes), available = bytes(native.availableBytes), reported = bytes(sample.availableBytes);
  assert.ok(total > 0n && available > 0n && available <= total && reported <= total);
  assert.equal(bytes(sample.totalBytes), total, 'Probe capacity differs from the native physical drive');
  assert.ok((reported > available ? reported - available : available - reported) <= 64n * 1024n ** 2n, 'Probe free space differs from the native physical drive');
  assert.equal(bytes(sample.files), 0n, 'Windows host inode availability must remain explicitly unknown');
  assert.equal(bytes(sample.availableFiles), 0n);
}

// A driver may only stop the gateway it owns. The same script is launched either
// relative to the workspace by the local harness or by absolute path from a
// sealed batch copy, so the identity is the interpreter plus that script under a
// `scripts/` directory; an unrelated 3017 listener stays out of scope.
export const ownedGateway = /node.*--import tsx (?:.*[\\/])?scripts[\\/]construction-camera-gateway\.ts/i;

// Read-only deployment identity for one live acceptance batch. The context must be
// explicit, so a stopped local engine or a shifted default context can never be
// silently bound as the evidence host.
export function cameraLiveDeployment(env, command = cameraCommand) {
  const deployment = cameraDeployment(env.CAMERA_DOCKER_CONTEXT);
  assert.equal(env.CAMERA_RECORDING_HOST_PATH, deployment.recordingHostPath, 'A live batch must name the deployment recording host path');
  const transport = cameraTransport(deployment.context, command);
  const capture = () => {
    assert.deepEqual(cameraTransport(deployment.context, command), transport, 'Camera transport changed during the batch');
    const images = cameraImages(deployment.context, command);
    assertCameraMounts(images, deployment.recordingHostPath);
    return images;
  };
  const images = capture();
  return {context: deployment.context, recordingHostPath: deployment.recordingHostPath, transport, images, capture};
}

export function cameraEnvironmentIdentity(report) {
  return {transport: report.transport, images: report.images, recordingHostPath: report.recordingHostPath, nativeHost: report.native.host, totalBytes: report.native.totalBytes};
}

export async function inspectCameraEnvironment(context, storage, {command = cameraCommand, request = fetch} = {}) {
  const deployment = cameraDeployment(context), transport = cameraTransport(context, command);
  assert.equal(storage?.origin, 'http://127.0.0.1:18082');
  assert.ok(typeof storage.token === 'string' && storage.token.length >= 32, 'Existing private probe token required');
  const images = cameraImages(context, command);
  assertCameraMounts(images, deployment.recordingHostPath);
  const native = nativeCapacity(deployment, command);
  const response = await request(storage.origin + '/storage', {headers: {Authorization: 'Bearer ' + storage.token}, signal: AbortSignal.timeout(5000), redirect: 'error'});
  assert.equal(response.status, 200, 'Private capacity probe unavailable');
  const sample = await response.json();
  assertCameraCapacity(sample, native);
  const anonymous = await request(storage.origin + '/storage', {signal: AbortSignal.timeout(5000), redirect: 'error'});
  assert.equal(anonymous.status, 401, 'Capacity probe must deny anonymous reads');
  await anonymous.body?.cancel();
  const after = cameraImages(context, command);
  assert.deepEqual(after, images, 'Camera dependencies changed during physical preflight');
  assert.deepEqual(cameraTransport(context, command), transport, 'Camera transport changed during physical preflight');
  return {checkedAt: new Date().toISOString(), mode: 'read-only-preflight', ...deployment, transport, images, native, sample, physicalCapacityVerified: true, mountReadOnly: true, anonymous: 401};
}
