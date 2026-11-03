import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {installProviderTrace} from '../construction-camera-provider-trace.mjs';

test('provider trace preserves false acknowledgements and never records secrets or retries', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-provider-trace-'));
  const file = path.join(folder, 'trace.jsonl'), calls = [];
  const signal = AbortSignal.timeout(8000), secret = 'private-cannot-appear';
  const transport = async (input, init) => { calls.push({input, init}); return new Response(JSON.stringify({code: 0, result: false, msg: secret, data: {accessToken: secret, list: []}})); };
  const trace = installProviderTrace({file, origins: ['http://camera.invalid'], transport});
  try {
    const url = 'http://camera.invalid/index/api/startRecord?secret='+secret;
    const init = {signal, headers: {'access-token': secret}, body: secret, method: 'POST'};
    const response = await trace.fetch(url, init);
    assert.equal((await response.json()).result, false);
    assert.equal(calls.length, 1); assert.equal(calls[0].input, url); assert.equal(calls[0].init, init);
    assert.deepEqual(await trace.close(), {writeFailed: false});
    const text = fs.readFileSync(file, 'utf8'); assert.ok(!text.includes(secret)); assert.ok(!text.includes('accessToken'));
    const body = text.trim().split('\n').map(JSON.parse).find(r => r.phase === 'body');
    assert.equal(body.http, 200); assert.equal(body.code, 0); assert.equal(body.result, false); assert.equal(body.messageCategory, 'other');
    assert.throws(() => installProviderTrace({file, origins: ['http://camera.invalid'], transport}), /EEXIST/);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('a slow diagnostic body does not delay or consume the original response', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-provider-trace-'));
  const file = path.join(folder, 'trace.jsonl'); let finish;
  const source = new Response(new ReadableStream({start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode('{"code":0,"status":true}')); controller.close(); }; }}));
  const trace = installProviderTrace({file, origins: ['http://camera.invalid'], transport: async () => source, bodyDeadlineMs: 20});
  try {
    const before = performance.now(), returned = await trace.fetch('http://camera.invalid/index/api/isRecording');
    assert.equal(returned, source); assert.ok(performance.now()-before < 100);
    await new Promise(resolve => setTimeout(resolve, 35)); finish();
    assert.deepEqual(await returned.json(), {code: 0, status: true}); await trace.close();
    assert.ok(fs.readFileSync(file, 'utf8').includes('diagnostic_deadline'));
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('oversized or non-JSON bodies and unrecognized destinations cannot leak payloads', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-provider-trace-'));
  const file = path.join(folder, 'trace.jsonl'), secret = 'sensitive-provider-body'; let calls = 0;
  const trace = installProviderTrace({file, origins: ['http://camera.invalid'], maxBytes: 8,
    transport: async () => { calls++; return new Response(secret); }});
  try {
    assert.equal(await (await trace.fetch('http://camera.invalid/index/api/stopRecord')).text(), secret);
    await trace.fetch('http://other.invalid/index/api/stopRecord?secret='+secret);
    await trace.fetch('http://camera.invalid/private/'+secret);
    await trace.close(); const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes('oversized')); assert.ok(!text.includes(secret)); assert.ok(!text.includes('other.invalid'));
    assert.equal(text.trim().split('\n').map(JSON.parse).filter(r => r.phase === 'request').length, 1); assert.equal(calls, 3);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('the preload leaves a cold esbuild compiler worker able to acknowledge its parent', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-provider-trace-'));
  const admin = fileURLToPath(new URL('../../', import.meta.url));
  const preload = fileURLToPath(new URL('../construction-camera-provider-trace.mjs', import.meta.url));
  try {
    const source = 'const esbuild=require("esbuild");const r=esbuild.transformSync("const value: number = 4;",{loader:"ts"});console.log(r.code.includes("value = 4")?"TRANSFORM_OK":"BAD");';
    const child = cp.spawnSync(process.execPath, ['-e', source], {cwd: admin, windowsHide: true, encoding: 'utf8', timeout: 5000,
      env: {...process.env, NODE_OPTIONS: '--import='+pathToFileURL(preload).href, CAMERA_PROVIDER_TRACE_DIR: folder,
        CAMERA_WVP_ORIGIN: 'http://camera.invalid', CAMERA_MEDIA_ORIGIN: 'http://media.invalid'}});
    assert.equal(child.error, undefined, 'A compiler worker must not deadlock during preload');
    assert.equal(child.status, 0); assert.equal(child.stdout.trim(), 'TRANSFORM_OK');
    assert.equal(fs.readdirSync(folder).filter(file => file.endsWith('.jsonl')).length, 1);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});
