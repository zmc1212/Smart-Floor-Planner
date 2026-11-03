import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyExecutionFile, snapshotFiles, verifyExecution, verifyExecutionAsync, assertExecutionProcess, processIdentity} from './construction-camera-execution.mjs';

function fixture(t) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-execution-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir()));
    assert.match(path.basename(output), /^camera-execution-[\w-]+$/);
    fs.rmSync(output, {recursive: true, force: true});
  });
  const executionRoot = path.join(output, 'execution');
  const source = path.join(output, 'working.ts'); fs.writeFileSync(source, 'original dirty source');
  const target = 'execution/admin/src/camera.ts';
  const entry = {source, target, kind: 'source', ...copyExecutionFile(source, path.join(output, target))};
  const dependency = 'execution/admin/node_modules/example/index.js';
  const dep = {source, target: dependency, kind: 'dependency', ...copyExecutionFile(source, path.join(output, dependency))};
  const body = {format: 1, output, executionRoot, entries: [entry, dep], externalPins: []};
  const file = path.join(output, 'execution-manifest.json');
  fs.writeFileSync(file, JSON.stringify({...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex')}));
  return {output, executionRoot, source, target: path.join(output, target), dependency: path.join(output, dependency), file};
}

test('physical copy retains dirty bytes when the working source later changes', t => {
  const f = fixture(t); fs.writeFileSync(f.source, 'new working source');
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'original dirty source');
  assert.equal(verifyExecution(f.file).files, 2);
});

test('modified execution source is rejected before service execution', t => {
  const f = fixture(t); fs.writeFileSync(f.target, 'changed execution');
  assert.throws(() => verifyExecution(f.file, false), /Execution bytes changed/);
});

test('deep dependency verification rejects installed-package drift', t => {
  const f = fixture(t); fs.writeFileSync(f.dependency, 'changed package');
  assert.equal(verifyExecution(f.file, false).deep, false);
  assert.throws(() => verifyExecution(f.file, true), /Execution bytes changed/);
});

test('bounded concurrent verification retains the same manifest and rejection', async t => {
  const f = fixture(t);
  assert.deepEqual(await verifyExecutionAsync(f.file), verifyExecution(f.file));
  fs.writeFileSync(f.dependency, 'changed package');
  await assert.rejects(verifyExecutionAsync(f.file), /Execution bytes changed/);
});

test('manifest tampering and missing copied files fail closed', t => {
  const f = fixture(t); fs.unlinkSync(f.target);
  assert.throws(() => verifyExecution(f.file));
  const manifest = JSON.parse(fs.readFileSync(f.file, 'utf8')); manifest.entries.pop();
  fs.writeFileSync(f.file, JSON.stringify(manifest));
  assert.throws(() => verifyExecution(f.file), /manifest changed/);
});

test('copying never overwrites a previous execution', t => {
  const f = fixture(t);
  assert.throws(() => copyExecutionFile(f.source, f.target), /Never overwrite/);
  assert.deepEqual(snapshotFiles(f.executionRoot), ['admin/node_modules/example/index.js', 'admin/src/camera.ts']);
});

test('process ownership requires the same PID creation, interpreter and snapshot', () => {
  const expected = {pid: 123, created: 'original', executable: process.execPath, script: path.resolve('frozen/scripts/gateway.ts')};
  const actual = {...expected, command: `${process.execPath} --import tsx ${expected.script}`};
  assert.doesNotThrow(() => assertExecutionProcess(expected, actual));
  assert.throws(() => assertExecutionProcess(expected, {...actual, created: 'later'}), /PID was reused/);
  assert.throws(() => assertExecutionProcess(expected, {...actual, command: 'node working/scripts/gateway.ts'}), /snapshot/);
});

test('Windows process inspection preserves real Chinese command-line characters', {skip: process.platform !== 'win32'}, async () => {
  const child = cp.spawn(process.execPath, ['--eval', '/* 执行身份 */ setInterval(()=>{},1000)'], {windowsHide: true, stdio: 'ignore'});
  try {
    await new Promise((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});
    const actual = processIdentity(child.pid);
    assert.equal(actual.pid, child.pid);
    assert.ok(actual.command.includes('执行身份'), 'CIM output must be decoded as UTF-8');
    assert.equal(actual.command.includes('\ufffd'), false);
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM'); await exited;
  }
});
