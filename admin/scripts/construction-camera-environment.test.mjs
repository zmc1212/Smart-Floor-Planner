import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cameraDeployment, cameraTransport, cameraLiveDeployment, inspectCameraEnvironment, assertCameraCapacity, REMOTE_CAMERA_CONTEXT, REMOTE_CAMERA_RECORDING_PATH, LOCAL_CAMERA_RECORDING_PATH} from './construction-camera-environment.mjs';
import {executionDeploymentEnvironment} from './construction-camera-execution.mjs';
import {storageArguments} from './construction-camera-storage-local.mjs';

function fixture() {
  const source = '/run/desktop/mnt/host/d/Smart-Floor-Planner-Dev/migrated-services-20261103/record';
  const volume = (Destination, RW) => ({Type: 'volume', Name: 'wvp-stack_media-data', Source: '/var/lib/docker/volumes/wvp-stack_media-data/_data', Destination, RW});
  const overlay = (Destination, RW) => ({Type: 'bind', Source: source, Destination, RW, Propagation: 'rprivate'});
  const images = [
    {name: '/wvp-stack-zlm-1', mounts: [volume('/opt/media/www', true), overlay('/opt/media/www/record', true)]},
    {name: '/wvp-stack-wvp-1', mounts: [volume('/opt/media/www', true)]},
    {name: '/sfp-camera-storage-storage-1', mounts: [volume('/media', false), overlay('/media/record', false)]},
  ].map((image, index) => ({...image, id: String(index + 1).repeat(64), image: 'sha256:' + String(index + 4).repeat(64), running: true, started: '2026-11-03T10:00:00Z'}));
  const native = {host: 'User-2026PKPRRP', recordingHostPath: REMOTE_CAMERA_RECORDING_PATH, totalBytes: '1403827589120', availableBytes: '900000000000'};
  const sample = {version: 1, node: 'wvp-zlm-01', sampledAt: new Date().toISOString(), totalBytes: native.totalBytes, availableBytes: native.availableBytes, files: '0', availableFiles: '0'};
  const calls = [], requests = [];
  let inspect = 0;
  const control = {endpoint: 'ssh://sfp-remote-dev', host: '192.168.10.54', strict: 'true', after: null};
  const command = (binary, args) => {
    calls.push({binary, args});
    if (binary === 'docker' && args[0] === 'context') return JSON.stringify(control.endpoint);
    if (binary === 'ssh' && args[0] === '-G') return `hostname ${control.host}\nuser Administrator\nport 22\nbatchmode yes\nstricthostkeychecking ${control.strict}\nconnecttimeout 8\nidentityfile ${path.join(os.homedir(), '.ssh/toonflow_remote_ed25519')}\n`;
    if (binary === 'ssh' && args.includes('-EncodedCommand')) {
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.ok(script.includes(REMOTE_CAMERA_RECORDING_PATH));
      assert.doesNotMatch(script, /(?:Set-|Start-|Stop-|Remove-|New-Item)/);
      return JSON.stringify(native);
    }
    assert.equal(binary, 'docker'); assert.deepEqual(args.slice(0, 3), ['--context', REMOTE_CAMERA_CONTEXT, 'inspect']);
    return (++inspect > 1 && control.after ? control.after : images).map(image => JSON.stringify(image)).join('\n');
  };
  const request = async (url, options) => {
    requests.push({url, authenticated: !!options.headers?.Authorization});
    assert.equal(url, 'http://127.0.0.1:18082/storage');
    return options.headers?.Authorization ? Response.json(sample) : new Response('', {status: 401});
  };
  const storage = {origin: 'http://127.0.0.1:18082', token: 'private'.repeat(8)};
  return {images, native, sample, calls, requests, control, command, run: () => inspectCameraEnvironment(REMOTE_CAMERA_CONTEXT, storage, {command, request})};
}

test('explicit context and action prevent implicit local deployment or a remote compose mutation', () => {
  for (const args of [[], ['--context', 'unknown', '--check', '--output', 'new.json'], ['--context', REMOTE_CAMERA_CONTEXT, '--deploy-local'], ['--context', REMOTE_CAMERA_CONTEXT], ['--context', REMOTE_CAMERA_CONTEXT, '--check'], ['--context', REMOTE_CAMERA_CONTEXT, '--check', '--deploy-local', '--output', 'new.json']]) assert.throws(() => storageArguments(args));
  const parsed = storageArguments(['--context', REMOTE_CAMERA_CONTEXT, '--check', '--output', 'new.json']);
  assert.equal(parsed['--check'], true);
  assert.throws(() => storageArguments(['--context', REMOTE_CAMERA_CONTEXT, '--context', 'desktop-linux', '--check', '--output', 'new.json']));
});

test('a prepared remote runtime selects D independently of local F or shell defaults', () => {
  assert.deepEqual(executionDeploymentEnvironment(REMOTE_CAMERA_CONTEXT), {CAMERA_DOCKER_CONTEXT: REMOTE_CAMERA_CONTEXT, CAMERA_RECORDING_HOST_PATH: REMOTE_CAMERA_RECORDING_PATH});
  assert.throws(() => cameraDeployment());
  assert.throws(() => cameraTransport('unexpected', () => {throw Error('must not invoke a command');}), /explicit/);
});

