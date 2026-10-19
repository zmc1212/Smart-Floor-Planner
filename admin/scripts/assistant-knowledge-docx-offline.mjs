import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2), focused = args.includes('--new-only'), i = args.indexOf('--output-dir');
const cellsOnly = args.includes('--cells-only');
if (focused && cellsOnly) throw Error('Choose --new-only or --cells-only');
if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--'))) throw Error('Missing --output-dir value');
const output = path.resolve(root, i < 0 ? '../tmp/knowledge-docx-headers' : args[i + 1]); fs.mkdirSync(output, { recursive: true });
const files = cellsOnly ? ['src/lib/assistant/__tests__/knowledge-docx-cells.test.ts'] : ['src/lib/assistant/__tests__/knowledge-docx-headers.test.ts',
  ...(focused ? [] : ['src/lib/assistant/__tests__/knowledge-docx-cells.test.ts', 'src/lib/assistant/__tests__/source-file.test.ts'])];
const sources = [...files, 'scripts/assistant-file-parser.mjs', 'scripts/assistant-file-fixtures.ts', 'scripts/assistant-docx-header-fixtures.ts', 'scripts/assistant-knowledge-docx-offline.mjs',
  'scripts/assistant-docx-cell-fixtures.ts', 'src/lib/assistant/knowledge/source-file.ts', 'src/lib/assistant/contracts/source-file.ts'];
const hashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')]));
const before = hashes(), logFile = path.join(output, 'unit.log'); fs.writeFileSync(logFile, '');
// No .env/connection read. The canonical parser additionally receives only its existing sanitized environment.
const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=120000', ...files], {
  cwd: root, env: { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, LANGCHAIN_TRACING_V2: 'false' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { log += value; fs.appendFileSync(logFile, value); });
const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
const after = hashes(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
const summary = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, Number(log.match(new RegExp(`^# ${name} ([0-9]+)`, 'm'))?.[1] || 0)]));
const complete = summary.tests > 0 && summary.pass === summary.tests && ['fail', 'cancelled', 'skipped'].every(name => summary[name] === 0);
const runnerExitCode = exitCode || (sourceStable && complete ? 0 : 1);
fs.writeFileSync(path.join(output, 'unit-status.json'), JSON.stringify({ exitCode, runnerExitCode, sourceStable, before, after, summary, finished: new Date().toISOString(),
  reality: 'Actual local DOCX/PDF parser; synthetic originals; deterministic chunk callback and existing simulated Agent ports; no database, model, Embedding or Worker',
}, null, 2));
console.log(JSON.stringify({ exitCode, runnerExitCode, sourceStable, ...summary }));
if (exitCode) console.log(log.split('\n').filter(line => /^not ok|^  error:|^  code:/.test(line)).join('\n'));
process.exitCode = runnerExitCode;
