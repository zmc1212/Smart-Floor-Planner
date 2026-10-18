import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const base = process.argv[2] || 'd023854313842ef447efb2973beb540d1511e125';
if (!/^[a-f0-9]{8,40}$/.test(base)) throw Error('Expected an explicit baseline commit hash');
const norm = file => path.resolve(file).replaceAll('\\', '/');
const changed = ['src/lib/assistant/knowledge/operations.ts', 'src/db/__tests__/assistant-knowledge-operations.test.ts',
  'src/components/assistant/knowledge-operations.tsx', 'src/app/api/assistant/knowledge/operations/[...path]/route.ts',
  'src/app/(admin)/(merchant)/assistant-knowledge/page.tsx', 'src/lib/assistant/knowledge/context-selection.ts',
  'src/lib/assistant/knowledge/retrieval.ts', 'src/lib/assistant/__tests__/context-selection.test.ts',
  'src/db/__tests__/assistant-professional-knowledge.test.ts'];
const addedCandidates = ['src/lib/assistant/knowledge/evaluation-batch.ts', 'src/lib/assistant/__tests__/knowledge-evaluation-batch.test.ts',
  'src/lib/assistant/knowledge/operation-batch-view.ts', 'src/components/assistant/knowledge-batch-client.ts',
  'src/components/assistant/knowledge-batches.tsx', 'src/lib/assistant/__tests__/knowledge-batch-client.test.ts',
  'src/db/__tests__/assistant-knowledge-batches.test.ts', 'src/db/__tests__/assistant-knowledge-coverage.test.ts',
  'src/lib/assistant/__tests__/knowledge-context-coverage.test.ts', 'scripts/assistant-knowledge-coverage-cases.ts',
  'scripts/assistant-knowledge-semantics-live.ts', 'scripts/assistant-knowledge-semantic-rules.ts',
  'src/lib/assistant/__tests__/knowledge-semantic-acceptance.test.ts', 'scripts/assistant-docx-header-fixtures.ts',
  'src/lib/assistant/__tests__/knowledge-docx-headers.test.ts',
  'src/lib/assistant/__tests__/knowledge-archived-english-recall.test.ts', 'src/lib/assistant/knowledge/batch-execution-adapter.ts',
  'src/lib/assistant/__tests__/knowledge-batch-execution-adapter.test.ts',
  'scripts/knowledge-batch-seam-acceptance/process.ts', 'scripts/knowledge-batch-seam-acceptance/offline-store.ts',
  'scripts/knowledge-batch-seam-acceptance/postgres-fixture.ts', 'scripts/knowledge-batch-seam-acceptance/driver.ts',
  'scripts/knowledge-batch-seam-acceptance/types.ts', 'src/lib/assistant/__tests__/knowledge-batch-seam-acceptance.test.ts',
  'scripts/assistant-knowledge-semantics-followup.ts','src/lib/assistant/__tests__/knowledge-semantic-followup.test.ts',
  'scripts/assistant-knowledge-revocation.ts','src/lib/assistant/__tests__/knowledge-recovery-evidence.test.ts'];
const baselineFiles = new Set(cp.execFileSync('git', ['-C', path.resolve(root, '..'), 'ls-tree', '-r', '--name-only', base, '--',
  ...addedCandidates.map(file => 'admin/' + file)], { encoding: 'utf8', windowsHide: true }).trim().split('\n'));
const added = new Set(addedCandidates.filter(file => !baselineFiles.has('admin/' + file)).map(file => norm(root + '/' + file)));
changed.push(...['scripts/assistant-knowledge-semantics-live.ts'].filter(file=>baselineFiles.has('admin/'+file)));
const overrides = new Map(changed.map(file => [norm(root + '/' + file), cp.execFileSync('git',
  ['-C', path.resolve(root, '..'), 'show', base + ':admin/' + file], { encoding: 'utf8', windowsHide: true })]));
const config = ts.readConfigFile(root + '/tsconfig.json', ts.sys.readFile).config;
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
parsed.options.incremental = false;
parsed.options.tsBuildInfoFile = undefined;
const files = parsed.fileNames.filter(file => !/[\\/]\.next[\\/]/.test(file));
function diagnostics(baseline) {
  const host = ts.createCompilerHost(parsed.options), read = host.readFile.bind(host);
  host.readFile = file => {
    let content = baseline ? overrides.get(norm(file)) ?? read(file) : read(file);
    if (file.endsWith('next-env.d.ts')) content = content?.replace(/^import.*\.next.*$/gm, '');
    return content;
  };
  return ts.getPreEmitDiagnostics(ts.createProgram(baseline ? files.filter(file => !added.has(norm(file))) : files, parsed.options, host));
}
const before = diagnostics(true), after = diagnostics(false);
const signature = d => (d.file ? norm(d.file.fileName).replace(norm(root) + '/', '') : '')
  + '|' + d.code + '|' + ts.flattenDiagnosticMessageText(d.messageText, ' ');
function difference(left, right) {
  const remaining = new Map();
  for (const d of right) { const k = signature(d); remaining.set(k, (remaining.get(k) || 0) + 1); }
  return left.map(signature).filter(k => {
    const count = remaining.get(k) || 0;
    if (!count) return true;
    remaining.set(k, count - 1);
    return false;
  });
}
const result = { base, scope: 'Same source program; knowledge-owned changed files restored and new knowledge TS files excluded for baseline; generated Next declarations excluded in both', changed, addedFiles: [...added].map(file => file.replace(norm(root) + '/', '')),
  before: before.length, after: after.length, added: difference(after, before), removed: difference(before, after) };
const output = path.resolve(root, process.argv[3] || '../tmp/knowledge-batch');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(output + '/type-comparison.json', JSON.stringify(result, null, 2));
fs.writeFileSync(output + '/source-types.log', ts.formatDiagnosticsWithColorAndContext(after,
  { getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
console.log(JSON.stringify(result));
if (result.added.length) process.exitCode = 1;