test('remote capacity is verified on the SSH host using only existing read-only dependencies', async () => {
  const f = fixture(), report = await f.run();
  assert.equal(report.native.host, 'User-2026PKPRRP');
  assert.equal(report.physicalCapacityVerified, true);
  assert.deepEqual(f.requests.map(request => request.authenticated), [true, false]);
  assert.ok(f.calls.every(call => call.binary === 'ssh' || (call.binary === 'docker' && (call.args[0] === 'context' || call.args[2] === 'inspect'))));
  assert.ok(f.calls.filter(call => call.binary === 'docker' && call.args[0] === '--context').every(call => call.args[1] === REMOTE_CAMERA_CONTEXT));
  assert.equal(JSON.stringify(report).includes('privateprivate'), false);
});

test('wrong endpoint, host or relaxed SSH checks fail before native capacity reads', async () => {
  for (const override of [{endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine'}, {host: '192.168.10.32'}, {strict: 'false'}]) {
    const f = fixture(); Object.assign(f.control, override);
    await assert.rejects(f.run());
    assert.equal(f.calls.some(call => call.args.includes('-EncodedCommand')), false);
    assert.equal(f.requests.length, 0);
  }
});

test('mismatched host overlays, writable probes and unrelated media volumes fail closed', async () => {
  for (const change of [
    f => {f.images[0].mounts[1].Source = f.images[0].mounts[1].Source.replace('/host/d/', '/host/f/');},
    f => {f.images[2].mounts[1].RW = true;},
    f => {f.images[1].mounts[0].Name = 'unrelated';},
    f => {f.images[0].running = false;},
  ]) {
    const f = fixture(); change(f); await assert.rejects(f.run());
    assert.equal(f.requests.length, 0);
  }
});

test('unknown or stale capacity never becomes healthy evidence', () => {
  const f = fixture();
  for (const override of [{availableBytes: null}, {totalBytes: '0'}, {sampledAt: 'invalid'}, {sampledAt: new Date(Date.now() - 16000).toISOString()}, {files: '1000000'}, {availableBytes: '900100000000'}]) assert.throws(() => assertCameraCapacity({...f.sample, ...override}, f.native));
});

test('an unexpected native Windows host or physical total is rejected', async () => {
  for (const change of [f => {f.native.host = 'another-host';}, f => {f.native.totalBytes = '999999999999';}]) {
    const f = fixture(); change(f); await assert.rejects(f.run());
  }
});

test('dependency replacement during preflight is rejected even with identical images', async () => {
  const f = fixture(); f.control.after = structuredClone(f.images); f.control.after[0].id = 'f'.repeat(64);
  await assert.rejects(f.run(), /changed during physical preflight/);
});

test('mount ordering is normalized without discarding full mount fields', async () => {
  const f = fixture(); f.control.after = structuredClone(f.images);
  f.control.after[0].mounts.reverse(); await f.run();
  const changed = fixture(); changed.control.after = structuredClone(changed.images); changed.control.after[0].mounts[1].Propagation = 'shared';
  await assert.rejects(changed.run(), /changed during physical preflight/);
});

const liveEnv = {CAMERA_DOCKER_CONTEXT: REMOTE_CAMERA_CONTEXT, CAMERA_RECORDING_HOST_PATH: REMOTE_CAMERA_RECORDING_PATH};

test('a live batch binds the approved remote deployment without touching the host disk or probe', () => {
  const f = fixture();
  const batch = cameraLiveDeployment(liveEnv, f.command);
  assert.equal(batch.context, REMOTE_CAMERA_CONTEXT);
  assert.equal(batch.recordingHostPath, REMOTE_CAMERA_RECORDING_PATH);
  assert.deepEqual(batch.images.map(image => image.name), ['/sfp-camera-storage-storage-1', '/wvp-stack-wvp-1', '/wvp-stack-zlm-1']);
  assert.ok(f.calls.every(call => call.binary === 'ssh' || call.args[0] === 'context' || call.args[1] === REMOTE_CAMERA_CONTEXT));
  assert.equal(f.calls.some(call => call.args.includes('-EncodedCommand')), false);
  assert.equal(f.requests.length, 0);
});

test('a live batch fails closed on an implicit engine, a mixed host or a mid-batch overlay change', () => {
  assert.throws(() => cameraLiveDeployment({}, () => {throw Error('must not invoke a command');}), /explicit/);
  assert.throws(() => cameraLiveDeployment({...liveEnv, CAMERA_RECORDING_HOST_PATH: LOCAL_CAMERA_RECORDING_PATH}, () => {throw Error('must not invoke a command');}), /recording host path/);
  const f = fixture();
  const batch = cameraLiveDeployment(liveEnv, f.command);
  f.control.after = structuredClone(f.images); f.control.after[2].mounts[1].RW = true;
  assert.throws(batch.capture, /read-write\/read-only/);
});

test('a live batch refuses a container replaced under the same names', () => {
  const f = fixture();
  const batch = cameraLiveDeployment(liveEnv, f.command);
  f.control.after = structuredClone(f.images); f.control.after[0].id = 'f'.repeat(64);
  assert.notEqual(JSON.stringify(batch.capture()), JSON.stringify(batch.images));
});

// The drivers used to call a bare local `docker inspect`, which silently bound a
// live batch to whichever engine happened to answer. They must go through the
// shared explicit-context binding instead.
test('live acceptance drivers bind their deployment through the shared module', () => {
  for (const name of ['construction-camera-storage-live.ts', 'construction-camera-recovery-live.ts', 'construction-camera-retention-live.ts']) {
    const source = fs.readFileSync(new URL('./' + name, import.meta.url), 'utf8');
    assert.match(source, /cameraLiveDeployment\(process\.env\)/);
    assert.doesNotMatch(source, /execFileSync\('docker'/);
  }
});
