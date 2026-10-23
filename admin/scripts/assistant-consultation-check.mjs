import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import ts from 'typescript';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const admin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(admin), output = path.join(root, 'tmp/xiaok-consultation-r0');
const mode = process.argv[2];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
fs.mkdirSync(output, { recursive: true });
function binding() {
  const files = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
    'admin/src', 'admin/scripts', 'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  files.push('admin/.env.local', 'admin/.env', 'tmp/xiaok-vector/connection.private.json');
  const entries = [...new Set(files)].sort().filter(file => fs.existsSync(path.join(root, file)))
    .map(file => [file, hash(fs.readFileSync(path.join(root, file)))]);
  return { entries, digest: hash(JSON.stringify(entries)) };
}
const before = binding();
save(mode + '-binding-before.json', before);
let release;
try {
  if (mode === 'types') {
    const config = ts.readConfigFile(path.join(admin, 'tsconfig.json'), ts.sys.readFile).config;
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, admin);
    parsed.options.incremental = false; parsed.options.tsBuildInfoFile = undefined;
    const files = ['src/lib/assistant/agent/worker.ts', 'src/lib/assistant/contracts/consultation.ts',
      'src/lib/assistant/__tests__/agent-runtime.test.ts', 'src/lib/assistant/__tests__/agent-vision.test.ts',
      'src/lib/assistant/__tests__/web.test.ts', 'src/lib/assistant/__tests__/context-budget.test.ts',
      'src/db/__tests__/assistant-agent.test.ts', 'src/db/__tests__/assistant-synthesis.test.ts',
      'src/db/__tests__/assistant-web.test.ts'].map(file => path.join(admin, file));
    const norm = file => path.resolve(file).replaceAll('\\', '/');
    const worker = norm(path.join(admin, 'src/lib/assistant/agent/worker.ts'));
    const baseline = fs.readFileSync(path.join(output, 'baseline/worker.ts'), 'utf8');
    function program(previous) {
      const host = ts.createCompilerHost(parsed.options), read = host.readFile.bind(host);
      host.readFile = file => previous && norm(file) === worker ? baseline : read(file);
      const value = ts.createProgram(previous ? files.filter(file => !file.endsWith('/consultation.ts') && !file.endsWith('\\consultation.ts')) : files,
        parsed.options, host);
      return { diagnostics: ts.getPreEmitDiagnostics(value), files: value.getSourceFiles().filter(file => !file.isDeclarationFile).length };
    }
    const previous = program(true), current = program(false);
    const key = diagnostic => (diagnostic.file?.fileName || '') + '|' + diagnostic.code + '|' + ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    const old = new Set(previous.diagnostics.map(key));
    const result = { baseline: 'exact pre-R0 working tree worker, unrelated changes preserved',
      before: previous.diagnostics.length, after: current.diagnostics.length,
      actualSourceFiles: current.files, added: current.diagnostics.map(key).filter(item => !old.has(item)) };
    fs.writeFileSync(path.join(output, 'types.log'), ts.formatDiagnosticsWithColorAndContext(current.diagnostics,
      { getCanonicalFileName: file => file, getCurrentDirectory: () => admin, getNewLine: () => '\n' }));
    save('types.json', result); console.log(JSON.stringify(result)); assert.equal(result.added.length, 0);
  } else {
    let files;
    if (mode === 'unit') files = fs.readdirSync(path.join(admin, 'src/lib/assistant/__tests__'))
      .filter(file => /^(agent-runtime|agent-vision|agent-memory|context-budget|web|synthesis.*|current-message.*|independent.*)\.test\.ts$/.test(file))
      .map(file => 'src/lib/assistant/__tests__/' + file);
    else if (mode === 'service' || mode === 'web') {
      nextEnv.loadEnvConfig(admin, true);
      // Evaluation uses its own application credential; never repoint the
      // development credential or modify either persisted configuration.
      const connection = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
      process.env.DATABASE_URL = connection.DATABASE_URL;
      for (const name of ['ASSISTANT_LIVE_TEXT', 'ASSISTANT_P2M_LIVE', 'ASSISTANT_P2M_EXTENDED', 'ASSISTANT_P2M_DEEPSEEK_PROBE']) delete process.env[name];
      release = await lockAssistantAcceptance(process.env.DATABASE_URL);
      files = (mode === 'web' ? ['assistant-web'] : ['assistant-agent', 'assistant-synthesis', 'assistant-web'])
        .map(file => 'src/db/__tests__/' + file + '.test.ts');
    } else if (mode === 'lint') files = ['src/lib/assistant/agent/worker.ts', 'src/lib/assistant/agent/model-request.ts',
      'src/lib/assistant/contracts/consultation.ts', 'scripts/assistant-consultation-offline.mjs', 'scripts/assistant-consultation-check.mjs'];
    else throw Error('Expected unit, web, service, types or lint');
    const args = mode === 'lint' ? ['node_modules/eslint/bin/eslint.js', ...files]
      : ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', ...files];
    const started = Date.now();
    const child = cp.spawnSync(process.execPath, args, { cwd: admin, env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const log = (child.stdout || '') + (child.stderr || '');
    fs.writeFileSync(path.join(output, mode + '.log'), log);
    const summary = { mode, files, exitCode: child.status, durationMs: Date.now() - started,
      result: log.split(/\r?\n/).filter(line => /^(# (tests|pass|fail|skipped)|ℹ (tests|pass|fail|skipped)|not ok|✖|Error:)/.test(line)),
      newModelCalls: 0, database: ['service','web'].includes(mode) ? 'loopback:55432/xiaok_embedding_eval' : null };
    save(mode + '.json', summary); console.log(JSON.stringify(summary));
    assert.equal(child.status, 0, 'See ' + mode + '.log');
  }
} finally {
  if (release) await release();
  const after = binding(); save(mode + '-binding-after.json', after);
  const stable = before.digest === after.digest;
  save(mode + '-integrity.json', { stable, before: before.digest, after: after.digest, files: before.entries.length });
  assert.ok(stable, 'Source/configuration drift invalidates this batch');
}
