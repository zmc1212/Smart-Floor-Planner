import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';
import { WechatideCliError } from '../wechatide-native-client';

const exec = promisify(execFile);

test('real nonzero child exposes Stable business JSON omitted by execFile stack', async () => {
  const payload = { ok: false, errorType: 'MCP_TOOL_ERROR', message: 'timeout waiting for automator response', source: 'mcp_business' };
  const started = performance.now();
  let original: unknown;
  try {
    const result = exec(process.execPath, ['-e', "process.stdin.pipe(process.stdout);process.stdin.on('end',()=>{process.stderr.write('skill-call');process.exitCode=1;});"], { windowsHide: true });
    result.child.stdin!.end(JSON.stringify(payload));
    await result;
  } catch (error) { original = error; }
  assert.ok(original instanceof Error);
  assert.doesNotMatch(original.stack || '', /timeout waiting for automator response/);
  const wrapped = new WechatideCliError('automation_evaluate', Math.round(performance.now() - started), original as ExecFileException & { stdout: string; stderr: string });
  assert.match(wrapped.message, /timeout waiting for automator response/);
  assert.equal(wrapped.detail.exitCode, 1);
  assert.equal(wrapped.detail.killed, false);
  assert.equal(wrapped.detail.signal, null);
  assert.deepEqual(wrapped.detail.payload, payload);
  assert.equal(wrapped.detail.stderr, 'skill-call');
  assert.deepEqual(JSON.parse(JSON.stringify(wrapped)).payload, payload);
});

test('a killed child preserves partial output and is distinguishable from business failure', async () => {
  const started = performance.now();
  let original: unknown;
  try {
    await exec(process.execPath, ['-e', "process.stdout.write('partial receipt');setTimeout(()=>{},10000)"], { timeout: 250, windowsHide: true });
  } catch (error) { original = error; }
  assert.ok(original instanceof Error);
  const wrapped = new WechatideCliError('automation_evaluate', Math.round(performance.now() - started), original as ExecFileException & { stdout: string; stderr: string });
  assert.equal(wrapped.detail.killed, true);
  assert.equal(wrapped.detail.signal, 'SIGTERM');
  assert.equal(wrapped.detail.stdout, 'partial receipt');
  assert.equal(wrapped.detail.payload, undefined);
  assert.ok(wrapped.detail.elapsedMs >= 200);
});

test('zero-exit CLI rejection and malformed protocol keep truthful separate receipts', () => {
  const rejected = new WechatideCliError('automation_evaluate', 42, { code: 0, stdout: '{"ok":true,"result":{"success":false,"error":"denied"}}' });
  assert.match(rejected.message, /denied/);
  assert.equal(rejected.detail.exitCode, 0);
  assert.equal(rejected.detail.payload?.result.success, false);
  const malformed = new WechatideCliError('automation_evaluate', 43, { code: 1, stdout: 'prefix {incomplete', stderr: 'partial error' });
  assert.equal(malformed.detail.payload, undefined);
  assert.equal(malformed.detail.stdout, 'prefix {incomplete');
  assert.match(malformed.message, /without a structured error/);
});

test('the saved post-compile failure is reported as bridge timeout, without argv exposure', () => {
  const wrapped = new WechatideCliError('automation_evaluate', 10751, {
    code: 1, killed: false, signal: null,
    stdout: JSON.stringify({ ok: false, errorType: 'MCP_TOOL_ERROR', message: 'timeout waiting for automator response', reason: 'mcp_business_fail' }),
    stderr: '[wechatide] skill-call: client=codex tool=automation_evaluate\n',
  });
  assert.match(wrapped.message, /exit=1, killed=false, signal=none, elapsedMs=10751/);
  assert.doesNotMatch(wrapped.message, /fn-source|process\.argv|Command failed/);
  assert.equal(wrapped.toJSON().payload?.reason, 'mcp_business_fail');
});
